import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { socialCardData, createSharedCardLoader } from './share-card-data.mjs';
import { identifyDeck } from './generated/share-matchup.mjs';
import { shareCardCatalog, originalCardArt } from './share-catalog.mjs';
import { embeddedCardArt } from '../api/share-card.mjs';

const fixture = JSON.parse(readFileSync(new URL('../../src/tracker/__tests__/fixtures/deck-identity-corpus.json', import.meta.url)));
const deck = (cards, playerName = 'You') => ({ playerName, source: 'match-start', total: 60, cards });
const dragapult = fixture.cases.find(entry => entry.expected === 'Dragapult ex');

test('social previews use the real classifier and printed catalog for all 96 reviewed decks', () => {
  for (const entry of fixture.cases) {
    const list = deck(entry.cards);
    const catalog = shareCardCatalog([list]);
    const result = identifyDeck(list, catalog);
    assert.deepEqual(result.unresolvedCardIds, [], entry.id);
    const card = socialCardData({ review: {
      localPlayer: 'You', opponent: 'Them', decklists: [list], turns: [],
    }, summary: { socialPreview: { localCardName: 'Drakloak', localCardId: 'sv8-5_72' } } });
    assert.equal(card.localPokemon.name, entry.expected, entry.id);
    assert.equal(card.localPokemon.cardId, result.card.cardId, 'Use the actual chosen printing');
    assert.equal(card.opponentPokemon.name, 'Unknown deck', 'Never copy another player’s deck');
  }
});

test('a captured Dragapult mirror overrides stale Drakloak previews and misleading final boards', () => {
  const review = { localPlayer: 'You', opponent: 'Them', winner: 'You',
    decklists: [deck(dragapult.cards), deck([...dragapult.cards].reverse(), 'Them')],
    turns: [{ snapshot: { players: {
      You: { bench: [], prizesTaken: 3 },
      Them: { bench: [], prizesTaken: 0, active: { name: 'Meowth ex', cardId: 'me3_62', maxHp: 170,
        evolutionStack: [], energies: [] } },
    } } }],
  };
  const card = socialCardData({ review, summary: { socialPreview: {
    localCardName: 'Drakloak', localCardId: 'sv8-5_72', opponentCardName: 'Meowth ex', opponentCardId: 'me3_62',
  } } });
  assert.equal(card.localPokemon.name, 'Dragapult ex');
  assert.equal(card.opponentPokemon.name, 'Dragapult ex');
  assert.equal(card.prizeScore, '3–0');
});

test('partial or missing starting decks retain an honest board/preview fallback', () => {
  const card = socialCardData({ review: { localPlayer: 'You', opponent: 'Them', turns: [],
    decklists: [{ ...deck(dragapult.cards), total: 59 }],
  }, summary: { socialPreview: { localCardName: 'Drakloak', localCardId: 'sv8-5_72' } } });
  assert.equal(card.localPokemon.name, 'Drakloak');
  assert.equal(card.opponentPokemon.name, 'Unknown deck');
});

test('newer Meowth artwork comes from its original bundled image, not a missing public URL', async () => {
  const original = originalCardArt('me3_62');
  assert.ok(original);
  assert.equal(original.bytes.subarray(1, 4).toString(), 'PNG');
  const resolved = await embeddedCardArt('https://invalid.example/not-used.png', 'me3_62');
  assert.deepEqual(resolved.bytes, original.bytes);
  assert.equal(resolved.layout, 'ptcgl-square');
  assert.deepEqual(resolved.bounds, { x: 37, y: 0, width: 182, height: 256, method: 'ptcgl-frame' });
  assert.equal(originalCardArt('../../secret'), undefined);
  assert.equal(originalCardArt(undefined), undefined);
  assert.deepEqual(originalCardArt('me2-5_127_ph2'), originalCardArt('me2-5_127'), 'Numbered foil variants reuse the same printing');
});

test('only small derived models are cached; concurrent requests coalesce and failures retry', async () => {
  let calls = 0;
  let now = 0;
  const loader = createSharedCardLoader(async (_id, _signal, summaryOnly) => {
    calls++;
    assert.equal(summaryOnly, false, 'Read the existing public replay, not the stale compact preview');
    return { review: { localPlayer: 'You', opponent: 'Them', turns: [], decklists: [deck(dragapult.cards)] } };
  }, () => now);
  const cards = await Promise.all([loader('same'), loader('same')]);
  assert.equal(calls, 1);
  assert.equal(cards[0].localPokemon.name, 'Dragapult ex');
  assert.equal(cards[0].review, undefined);
  assert.equal(cards[0].decklists, undefined);
  now = 300001;
  await loader('same');
  assert.equal(calls, 2);
  let failures = 0;
  const retry = createSharedCardLoader(async () => { failures++; throw new Error('temporary'); });
  await assert.rejects(retry('same'), /temporary/);
  await assert.rejects(retry('same'), /temporary/);
  assert.equal(failures, 2);
});

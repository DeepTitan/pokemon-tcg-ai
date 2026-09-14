import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publicCardArtUrl,
  representativePokemon,
  socialCardData,
} from './share-card-data.mjs';

const pokemon = (id, cardId, name, extra = {}) => ({
  id, cardId, name, cardType: 'N', maxHp: 90, damage: 0, energies: [], evolutionStack: [], ...extra,
});

test('maps PTCGL expansion ids to public card artwork', () => {
  assert.equal(publicCardArtUrl('sv6_130'), 'https://images.pokemontcg.io/sv6/130.png');
  assert.equal(publicCardArtUrl('sv8-5_72_ph'), 'https://images.pokemontcg.io/sv8pt5/72.png');
});

test('chooses the repeated deck centerpiece instead of a one-off support Pokemon', () => {
  const board = {
    active: pokemon('active', 'sv8-5_72', 'Drakloak', { evolutionStack: ['Dreepy'] }),
    bench: [
      pokemon('bench-1', 'sv8-5_72', 'Drakloak', { evolutionStack: ['Dreepy'] }),
      pokemon('bench-2', 'sv6-5_38', 'Fezandipiti ex', { maxHp: 210 }),
    ],
    discardCards: [pokemon('discard', 'sv8-5_72', 'Drakloak')],
  };
  assert.equal(representativePokemon(board).name, 'Drakloak');
});

test('builds the exact matchup summary used by social previews', () => {
  const local = pokemon('local', 'sv6_130', 'Dragapult ex', {
    maxHp: 320, evolutionStack: ['Drakloak', 'Dreepy'], energies: ['Psychic', 'Fire'],
  });
  const opponent = pokemon('opponent', 'sv8-5_72', 'Drakloak', { evolutionStack: ['Dreepy'] });
  const payload = {
    review: {
      localPlayer: 'isaiahw', opponent: '6TiramiSUI7', winner: 'isaiahw',
      localRating: 1836, opponentRating: 1783, importedAt: '2026-09-14T10:16:21.490Z',
      turns: [{ snapshot: { players: {
        isaiahw: { active: local, bench: [], discardCards: [], prizesTaken: 3 },
        '6TiramiSUI7': { active: opponent, bench: [opponent], discardCards: [opponent], prizesTaken: 0 },
      } } }],
    },
    summary: { durationSeconds: 1197, operationCount: 264 },
  };
  const card = socialCardData(payload);
  assert.equal(card.title, 'isaiahw vs. 6TiramiSUI7');
  assert.equal(card.result, 'VICTORY');
  assert.equal(card.localPokemon.name, 'Dragapult ex');
  assert.equal(card.opponentPokemon.name, 'Drakloak');
  assert.equal(card.duration, '19m');
  assert.equal(card.prizeScore, '3–0');
  assert.match(card.date, /^Sep 14 · 5:16 AM C/);
});

test('builds the thumbnail without downloading the full replay', () => {
  const card = socialCardData({
    summary: {
      localPlayer: 'isaiahw', opponent: '6TiramiSUI7', winner: 'isaiahw',
      localRating: 1836, opponentRating: 1783, importedAt: '2026-09-14T10:16:21.490Z',
      durationSeconds: 1197, operationCount: 264,
      socialPreview: {
        localCardId: 'sv6_130', localCardName: 'Dragapult ex', localPrizes: 3,
        opponentCardId: 'sv8-5_72', opponentCardName: 'Drakloak', opponentPrizes: 0,
      },
    },
  });
  assert.equal(card.title, 'isaiahw vs. 6TiramiSUI7');
  assert.equal(card.localPokemon.name, 'Dragapult ex');
  assert.equal(card.opponentPokemon.name, 'Drakloak');
  assert.equal(card.prizeScore, '3–0');
  assert.equal(card.duration, '19m');
});

import assert from 'node:assert/strict';
import { buildLeaderboardCardCatalog } from '../../scripts/leaderboard-card-catalog.js';
import { identifyDeck } from '../../src/tracker/deck-identity.js';
import { projectCloudReview } from './projector.js';
import type { CapturedDecklist, CardInfo } from '../../src/tracker/types.js';

const basic: CardInfo = { id: 'svbsp_189', name: "N's Zorua", hp: 70, category: 1, cardType: 'D' };
const evolution: CardInfo = { id: 'sv9_185', name: "N's Zoroark ex", hp: 280, category: 1,
  cardType: 'D', evolvesFrom: "N's Zorua", actions: [
    { kind: 'ability', name: 'Trade', text: 'Draw 2 cards.', cost: '', damage: '' },
    { kind: 'attack', name: 'Night Joker', text: 'Choose another attack.', cost: 'DD', damage: '' },
  ] };
const energy: CardInfo = { id: 'sve_23', name: 'Basic Darkness Energy', category: 3 };
const knownPrint = { ...evolution, id: 'sv9_98', imagePath: '/known-art/sv9_98.png' };
const historical = [basic, knownPrint, energy];
const printed = [basic, evolution, { ...knownPrint, imagePath: undefined }, energy];
const deck: CapturedDecklist = { playerName: 'Opponent', playerId: 'opponent', source: 'match-start', total: 60,
  cards: [{ cardId: basic.id, count: 4 }, { cardId: evolution.id, count: 4 }, { cardId: energy.id, count: 52 }] };

const incomplete = identifyDeck(deck, new Map(historical.map(card => [card.id, card])));
assert.equal(incomplete.card?.name, "N's Zorua", 'Reproduce the missing alternate-print regression');
assert.deepEqual(incomplete.unresolvedCardIds, ['sv9_185']);

const catalog = buildLeaderboardCardCatalog(printed, historical);
const resolved = identifyDeck(deck, catalog);
assert.equal(resolved.card?.name, "N's Zoroark ex");
assert.equal(resolved.card?.cardId, 'sv9_185', 'Keep the actual captured printing');
assert.equal(resolved.confidence, 'recognized');
assert.deepEqual(resolved.unresolvedCardIds, []);
assert.equal(catalog.get('sv9_185')?.imagePath, undefined, 'Printed metadata does not invent available art');
assert.equal(catalog.get('SV9_98')?.imagePath, knownPrint.imagePath, 'Retain known art and case-insensitive lookup');

for (const finish of ['ph', 'ph2', 'sph', 'sph2']) {
  const id = `sv9_185_${finish}`;
  assert.equal(catalog.get(id)?.id, id);
  assert.equal(catalog.get(id)?.actions?.[1].name, 'Night Joker');
  assert.equal(catalog.get(id)?.imagePath, undefined);
  assert.equal(identifyDeck({ ...deck, cards: deck.cards.map(card =>
    card.cardId === 'sv9_185' ? { ...card, cardId: id } : card) }, catalog).confidence, 'recognized');
}
assert.equal(catalog.get('sv9_999'), undefined, 'Do not infer another collector number from its species');
assert.equal(catalog.get('sv9_185_unknown'), undefined, 'Do not resolve arbitrary suffixes');
assert.equal(catalog.get('sv9_98_ph')?.imagePath, undefined, 'Base art is not proof that a finish-specific file exists');

const historicalOnly: CardInfo = { id: 'future_1', name: 'Future Pokémon', category: 1, hp: 90 };
const merged = buildLeaderboardCardCatalog(printed, [
  ...historical, historicalOnly,
  { ...evolution, hp: 1, evolvesFrom: 'Incorrect cached parent', imagePath: '/known-art/sv9_185.png' },
  { ...evolution, id: 'sv9_185_ph', hp: 2, imagePath: '/known-art/sv9_185_ph.png' },
]);
assert.equal(merged.get('sv9_185')?.hp, 280, 'Complete printed mechanics replace stale historical mechanics');
assert.equal(merged.get('sv9_185')?.evolvesFrom, "N's Zorua");
assert.equal(merged.get('sv9_185')?.imagePath, '/known-art/sv9_185.png');
assert.equal(merged.get('sv9_185_ph')?.hp, 280, 'Historical foil records get exact base printing mechanics');
assert.equal(merged.get('sv9_185_ph')?.imagePath, '/known-art/sv9_185_ph.png');
assert.deepEqual(merged.get('future_1'), historicalOnly, 'Keep valid historical records absent from this catalog version');

const projection = projectCloudReview({ sourceKey: 'fixture', matchId: 'catalog-fixture', catalog, review: {
  id: 'catalog-fixture', source: 'live-network', localPlayer: 'Recorder', opponent: 'Opponent', winner: 'Opponent',
  importedAt: '2026-09-16T12:00:00Z', localRating: 1800, opponentRating: 1800,
  decklists: [deck], rawLog: 'PRIVATE LOG', turns: [],
} });
const history = projection.review.history as { players: Record<string, { pokemon: { name: string; cardId: string; artCardId: string } }> };
assert.deepEqual(history.players.Opponent.pokemon, {
  name: "N's Zoroark ex", cardId: 'sv9_185', artCardId: 'sv9_98',
}, 'Cloud projection classifies the exact print and selects available cosmetic art');
assert.equal('decklists' in projection.review, false);
assert.equal('rawLog' in projection.review, false);
assert.equal(JSON.stringify(projection).includes('PRIVATE LOG'), false);
assert.equal(JSON.stringify(projection).includes('/known-art/'), false);

console.log('Leaderboard catalog: complete printing metadata, foil resolution, known art, and private-data omission verified');

import assert from 'node:assert/strict';
import { projectHistoryPreview, mergeHistoryPreviews } from '../leaderboard-history-preview.js';
import { buildLeaderboardCardCatalog } from '../leaderboard-card-catalog.js';

const catalog = buildLeaderboardCardCatalog([
  { id: 'sv6_130', name: 'Dragapult ex', category: 1, hp: 320 },
  { id: 'sv6-5_70', name: 'Fezandipiti ex', category: 1, hp: 210 },
], [{ id: 'sv6_200', name: 'Dragapult ex', category: 1, hp: 320, imagePath: '/private/art/sv6_200.png' }]);
const board = (id?: string, prizesTaken = 0) => ({
  name: 'Alice', active: id ? { id: 'instance', cardId: id, name: id, maxHp: 320, energies: [], evolutionStack: [] } : null,
  bench: [], discardCards: [], prizesTaken, prizesKnown: true,
  knownHand: ['PRIVATE HAND'], deckCards: ['PRIVATE DECK'],
});
const review = { localPlayer: 'Alice', opponent: 'Bob', rawLog: 'PRIVATE LOG', durationSeconds: 60,
  turns: [{ snapshot: { players: { Alice: board('SV6_130_PH'), Bob: board('sv6-5_70') } } }],
};
const original = JSON.stringify(review);
const preview = projectHistoryPreview(review, catalog)!;
assert.deepEqual(preview.players.Alice.pokemon, {
  name: 'Dragapult ex', cardId: 'SV6_130_PH', artCardId: 'sv6_200',
}, 'Resolve an unhydrated board name and select known art by the resolved name');
assert.equal(preview.players.Bob.pokemon?.name, 'Fezandipiti ex', 'Resolve IDs with a hyphenated set code');
assert.equal(JSON.stringify(review), original, 'Projection must not rewrite the capture');
assert.ok(!/PRIVATE|private\/art/.test(JSON.stringify(preview)), 'Only thumbnail metadata may leave the archive');

const terminal = { snapshot: { players: { Alice: board(undefined, 5), Bob: board('sv6-5_70', 2) } } };
const recovered = projectHistoryPreview({ ...review, turns: [...review.turns, terminal] }, catalog)!;
assert.deepEqual(recovered.players.Alice.pokemon, preview.players.Alice.pokemon, 'Recover a cleared terminal board from the same player’s earlier public board');
assert.equal(recovered.players.Alice.prizesTaken, 5, 'Earlier Pokémon evidence must not rewind the final prize score');
assert.equal(recovered.players.Bob.prizesTaken, 2);

const empty = projectHistoryPreview({ ...review, turns: [terminal] }, catalog)!;
assert.equal(empty.players.Alice.pokemon, undefined, 'An opponent’s Pokémon and a hidden hand are not own-board evidence');
const opaque = projectHistoryPreview({ ...review, turns: [{ snapshot: { players: { Alice: board('future-set_999') } } }] }, catalog)!;
assert.equal(opaque.players.Alice.pokemon, undefined, 'Do not publish an unresolved asset ID as a Pokémon name');

const stale = { players: { Alice: { pokemon: { name: 'sv6_130', cardId: 'sv6_130' } } } };
assert.deepEqual(mergeHistoryPreviews([stale, preview])?.players.Alice.pokemon, preview.players.Alice.pokemon);
assert.deepEqual(mergeHistoryPreviews([stale, preview]), mergeHistoryPreviews([preview, stale]), 'An unresolved duplicate must not win by lexical or input order');
assert.equal(mergeHistoryPreviews([preview, { players: { Alice: { prizesTaken: 6 } } }])?.players.Alice.prizesTaken, undefined);
console.log('History preview: catalog names, foil IDs, art, empty final boards, identity, privacy and duplicate merge verified');

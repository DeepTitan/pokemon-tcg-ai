import assert from 'node:assert/strict';
import { capturedDecklists } from '../captured-decklists.js';
import { collectCardSourceIds } from '../match-storage.js';
const player = { playerName: 'Opponent', playerId: 'p2', deckSize: 60, deckInfo: { cards: { SV1_1: 4, sve_1: 56 } } };
assert.equal(capturedDecklists({ players: [player] })[0].total, 60);
assert.equal(capturedDecklists({ players: [player] })[0].cards[0].cardId, 'sv1_1');
for (const cards of [{ sv1_1: 4 }, { sv1_1: 60.5 }, { sv1_1: -1, sve_1: 61 }, { sv1_1: '60' }, {}]) {
  assert.deepEqual(capturedDecklists({ players: [{ ...player, deckInfo: { cards } }] }), []);
}
assert.deepEqual(capturedDecklists({ players: [{ ...player, deckSize: 59 }] }), []);
assert.deepEqual(capturedDecklists({ players: [{ ...player, playerId: '' }] }), []);
assert.deepEqual(capturedDecklists({ players: [{ ...player, deckInfo: { cards: { SV1_1: 30, sv1_1: 30 } } }] }), []);
assert.deepEqual(capturedDecklists({ updatedEntities: [{ cardSourceID: 'sv1_1' }] }), []);
assert.ok(collectCardSourceIds({ operation: { players: [player] } }).has('sv1_1'));
console.log('captured decklist tests passed');

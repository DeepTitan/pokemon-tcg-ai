import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBattleLog } from '../battle-log-parser.js';

const fixture = '/Users/theisaiahw/.codex/attachments/e3b6f214-ea79-43f9-b1b6-c00ae5ad4173/pasted-text.txt';
const review = parseBattleLog(readFileSync(fixture, 'utf8'));

assert.deepEqual(review.players, ['isaiahw', 'Yo_Allan']);
assert.equal(review.localPlayer, 'isaiahw');
assert.equal(review.opponent, 'Yo_Allan');
assert.equal(review.winner, 'Yo_Allan');
assert.equal(review.turns.length, 14);

const setup = review.turns[0].snapshot;
assert.equal(setup.players.isaiahw.active?.name, 'Dreepy');
assert.equal(setup.players.Yo_Allan.active?.name, 'Latias ex');

const firstIsaiahTurn = review.turns[2].snapshot;
assert.equal(firstIsaiahTurn.players.isaiahw.active?.name, 'Budew');
assert.equal(firstIsaiahTurn.players.Yo_Allan.active?.name, 'Latias ex');
assert.equal(firstIsaiahTurn.stadium, 'Risky Ruins');

const final = review.turns.at(-1)!.snapshot;
assert.equal(final.winner, 'Yo_Allan');
assert.equal(final.players.Yo_Allan.prizesTaken, 6);
assert.equal(final.players.isaiahw.active, null);

console.log(`battle-log-parser: ${review.turns.length - 1} turns reconstructed successfully`);

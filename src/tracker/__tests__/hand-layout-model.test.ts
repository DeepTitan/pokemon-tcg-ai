import assert from 'node:assert/strict';
import { handFanCardCount, opponentHandFanSlots } from '../hand-layout-model.js';

assert.equal(handFanCardCount(0), 0);
assert.equal(handFanCardCount(14), 14);
assert.equal(handFanCardCount(60), 60);
assert.equal(handFanCardCount(-1), 0);

assert.deepEqual(opponentHandFanSlots(0), ['empty']);
assert.deepEqual(opponentHandFanSlots(1), ['hidden']);
assert.equal(opponentHandFanSlots(6).length, 6);
assert.equal(opponentHandFanSlots(13).length, 10);
assert.deepEqual(opponentHandFanSlots(-1), ['empty']);

console.log('hand-layout-model: every local card remains visible and the opponent fan stays compact');

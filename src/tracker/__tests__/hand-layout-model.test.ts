import assert from 'node:assert/strict';
import { opponentHandFanSlots } from '../hand-layout-model.js';

assert.deepEqual(opponentHandFanSlots(0), ['empty']);
assert.deepEqual(opponentHandFanSlots(1), ['hidden']);
assert.equal(opponentHandFanSlots(6).length, 6);
assert.equal(opponentHandFanSlots(13).length, 10);
assert.deepEqual(opponentHandFanSlots(-1), ['empty']);

console.log('hand-layout-model: opponent hand fan stays proportional and compact');

import assert from 'node:assert/strict';
import { prizeSlotStates } from '../prize-layout-model.js';

assert.deepEqual(prizeSlotStates(6), ['remaining', 'remaining', 'remaining', 'remaining', 'remaining', 'remaining']);
assert.deepEqual(prizeSlotStates(1), ['remaining']);
assert.deepEqual(prizeSlotStates(0), []);
assert.deepEqual(prizeSlotStates(99), ['remaining', 'remaining', 'remaining', 'remaining', 'remaining', 'remaining']);
assert.deepEqual(prizeSlotStates(-1), []);

console.log('prize-layout-model: only remaining Prize cards receive visible slots');

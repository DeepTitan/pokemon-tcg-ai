import assert from 'node:assert/strict';
import { prizeSlotStates } from '../prize-layout-model.js';

assert.deepEqual(prizeSlotStates(6), ['remaining', 'remaining', 'remaining', 'remaining', 'remaining', 'remaining']);
assert.deepEqual(prizeSlotStates(1), ['remaining', 'taken', 'taken', 'taken', 'taken', 'taken']);
assert.deepEqual(prizeSlotStates(0), ['taken', 'taken', 'taken', 'taken', 'taken', 'taken']);
assert.deepEqual(prizeSlotStates(99), ['remaining', 'remaining', 'remaining', 'remaining', 'remaining', 'remaining']);
assert.deepEqual(prizeSlotStates(-1), ['taken', 'taken', 'taken', 'taken', 'taken', 'taken']);

console.log('prize-layout-model: six stable slots show remaining and taken Prize cards');

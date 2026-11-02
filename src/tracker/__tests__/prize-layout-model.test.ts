import assert from 'node:assert/strict';
import { prizeSlotStates } from '../prize-layout-model.js';

assert.deepEqual(prizeSlotStates(6), ['remaining', 'remaining', 'remaining', 'remaining', 'remaining', 'remaining']);
assert.deepEqual(prizeSlotStates(1), ['remaining', 'taken', 'taken', 'taken', 'taken', 'taken']);
assert.deepEqual(prizeSlotStates(0), Array(6).fill('taken'));
assert.deepEqual(prizeSlotStates(99), ['remaining', 'remaining', 'remaining', 'remaining', 'remaining', 'remaining']);
assert.deepEqual(prizeSlotStates(-1), Array(6).fill('taken'));

console.log('prize-layout-model: six Prize slots retain silhouettes for taken cards');

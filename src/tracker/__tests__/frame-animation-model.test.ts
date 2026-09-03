import assert from 'node:assert/strict';
import { frameAnimationsFromStoredPreference, frameCardTransitionName } from '../frame-animation-model.js';

assert.equal(frameAnimationsFromStoredPreference(null), true, 'replay motion should be on for new installs');
assert.equal(frameAnimationsFromStoredPreference('on'), true);
assert.equal(frameAnimationsFromStoredPreference('off'), false);

assert.equal(frameCardTransitionName('card:one'), frameCardTransitionName('card:one'));
assert.notEqual(frameCardTransitionName('card:one'), frameCardTransitionName('card/one'), 'sanitized IDs still need collision protection');
assert.match(frameCardTransitionName('831cf834-ddad-4799-8670-3b8a0ce89dc6'), /^trace-card-[a-z0-9_-]+$/);

console.log('frame-animation-model: persistent motion preference and stable card transition names');

import assert from 'node:assert/strict';
import { frameAnimationsFromStoredPreference, frameCardTransitionName, frameNavigationMode, resolveFrameNavigationTarget } from '../frame-animation-model.js';

assert.equal(frameAnimationsFromStoredPreference(null), false, 'replay motion should be off for new installs');
assert.equal(frameAnimationsFromStoredPreference('on'), true);
assert.equal(frameAnimationsFromStoredPreference('off'), false);
assert.equal(frameAnimationsFromStoredPreference('unexpected'), false, 'unknown legacy values should keep motion off');

let rapidTarget = 14;
for (let click = 0; click < 5; click += 1) {
  rapidTarget = resolveFrameNavigationTarget(rapidTarget, (current) => current + 1, 20);
}
assert.equal(rapidTarget, 19, 'rapid navigation should accumulate from the requested frame');
assert.equal(resolveFrameNavigationTarget(rapidTarget, (current) => current + 5, 20), 20, 'rapid navigation should clamp at the last frame');
assert.equal(resolveFrameNavigationTarget(3, -4, 20), 0, 'absolute navigation should clamp at the first frame');

assert.equal(frameNavigationMode(true, false, false, false), 'animate');
assert.equal(frameNavigationMode(true, false, true, false), 'scrub', 'new input must interrupt an active transition');
assert.equal(frameNavigationMode(true, false, false, true), 'scrub', 'a rapid input burst must remain unbuffered');
assert.equal(frameNavigationMode(false, false, true, false), 'instant');
assert.equal(frameNavigationMode(true, true, true, false), 'instant');

assert.equal(frameCardTransitionName('card:one'), frameCardTransitionName('card:one'));
assert.notEqual(frameCardTransitionName('card:one'), frameCardTransitionName('card/one'), 'sanitized IDs still need collision protection');
assert.match(frameCardTransitionName('831cf834-ddad-4799-8670-3b8a0ce89dc6'), /^trace-card-[a-z0-9_-]+$/);

console.log('frame-animation-model: persistent motion preference, interruptible navigation, and stable card transition names');

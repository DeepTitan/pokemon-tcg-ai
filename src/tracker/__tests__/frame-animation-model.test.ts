import assert from 'node:assert/strict';
import { frameAnimationsFromStoredPreference, frameCardTransitionName, frameNavigationMode, replayFrameDelay, resolveFrameNavigationTarget } from '../frame-animation-model.js';

assert.equal(frameAnimationsFromStoredPreference(null), true, 'replay motion should be on for new installs');
assert.equal(frameAnimationsFromStoredPreference('on'), true);
assert.equal(frameAnimationsFromStoredPreference('off'), false);
assert.equal(frameAnimationsFromStoredPreference('unexpected'), true, 'unknown values should use the enabled default');

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
assert.equal(frameNavigationMode(true, false, false, false, { compact: true, playback: true }), 'animate', 'Mobile Play must animate rather than follow the instant scrubbing path');
assert.equal(frameNavigationMode(true, false, true, false, { compact: true, playback: false }), 'instant', 'Mobile taps and holds must still interrupt animation immediately');
assert.equal(frameNavigationMode(false, false, false, false, { compact: true, playback: true }), 'instant', 'Playback respects disabled animations');
assert.equal(frameNavigationMode(true, true, false, false, { compact: true, playback: true }), 'instant', 'Playback respects reduced motion');
assert.equal(replayFrameDelay(false, false, true), 600);
assert.equal(replayFrameDelay(true, false, true), 1200);
assert.equal(replayFrameDelay(false, true, true), 900);
assert.equal(replayFrameDelay(true, true, true), 1200, 'An attack at a turn boundary gets enough time for its impact');
assert.equal(replayFrameDelay(true, false, true, 2), 600);
assert.equal(replayFrameDelay(false, false, true, 0), 600, 'Invalid speeds must not produce an infinite timer');
assert.equal(replayFrameDelay(false, false, false, 2), 1200, 'Mobile speed controls do not change desktop timing');

assert.equal(frameCardTransitionName('card:one'), frameCardTransitionName('card:one'));
assert.notEqual(frameCardTransitionName('card:one'), frameCardTransitionName('card/one'), 'sanitized IDs still need collision protection');
assert.match(frameCardTransitionName('831cf834-ddad-4799-8670-3b8a0ce89dc6'), /^trace-card-[a-z0-9_-]+$/);

console.log('frame-animation-model: persistent motion preference, interruptible navigation, and stable card transition names');

import assert from 'node:assert/strict';
import { turnPassForTurn } from '../turn-pass-model.js';
import type { TrackedTurn, TrackerEvent } from '../types.js';

const event = (text: string, actor = 'Alex', action?: string): TrackerEvent => ({
  id: `event:${text}`,
  turnIndex: 3,
  actor,
  text,
  detail: false,
  kind: 'system',
  facts: action ? [{ id: `fact:${action}`, kind: 'actor', label: 'Action', value: action }] : undefined,
});

const turn = (events: TrackerEvent[], player: string | undefined = 'Alex'): TrackedTurn => ({
  index: 3,
  label: 'Turn 2 · Action 3',
  player,
  events,
  snapshot: { players: {}, stadium: null },
});

const players = ['Alex', 'Blair'];

assert.deepEqual(turnPassForTurn(turn([event('Alex: End turn', 'Alex', 'End turn')]), players), {
  passer: 'Alex',
  receiver: 'Blair',
  reason: 'passed',
});

assert.deepEqual(turnPassForTurn(turn([event('Alex: ended their turn')]), players), {
  passer: 'Alex',
  receiver: 'Blair',
  reason: 'passed',
}, 'readable saved-review copy remains detectable');

assert.deepEqual(turnPassForTurn(turn([event('Blair: End turn timeout', 'Blair', 'End turn timeout')], 'Blair'), players), {
  passer: 'Blair',
  receiver: 'Alex',
  reason: 'timeout',
});

assert.deepEqual(turnPassForTurn(turn([event('Blair timed out', '', 'Timeout')], ''), players), {
  passer: 'Blair',
  receiver: 'Alex',
  reason: 'timeout',
}, 'the actor can be recovered from legacy text');

assert.equal(turnPassForTurn(turn([{ ...event('Alex: End turn'), kind: 'attack' }]), players), null, 'attack frames never masquerade as passes');
assert.equal(turnPassForTurn(turn([event('Alex: drew a card', 'Alex', 'Use')]), players), null);

console.log('turn-pass-model: voluntary passes, timeouts, legacy copy, and attack exclusions');

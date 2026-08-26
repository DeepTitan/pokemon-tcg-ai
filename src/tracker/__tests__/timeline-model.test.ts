import assert from 'node:assert/strict';
import { buildTimeline, eventKeyForReviewIndex } from '../timeline-model.js';
import type { TrackedTurn, TrackerEventKind } from '../types.js';

function event(id: string, turnIndex: number, kind: TrackerEventKind, text: string, detail = false) {
  return { id, turnIndex, kind, text, detail };
}

const emptySnapshot = { players: {}, stadium: null };
const turns: TrackedTurn[] = [
  { index: 0, label: 'Capture baseline', events: [], snapshot: emptySnapshot },
  { index: 1, label: 'Turn 1 · Action 1', player: 'Isaiah', events: [event('same-id', 1, 'draw', 'Drew a card')], snapshot: emptySnapshot },
  { index: 2, label: 'Turn 1 · Action 2', player: 'Isaiah', events: [event('same-id', 2, 'trainer', 'Played a Trainer'), event('detail', 2, 'system', 'Internal detail', true)], snapshot: emptySnapshot },
  { index: 3, label: 'Turn 2 · Action 3', player: 'Riley', events: [event('attack', 3, 'attack', 'Used an attack')], snapshot: emptySnapshot },
];

const timeline = buildTimeline(turns);
assert.equal(timeline.entries.length, 3, 'keeps every public event without truncating the match');
assert.equal(new Set(timeline.entries.map((entry) => entry.key)).size, 3, 'keys stay unique even when raw event ids repeat');
assert.deepEqual(timeline.entries.map((entry) => entry.position), [1, 2, 3], 'assigns stable match-wide event numbers');
assert.deepEqual(timeline.groups.map((group) => group.label), ['Turn 1', 'Turn 2'], 'groups actions under their game turn');
assert.equal(timeline.groups[0].entries.length, 2);
assert.equal(eventKeyForReviewIndex(timeline.entries, 2), '2:same-id', 'selects the event belonging to the requested replay position');
assert.equal(eventKeyForReviewIndex(timeline.entries, 4), '3:attack', 'keeps the latest public event selected when a later replay position has no event');
assert.equal(eventKeyForReviewIndex(timeline.entries, 0), null, 'supports replay positions without visible events');

console.log('timeline-model: full history, stable keys, turn groups, replay selection');

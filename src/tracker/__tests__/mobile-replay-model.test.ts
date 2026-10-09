import assert from 'node:assert/strict';
import { buildReviewChapters, reviewBenchSlots } from '../mobile-replay-model.js';
import { resolveFrameNavigationTarget } from '../frame-animation-model.js';
import type { TrackedTurn } from '../types.js';

const frame = (label: string, player?: string) => ({ label, player } as TrackedTurn);
const chapters = buildReviewChapters([
  frame('Partial capture'), frame('Turn 1 · Action 1', 'isaiahw'),
  frame('Turn 1 · Action 2', 'isaiahw'), frame('Turn 1 · Action 3', 'NeetLv999'),
  frame('Turn 1 · Action 4', 'NeetLv999'), frame('Turn 2 · Action 5', 'isaiahw'),
]);
assert.equal(chapters.length, 3, 'One jump per recorded turn boundary, not one per actor switch');
assert.deepEqual(chapters.map(chapter => [chapter.players, chapter.first, chapter.last]), [
  [[], 0, 0], [['isaiahw', 'NeetLv999'], 1, 4], [['isaiahw'], 5, 5],
]);
assert.deepEqual(buildReviewChapters([]), []);
const handoff = buildReviewChapters([frame('Turn 2 · Action 16', 'NeetLv999'), frame('Turn 2 · Action 17', 'isaiahw')]);
assert.equal(handoff.length, 1, 'A handoff frame must not invent an extra turn');
assert.deepEqual(handoff[0].players, ['NeetLv999', 'isaiahw']);
const expandedBench = Array.from({ length: 8 }, (_, index) => ({ id: `pokemon-${index}` }));
assert.deepEqual(reviewBenchSlots(expandedBench), expandedBench, 'Area Zero benches must not silently lose Pokémon');
assert.equal(reviewBenchSlots([]).length, 5);
assert.deepEqual(reviewBenchSlots(['a']), ['a', null, null, null, null]);
let requested = 30;
for (let tap = 0; tap < 10; tap++) requested = resolveFrameNavigationTarget(requested, frame => frame + 1, 103);
assert.equal(requested, 40, 'Rapid input advances from the requested frame, without losing taps');
assert.equal(resolveFrameNavigationTarget(103, frame => frame + 1, 103), 103);
assert.equal(resolveFrameNavigationTarget(0, frame => frame - 1, 103), 0);
console.log('mobile-replay-model: recorded turn boundaries, expanded benches, rapid steps and boundaries verified');

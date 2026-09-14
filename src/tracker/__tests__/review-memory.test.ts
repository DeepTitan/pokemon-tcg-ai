import assert from 'node:assert/strict';
import { compactStoredReview } from '../review-memory.js';
import { finalizeReviewForClientExit } from '../match-storage.js';
import type { MatchReview } from '../types.js';

const source = {
  id: 'memory-test', source: 'live-network', importedAt: '2026-09-14T00:00:00Z',
  players: ['A', 'B'], localPlayer: 'A', opponent: 'B', rawLog: '',
  turns: Array.from({ length: 100 }, (_, index) => ({
    index, label: 'Turn 1', events: [], snapshot: { players: {}, stadium: null },
    choiceCards: [
      { id: 'entity-1', cardId: 'sv6_130', name: 'Dragapult ex' },
      { id: 'entity-2', cardId: 'sv6_130', name: 'Dragapult ex' },
    ],
  })),
} satisfies MatchReview;
const json = JSON.stringify(source);
const review = compactStoredReview(JSON.parse(json));
assert.equal(JSON.stringify(review), json, 'all values and property order survive unchanged');
assert.strictEqual(review.turns[0].snapshot, review.turns[99].snapshot);
assert.strictEqual(review.turns[0].choiceCards, review.turns[99].choiceCards);
assert.notStrictEqual(review.turns[0].choiceCards![0], review.turns[0].choiceCards![1], 'same art does not merge distinct entities');
assert.notStrictEqual(review.turns[0].events, review.turns[0].snapshot.players, 'empty arrays and objects stay distinct');
assert.throws(() => { review.turns[0].choiceCards![0].name = 'changed'; }, TypeError);
assert.equal(review.turns[99].choiceCards![0].name, 'Dragapult ex');
assert.notStrictEqual(compactStoredReview(JSON.parse(json)).turns[0].snapshot, review.turns[0].snapshot, 'no cross-match retention');
const changed = JSON.parse(json) as MatchReview;
changed.turns[1].choiceCards![0].name = 'Changed card';
changed.turns[2].choiceCards!.reverse();
const changedJson = JSON.stringify(changed);
const distinct = compactStoredReview(changed);
assert.equal(JSON.stringify(distinct), changedJson);
assert.notStrictEqual(distinct.turns[0].choiceCards, distinct.turns[1].choiceCards, 'changed values are not merged');
assert.notStrictEqual(distinct.turns[0].choiceCards, distinct.turns[2].choiceCards, 'different array order is preserved');
const finalized = finalizeReviewForClientExit(review);
assert.equal(finalized.winner, 'B');
assert.equal(finalized.turns.length, 101);
assert.equal(JSON.stringify(review), json, 'existing finalization works without mutating shared frames');
console.log('review-memory: lossless sharing, identity, immutability, load isolation, and finalization passed');

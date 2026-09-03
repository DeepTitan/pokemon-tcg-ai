import assert from 'node:assert/strict';
import { buildKeyMoments, keyMomentReasons, stepKeyMoment } from '../key-moment-navigation.js';
import type { CanonicalReviewState, MatchReview, TrackerEventKind, TrackedTurn } from '../types.js';

const canonical = (currentPlayer: 0 | 1): CanonicalReviewState => ({
  playerNames: ['Alex', 'Blair'],
  localPlayerIndex: 0,
  state: { currentPlayer } as CanonicalReviewState['state'],
  visibility: {},
  appliedEffects: {},
  selections: [],
});

const turn = (
  index: number,
  currentPlayer: 0 | 1,
  kinds: TrackerEventKind[] = [],
  eventText = 'Resolved an action',
): TrackedTurn => ({
  index,
  label: `Turn ${Math.floor((index - 1) / 4) + 1} · Action ${index}`,
  player: currentPlayer === 0 ? 'Alex' : 'Blair',
  events: kinds.map((kind, eventIndex) => ({
    id: `${kind}-${index}-${eventIndex}`,
    turnIndex: index,
    actor: currentPlayer === 0 ? 'Alex' : 'Blair',
    text: eventText,
    detail: false,
    kind,
  })),
  snapshot: { players: {}, stadium: null },
  canonical: canonical(currentPlayer),
});

const gameOver = turn(9, 0, ['system'], 'Game over — Alex won');
gameOver.snapshot.winner = 'Alex';

const review: MatchReview = {
  id: 'key-moment-test',
  importedAt: '',
  source: 'live-network',
  players: ['Alex', 'Blair'],
  localPlayer: 'Alex',
  opponent: 'Blair',
  rawLog: '',
  turns: [
    { ...turn(0, 0), label: 'Capture baseline', player: undefined },
    turn(1, 0, ['trainer']),
    turn(2, 0, ['attack', 'damage']),
    turn(3, 0, ['coin']),
    turn(4, 1, ['attack', 'damage', 'knockout', 'prize']),
    turn(5, 1, ['damage']),
    turn(6, 1, ['ability', 'knockout', 'prize']),
    { ...turn(7, 0), choiceLabel: 'Attacked with Phantom Dive' },
    turn(8, 0, ['system'], 'Blair took 2 Prize cards'),
    gameOver,
  ],
};

const moments = buildKeyMoments(review);
assert.deepEqual(moments.map((moment) => moment.reviewIndex), [2, 4, 5, 6, 7, 8, 9]);
assert.deepEqual(
  moments.find((moment) => moment.reviewIndex === 4)?.reasons,
  ['attack', 'damage', 'knockout', 'prize'],
  'an attack that takes Prizes is one rich stop, not four duplicate stops',
);
assert.deepEqual(keyMomentReasons(review.turns[1]), [], 'routine plays do not clutter the highlight reel');
assert.deepEqual(keyMomentReasons(review.turns[6]), ['knockout', 'prize'], 'ability KOs remain key moments without an attack event');
assert.deepEqual(keyMomentReasons(review.turns[8]), ['prize'], 'legacy prize text remains navigable');
assert.deepEqual(keyMomentReasons(review.turns[9]), ['game-over'], 'the result is always the final highlight');

assert.equal(stepKeyMoment(moments, 0, 1), 2, 'down before the first moment lands on it');
assert.equal(stepKeyMoment(moments, 2, 1), 4);
assert.equal(stepKeyMoment(moments, 3, 1), 4, 'down between moments moves strictly forward');
assert.equal(stepKeyMoment(moments, 9, 1), 9, 'down at the end never jumps backward');
assert.equal(stepKeyMoment(moments, 10, 1), 10, 'down after the final moment stays put');
assert.equal(stepKeyMoment(moments, 9, -1), 8);
assert.equal(stepKeyMoment(moments, 3, -1), 2, 'up between moments moves strictly backward');
assert.equal(stepKeyMoment(moments, 0, -1), 0, 'up before the first moment never jumps forward');
assert.equal(stepKeyMoment([], 6, 1), 6, 'matches without moments leave the current frame unchanged');

console.log('key-moment-navigation: attacks, damage, knockouts, Prizes, results, and directional edges');

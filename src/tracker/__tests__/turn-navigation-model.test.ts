import assert from 'node:assert/strict';
import { buildPlayerTurnStops, stepPlayerTurn } from '../turn-navigation-model.js';
import type { CanonicalReviewState, MatchReview, TrackedTurn } from '../types.js';

const canonical = (currentPlayer: 0 | 1): CanonicalReviewState => ({
  playerNames: ['Alex', 'Blair'],
  localPlayerIndex: 0,
  state: { currentPlayer } as CanonicalReviewState['state'],
  visibility: {},
  appliedEffects: {},
  selections: [],
});

const turn = (index: number, currentPlayer: 0 | 1, actor = currentPlayer === 0 ? 'Alex' : 'Blair'): TrackedTurn => ({
  index,
  label: `Turn ${Math.floor((index - 1) / 4) + 1} · Action ${index}`,
  player: actor,
  events: [],
  snapshot: { players: {}, stadium: null },
  canonical: canonical(currentPlayer),
});

const review: MatchReview = {
  id: 'navigation-test',
  importedAt: '',
  source: 'live-network',
  players: ['Alex', 'Blair'],
  localPlayer: 'Alex',
  opponent: 'Blair',
  rawLog: '',
  turns: [
    { ...turn(0, 0), label: 'Capture baseline', player: undefined },
    turn(1, 0), turn(2, 0), turn(3, 0, 'Blair'),
    turn(4, 1), turn(5, 1), turn(6, 1),
    turn(7, 0), turn(8, 0), turn(9, 0),
  ],
};

const stops = buildPlayerTurnStops(review);
assert.deepEqual(stops, [1, 4, 7, 9], 'alternates player-turn starts and always ends on the final action');
assert.equal(stepPlayerTurn(stops, 1, 1), 4);
assert.equal(stepPlayerTurn(stops, 4, 1), 7);
assert.equal(stepPlayerTurn(stops, 7, 1), 9, 'the final action is reachable after the final turn start');
assert.equal(stepPlayerTurn(stops, 9, -1), 7, 'up from the final action returns to that player turn start');
assert.equal(stepPlayerTurn(stops, 6, -1), 4, 'up from the middle of a turn returns to its start');

console.log('turn-navigation-model: alternating player turns and final action');

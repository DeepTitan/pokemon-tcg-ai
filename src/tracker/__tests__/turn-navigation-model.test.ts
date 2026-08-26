import assert from 'node:assert/strict';
import { buildAttackStops, stepAttack } from '../turn-navigation-model.js';
import type { CanonicalReviewState, MatchReview, TrackedTurn } from '../types.js';

const canonical = (currentPlayer: 0 | 1): CanonicalReviewState => ({
  playerNames: ['Alex', 'Blair'],
  localPlayerIndex: 0,
  state: { currentPlayer } as CanonicalReviewState['state'],
  visibility: {},
  appliedEffects: {},
  selections: [],
});

const turn = (index: number, currentPlayer: 0 | 1, attack = false): TrackedTurn => ({
  index,
  label: `Turn ${Math.floor((index - 1) / 4) + 1} · Action ${index}`,
  player: currentPlayer === 0 ? 'Alex' : 'Blair',
  events: attack ? [{
    id: `attack-${index}`,
    turnIndex: index,
    actor: currentPlayer === 0 ? 'Alex' : 'Blair',
    text: 'Used an attack',
    detail: false,
    kind: 'attack',
  }] : [],
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
    turn(1, 0), turn(2, 0, true), turn(3, 0),
    turn(4, 1), turn(5, 1, true), turn(6, 1),
    turn(7, 0), turn(8, 0, true),
    { ...turn(9, 0), choiceLabel: 'Attacked with Phantom Dive' },
  ],
};

const stops = buildAttackStops(review);
assert.deepEqual(stops, [2, 5, 8, 9], 'includes every structured and legacy attack frame');
assert.equal(stepAttack(stops, 0, 1), 2, 'down before the first attack lands on it');
assert.equal(stepAttack(stops, 2, 1), 5);
assert.equal(stepAttack(stops, 6, 1), 8, 'down between attacks lands on the next one');
assert.equal(stepAttack(stops, 9, 1), 9, 'down on the final attack stays there');
assert.equal(stepAttack(stops, 9, -1), 8);
assert.equal(stepAttack(stops, 7, -1), 5, 'up between attacks lands on the previous one');
assert.equal(stepAttack(stops, 0, -1), 2, 'up before the first attack clamps to it');
assert.equal(stepAttack([], 6, 1), 6, 'matches without attacks leave the current frame unchanged');

console.log('turn-navigation-model: previous and next attack navigation');

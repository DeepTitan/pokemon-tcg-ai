import assert from 'node:assert/strict';
import { eloExpectedScore, replayEloRatings } from '../legacy-elo.js';
import { type RatingMatchEvent } from '../rating.js';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const match = (id: string, day: number, winnerId = 'a'): RatingMatchEvent => ({
  id, playedAt: new Date(Date.UTC(2026, 0, day)).toISOString(), playerIds: ['a', 'b'],
  confirmed: true, outcome: { type: 'win', winnerId },
});
close(eloExpectedScore(1500, 1500), 0.5);
close(eloExpectedScore(1500, 1900), 1 / 11);
const first = match('first', 1);
const result = replayEloRatings([first]);
assert.deepEqual(result.rows.map(row => row.rating), [1516, 1484]);
assert.ok(result.updates.every(update => update.effectiveK === 32));
assert.ok(result.rows.every(row => !('rd' in row)), 'Elo must not expose Glicko confidence');
assert.deepEqual(replayEloRatings([{ ...first, playerIds: ['b', 'a'] }]), result);
const copies = replayEloRatings([first, { ...first, playerIds: ['b', 'a'] }]);
assert.equal(copies.duplicateMatchCount, 1);
assert.deepEqual(copies.updates, result.updates);
const conflict = replayEloRatings([first, { ...first, outcome: { type: 'win', winnerId: 'b' } }]);
assert.equal(conflict.ratedMatchCount, 0);
assert.deepEqual(conflict.updates, []);
assert.equal(replayEloRatings([{ ...first, confirmed: false }]).ratedMatchCount, 0);
assert.equal(replayEloRatings([match('invalid', 1, 'unknown')]).ratedMatchCount, 0);
const draw = replayEloRatings([{ ...first, outcome: { type: 'draw' } }]);
assert.ok(draw.rows.every(row => row.rating === 1500 && row.draws === 1));

const games = Array.from({ length: 100 }, (_, i) => match(`game-${i}`, i + 1, i < 99 ? 'a' : 'b'));
const replay = replayEloRatings(games, [{ id: 'c', name: 'Unrated' }]);
assert.deepEqual(replay, replayEloRatings([...games].reverse(), [{ id: 'c', name: 'Unrated' }]));
close(replay.rows.reduce((total, row) => total + row.rating, 0), 4500);
for (const row of replay.rows) {
  const updates = replay.updates.filter(update => update.playerId === row.playerId);
  close(1500 + updates.reduce((sum, update) => sum + update.adjustment, 0), row.rating);
  assert.equal(row.provisional, row.games < 10);
  for (const update of updates) {
    assert.ok(Math.abs(update.adjustment) <= 32);
    close(update.adjustment, 32 * (update.score - update.expectedScore));
    close(update.before.rating + update.adjustment, update.after.rating);
  }
}
assert.ok(replay.updates.find(update => update.matchId === 'game-99' && update.playerId === 'b')!.adjustment > 30,
  'A severe upset approaches the 32-point bound');
const returned = { ...match('returned', 200), seasonId: 'new-season' };
const continuous = { ...returned, playedAt: match('returned', 2).playedAt, seasonId: 'same-season' };
assert.deepEqual(replayEloRatings([first, returned]).rows.map(row => row.rating), replayEloRatings([first, continuous]).rows.map(row => row.rating));
assert.deepEqual(replayEloRatings([first], [], { asOf: returned.playedAt }).rows, result.rows);
assert.deepEqual(replayEloRatings([first, returned], [], { asOf: first.playedAt }).updates, result.updates);
assert.throws(() => replayEloRatings([], [], { asOf: 'invalid' }), /evaluation time/);
console.log('Elo K32: exact updates, bounds, symmetry, replay ledger, duplicate/conflict handling, coverage, and reset/gap continuity verified');

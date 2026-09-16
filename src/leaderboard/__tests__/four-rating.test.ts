import assert from 'node:assert/strict';
import { fourRatingUpdate, eloExpectedScore, replayEloRatings, type LiveEloEvent } from '../elo.js';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const game = (id: string, day: number, ownLive = 1500, opponentLive = 1500): LiveEloEvent => ({
  id, playerIds: ['a', 'b'], playedAt: new Date(Date.UTC(2026, 0, day)).toISOString(), confirmed: true,
  outcome: { type: 'win', winnerId: 'a' }, liveRatings: { a: ownLive, b: opponentLive },
});
const plain = fourRatingUpdate(1500, 1500, 1500, 1500, 1);
close(plain.benchmark, 0.5); close(plain.adjustment, 16);
const high = fourRatingUpdate(1500, 1500, 1900, 1900, 1);
close(high.matchEvidence.ownBlend, 1600); close(high.matchEvidence.opponentBlend, 1800);
close(high.adjustment, 24.311901652734655);
const highLoss = fourRatingUpdate(1500, 1500, 1900, 1900, 0);
close(highLoss.adjustment, -7.688098347265347);
assert.ok(high.adjustment + highLoss.adjustment > 0, 'High Live pools may gain points overall');
const low = fourRatingUpdate(1500, 1500, 1100, 1100, 1);
assert.ok(low.adjustment < 16, 'Lower Live pools earn less for a win');
// At aligned Live/internal values, the ordinary Elo rule is recovered.
close(fourRatingUpdate(1700, 1500, 1700, 1500, 1).adjustment, 32 * (1 - eloExpectedScore(1700, 1500)));
// Each of the four scores must affect the rule, independently.
for (let i = 0; i < 4; i++) {
  const values: [number, number, number, number] = [1500, 1500, 1500, 1500]; values[i] += 100;
  assert.notEqual(fourRatingUpdate(...values, 1).adjustment, plain.adjustment);
}
for (const score of [0, 0.5, 1] as const) for (const live of [0, 800, 1500, 3000, 9000]) {
  const u = fourRatingUpdate(1600, 1700, live, 1900, score);
  assert.ok(Math.abs(u.adjustment) <= 32);
  if (score === 1) assert.ok(u.adjustment >= 0);
  if (score === 0) assert.ok(u.adjustment <= 0);
}
for (const invalid of [NaN, Infinity, -1]) assert.throws(() => fourRatingUpdate(1500, 1500, invalid, 1500, 1));
for (const weight of [NaN, 0.4, 1.1]) assert.throws(() => replayEloRatings([], [], { liveOpponentWeight: weight }));

const first = game('one', 1, 1900, 1900), second = game('two', 2, 1916, 1884);
const seeds = [{ id: 'a', name: 'A', latestLiveRating: 9000 }, { id: 'b', name: 'B' }, { id: 'c', name: 'Unrated' }];
const r = replayEloRatings([first, second], seeds);
assert.ok(r.updates.filter(u => u.matchId === 'one').every(u => u.before.rating === 1500));
assert.ok(r.rows.every(row => row.initialization === 'default' && !('livePrior' in row)));
assert.ok(r.updates.every(u => !('calibration' in u) && !('liveRefresh' in u)));
assert.equal(r.rows.find(row => row.playerId === 'c')!.rating, 1500);
for (const row of r.rows) close(row.rating, 1500 + r.updates.filter(u => u.playerId === row.playerId).reduce((s, u) => s + u.adjustment, 0));
for (const u of r.updates) {
  const other = r.updates.find(v => v.matchId === u.matchId && v.playerId === u.opponentId)!;
  close(u.opponentBefore.rating, other.before.rating);
  close(u.before.rating + u.adjustment, u.after.rating);
}
// Chronology, duplicate captures, and player ordering never select different results.
assert.deepEqual(replayEloRatings([second, first], seeds), r);
assert.deepEqual(replayEloRatings([first, { ...first, playerIds: ['b', 'a'] }, second], seeds).updates, r.updates);
assert.deepEqual(replayEloRatings([first, second].map(m => ({ ...m, playerIds: ['b', 'a'] as const })), seeds), r);
assert.deepEqual(replayEloRatings([first, second], seeds, { asOf: first.playedAt }).updates, r.updates.filter(u => u.matchId === 'one'));
// Profile values, after-scores, and elapsed time do not add or remove points.
assert.deepEqual(replayEloRatings([first, second].map(m => ({ ...m, liveRatingsAfter: { a: 9000, b: 2 } })), seeds).updates, r.updates);
assert.deepEqual(replayEloRatings([first, second], seeds.map(p => ({ ...p, latestLiveRating: 1 }))).updates, r.updates);
assert.deepEqual(replayEloRatings([first, { ...second, playedAt: game('late', 200).playedAt, seasonId: 'new' }], seeds).rows.map(p => p.rating), r.rows.map(p => p.rating));
// First-capture values are never used as a starting rating, even for huge Live scores.
const newcomer = replayEloRatings([game('new', 1, 2400, 2400)]);
assert.ok(newcomer.rows.every(p => p.rating >= 1468 && p.rating <= 1532));
// No Elo, one-sided Elo, conflicting Elo, and outcome conflicts cannot enter rating history.
for (const liveRatings of [undefined, { a: 1500 }, { a: NaN, b: 1500 }] as (Record<string, number> | undefined)[]) assert.equal(replayEloRatings([{ ...first, liveRatings }]).ratedMatchCount, 0);
assert.equal(replayEloRatings([first, { ...first, liveRatings: { a: 1901, b: 1900 } }]).ratedMatchCount, 0);
assert.equal(replayEloRatings([first, { ...first, outcome: { type: 'win', winnerId: 'b' } }]).ratedMatchCount, 0);
assert.deepEqual(replayEloRatings([{ ...first, liveRatings: { a: 1900 } }, { ...first, liveRatings: { b: 1900 } }]).updates, replayEloRatings([first]).updates);
// Document the model's limit: level-aware inputs cannot also ignore unknown Live resets.
const resetWin = fourRatingUpdate(1900, 1900, 1500, 1500, 1);
const resetLoss = fourRatingUpdate(1900, 1900, 1500, 1500, 0);
close(resetWin.adjustment, 7.688098347265349);
close(resetLoss.adjustment, -24.31190165273465);
assert.ok(resetWin.adjustment + resetLoss.adjustment < 0, 'Reset protection requires information beyond the four current scores');
console.log('Four-rating model: common 1500 start, all four inputs, bounded nonzero-sum updates, complete ledger, simultaneous chronology, missing/conflicting evidence, no profile/post leakage, and reset limitation verified');

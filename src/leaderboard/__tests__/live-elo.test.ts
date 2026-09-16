import assert from 'node:assert/strict';
import { ACTIVE_ELO_OPTIONS, prepareRankedEloEvents, replayEloRatings, type LiveEloEvent } from '../legacy-elo.js';
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const game = (id: string, day: number, a = 'a', b = 'b', live?: Record<string, number>, seasonId = 'first'): LiveEloEvent => ({
  id, playedAt: new Date(Date.UTC(2026, 0, day)).toISOString(), playerIds: [a, b], confirmed: true,
  outcome: { type: 'win', winnerId: a }, liveRatings: live, seasonId,
});
const opts = { livePriorWeight: 0.5 };
const first = game('one', 1, 'a', 'b', { a: 1900, b: 1900 });
const r = replayEloRatings([first], [], opts);
assert.deepEqual(r.rows.map(r => r.rating), [1716, 1684]);
assert.deepEqual(replayEloRatings([first, first], [], opts).rows, r.rows);
const delayed = replayEloRatings([game('no-live', 1), { ...first, playedAt: game('date', 2).playedAt }], [], opts);
for (const row of delayed.rows) {
  const updates = delayed.updates.filter(u => u.playerId === row.playerId);
  close(1500 + updates.reduce((s, u) => s + (u.calibration?.adjustment ?? 0) + u.adjustment, 0), row.rating);
  assert.equal(updates.filter(u => u.calibration).length, 1);
  assert.ok(updates.every(u => Math.abs(u.adjustment) <= 32));
}
// Profile metadata and future post-game/current ratings cannot leak into past games.
const profile = [{ id: 'a', name: 'a', latestLiveRating: 9000 }];
assert.deepEqual(replayEloRatings([first], profile, opts).updates, r.updates);
const future = game('future', 3, 'a', 'c', { a: 5000, c: 6000 });
assert.deepEqual(replayEloRatings([first, future], [], { ...opts, asOf: first.playedAt }).updates, r.updates);
const changedLive = game('reset', 2, 'a', 'b', { a: 1000, b: 1000 }, 'second');
assert.deepEqual(replayEloRatings([first, changedLive], [], opts).rows, replayEloRatings([first, { ...changedLive, liveRatings: { a: 2100, b: 2000 } }], [], opts).rows);
const unknownSeason = replayEloRatings([first, game('new-player', 2, 'c', 'd', { c: 1000, d: 1000 }, 'second')], [], opts);
assert.ok(unknownSeason.updates.filter(u => u.matchId === 'new-player').every(u => !u.calibration), 'Defer reset-era priors without enough bridge players');
// Synthetic season bridge: five distinct known players, each with ten draws,
// retain 1700 while Live drops from 1900 to 1500. Newcomer maps to 1700.
const history: LiveEloEvent[] = [];
for (let i = 0; i < 5; i++) for (let j = 0; j < 10; j++) history.push({
  ...game(`old-${i}-${j}`, j + 1, `p${i}`, `q${i}`, { [`p${i}`]: 1900, [`q${i}`]: 1900 }), outcome: { type: 'draw' } });
for (let i = 0; i < 5; i++) history.push({ ...game(`bridge-${i}`, 12 + i, `p${i}`, `n${i}`, { [`p${i}`]: 1500, [`n${i}`]: 1500 }, 'second'), outcome: { type: 'draw' } });
const bridge = replayEloRatings(history, [], opts);
const calibrated = bridge.updates.find(u => u.matchId === 'bridge-4' && u.playerId === 'n4')!.calibration!;
close(calibrated.after, 1700); close(calibrated.offset, 200); assert.equal(calibrated.anchorPlayers, 5);
assert.ok(bridge.updates.filter(u => u.playerId.startsWith('p') && u.matchId.startsWith('bridge')).every(u => !u.calibration));
// Duplicate conflicting Live evidence is ignored in either source order.
const conflict = { ...first, liveRatings: { a: 5000, b: 1900 } };
assert.deepEqual(replayEloRatings([first, conflict], [], opts), replayEloRatings([conflict, first], [], opts));
assert.equal(replayEloRatings([first, conflict], [], opts).rows.find(r => r.playerId === 'a')!.livePrior, undefined);
assert.ok(replayEloRatings([first], [], { ...opts, verifiedLiveOnly: true }).rows.every(r => !r.livePrior));
assert.throws(() => replayEloRatings([], [], { livePriorWeight: NaN }));
console.log('Live priors: bounded game gains, complete ledger, no future/profile leakage, conflict handling, reset continuity and five-player synthetic bridge verified');

// Ranking policy excludes missing, one-sided, invalid, and conflicting Live evidence.
// Profile and post-game values do not turn a friendly/unknown-queue match into a ranked one.
const noLive = game('friendly', 2);
const afterOnly = { ...game('post-only', 2), liveRatingsAfter: { a: 1910, b: 1890 } };
const partial = game('partial', 2, 'a', 'b', { a: 1900 });
const invalid = [NaN, Infinity, -1].map((value, i) => game(`invalid-${i}`, 2, 'a', 'b', { a: value, b: 1900 }));
const excluded = [noLive, afterOnly, partial, ...invalid];
assert.equal(prepareRankedEloEvents(excluded).accepted.length, 0);
assert.equal(replayEloRatings(excluded, profile, ACTIVE_ELO_OPTIONS).rows[0].games, 0);
assert.equal(prepareRankedEloEvents([first, conflict]).accepted.length, 0);
assert.equal(prepareRankedEloEvents([conflict, first]).accepted.length, 0);
// Paired evidence from duplicate captures qualifies once, independent of source order.
const halfA = { ...first, liveRatings: { a: 1900 } }, halfB = { ...first, liveRatings: { b: 1900 } };
assert.deepEqual(prepareRankedEloEvents([halfA, halfB]).accepted, prepareRankedEloEvents([first]).accepted);
assert.deepEqual(replayEloRatings([halfB, halfA], [], ACTIVE_ELO_OPTIONS).updates, replayEloRatings([first], [], ACTIVE_ELO_OPTIONS).updates);
// Skipped games cannot change the game ledger, calibration, base season, or refresh reference.
const firstWithPost = { ...first, liveRatingsAfter: { a: 1916, b: 1884 } };
const later = game('later', 4, 'a', 'b', { a: 1956, b: 1924 });
const qualifying = [firstWithPost, later];
const beforeSeason = { ...game('old-friendly', 0), seasonId: 'older' };
const clean = replayEloRatings(qualifying, profile, ACTIVE_ELO_OPTIONS);
const withExcluded = replayEloRatings([beforeSeason, ...qualifying, ...excluded], profile, ACTIVE_ELO_OPTIONS);
assert.deepEqual(withExcluded.rows, clean.rows);
assert.deepEqual(withExcluded.updates, clean.updates);
assert.deepEqual(prepareRankedEloEvents([beforeSeason, ...qualifying, ...excluded]).accepted, prepareRankedEloEvents(qualifying).accepted);
assert.equal(withExcluded.ratedMatchCount, 2);
assert.equal(withExcluded.rejectedMatches.length, excluded.length + 1);
assert.equal(clean.updates.find(u => u.matchId === 'later' && u.playerId === 'a')!.liveRefresh!.adjustment, 10);
assert.equal(replayEloRatings([noLive]).ratedMatchCount, 1, 'Unfiltered research baseline stays available');
console.log('Ranked eligibility: paired evidence required, duplicates resolved, excluded games have no rating or refresh effects');

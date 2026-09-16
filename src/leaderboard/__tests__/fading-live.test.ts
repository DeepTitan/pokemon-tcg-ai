import assert from 'node:assert/strict';
import { fadingLiveRatingUpdate, eloExpectedScore, replayEloRatings, type LiveEloEvent } from '../elo.js';

const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const game = (id: string, day: number, playerIds: readonly [string, string] = ['a', 'b'], score: 0 | 0.5 | 1 = 1): LiveEloEvent => ({
  id, playedAt: new Date(Date.UTC(2026, 0, day)).toISOString(), playerIds, confirmed: true,
  outcome: score === 0.5 ? { type: 'draw' } : { type: 'win', winnerId: playerIds[score === 1 ? 0 : 1] },
  liveRatings: Object.fromEntries(playerIds.map(id => [id, 1900])),
});

// A newcomer never inherits Live as a starting rating, and an unseen opponent's
// arbitrary initial Trace rating contributes no strength evidence.
const fresh = fadingLiveRatingUpdate(1500, 1500, 1900, 1900, 1, 0, 0);
close(fresh.adjustment, 27.168654169237655);
close(fresh.matchEvidence.ownBlend, 1600);
close(fresh.matchEvidence.opponentBlend, 1900);
for (const ownCount of [0, 20, 1000000]) {
  const a = fadingLiveRatingUpdate(1800, 1500, 1900, 1900, 1, ownCount, 0);
  const b = fadingLiveRatingUpdate(1800, 2500, 1900, 1900, 1, ownCount, 0);
  close(a.adjustment, b.adjustment);
  close(a.matchEvidence.opponentTraceWeight, 0);
}

// Each side fades independently. Twenty prior games halve that side's initial
// Live influence; neither player inherits the other's recording count.
const ownMature = fadingLiveRatingUpdate(1700, 1600, 1900, 1800, 1, 20, 0);
close(ownMature.matchEvidence.ownTraceWeight, 0.875);
close(ownMature.matchEvidence.opponentTraceWeight, 0);
const opponentMature = fadingLiveRatingUpdate(1700, 1600, 1900, 1800, 1, 0, 20);
close(opponentMature.matchEvidence.ownTraceWeight, 0.75);
close(opponentMature.matchEvidence.opponentTraceWeight, 0.5);
let previousOwn = -1, previousOpponent = -1;
for (const count of [0, 1, 20, 100, 1000, 1000000]) {
  const { matchEvidence: evidence } = fadingLiveRatingUpdate(1700, 1600, 1900, 1800, 1, count, count);
  assert.ok(evidence.ownTraceWeight > previousOwn);
  assert.ok(evidence.opponentTraceWeight > previousOpponent);
  assert.ok(evidence.ownTraceWeight < 1 && evidence.opponentTraceWeight < 1);
  previousOwn = evidence.ownTraceWeight;
  previousOpponent = evidence.opponentTraceWeight;
}
// The half-fade policy is configurable rather than buried in the calculation.
const configured = fadingLiveRatingUpdate(1700, 1600, 1900, 1800, 1, 40, 40,
  { liveFadeGames: 40, initialOwnLiveWeight: 0.4 });
close(configured.matchEvidence.ownTraceWeight, 0.8);
close(configured.matchEvidence.opponentTraceWeight, 0.5);

// Substantial history recovers ordinary internal Elo, including balanced deltas.
// The deliberately contradictory Live values cannot dominate mature histories.
for (const score of [0, 0.5, 1] as const) {
  const matureA = fadingLiveRatingUpdate(1750, 1600, 400, 3000, score, 1e12, 1e12);
  const matureB = fadingLiveRatingUpdate(1600, 1750, 3000, 400, (1 - score) as 0 | 0.5 | 1, 1e12, 1e12);
  close(matureA.adjustment, 32 * (score - eloExpectedScore(1750, 1600)), 1e-7);
  close(matureA.adjustment + matureB.adjustment, 0, 1e-7);
}

// An unknown common reset still affects finite histories, but its effect tends
// to zero as history grows. This is attenuation, not a claim of reset detection.
let priorResetEffect = Infinity;
for (const count of [0, 20, 100, 1000, 1000000]) {
  const unchanged = fadingLiveRatingUpdate(1900, 1900, 1900, 1900, 1, count, count);
  const reset = fadingLiveRatingUpdate(1900, 1900, 1500, 1500, 1, count, count);
  const effect = Math.abs(reset.adjustment - unchanged.adjustment);
  assert.ok(effect > 0 && effect < priorResetEffect);
  priorResetEffect = effect;
}
assert.ok(priorResetEffect < 0.001);
for (const count of [0, 20, 1000000]) for (const live of [0, 800, 1500, 3000, 9000]) for (const score of [0, 0.5, 1] as const) {
  const update = fadingLiveRatingUpdate(1600, 1700, live, 1900, score, count, count);
  assert.ok(Math.abs(update.adjustment) <= 32);
  if (score === 1) assert.ok(update.adjustment >= 0);
  if (score === 0) assert.ok(update.adjustment <= 0);
}
for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => fadingLiveRatingUpdate(1500, 1500, 1500, 1500, 1, count, 0));
  assert.throws(() => fadingLiveRatingUpdate(1500, 1500, 1500, 1500, 1, 0, count));
}
for (const liveFadeGames of [-1, 0, NaN, Infinity]) {
  assert.throws(() => fadingLiveRatingUpdate(1500, 1500, 1500, 1500, 1, 0, 0, { liveFadeGames }));
  assert.throws(() => replayEloRatings([], [], { liveFadeGames }));
}
for (const initialOwnLiveWeight of [-1, 1, 1.1, NaN, Infinity]) {
  assert.throws(() => fadingLiveRatingUpdate(1500, 1500, 1500, 1500, 1, 0, 0, { initialOwnLiveWeight }));
  assert.throws(() => replayEloRatings([], [], { initialOwnLiveWeight }));
}
for (const invalid of [NaN, Infinity, -1])
  assert.throws(() => fadingLiveRatingUpdate(1500, 1500, invalid, 1500, 1, 0, 0));

// Replay must use eligible, strictly prior games for both sides, before either
// current-game update is committed. Unequal counts expose side-order mistakes.
const matches = [game('first', 1, ['a', 'c']), game('second', 2, ['a', 'c'], 0),
  game('third', 3), game('fourth', 4, ['b', 'c'], 0.5)];
const replay = replayEloRatings(matches);
assert.equal(replay.ratedMatchCount, 4);
const counts = new Map<string, number>();
for (const match of matches) {
  const updates = replay.updates.filter(update => update.matchId === match.id);
  assert.equal(updates.length, 2);
  for (const update of updates) {
    const evidence = update.matchEvidence;
    assert.equal(evidence.model, 'fading-live');
    assert.equal(evidence.ownPriorGames, counts.get(update.playerId) ?? 0);
    assert.equal(evidence.opponentPriorGames, counts.get(update.opponentId) ?? 0);
    assert.equal(evidence.liveFadeGames, 20);
    assert.equal(evidence.initialOwnLiveWeight, 0.25);
    const opposite = updates.find(other => other.playerId === update.opponentId)!;
    close(update.opponentBefore.rating, opposite.before.rating);
    close(update.after.rating, update.before.rating + update.adjustment);
  }
  for (const id of match.playerIds) counts.set(id, (counts.get(id) ?? 0) + 1);
}
for (const row of replay.rows) {
  close(row.rating, 1500 + replay.updates.filter(update => update.playerId === row.playerId)
    .reduce((sum, update) => sum + update.adjustment, 0));
  assert.equal(row.initialization, 'default');
}
assert.ok(replay.updates.filter(update => update.matchId === 'first').every(update => update.before.rating === 1500));
assert.deepEqual(replayEloRatings([...matches].reverse()), replay);
assert.deepEqual(replayEloRatings(matches.map(match => ({ ...match, playerIds: [...match.playerIds].reverse() as [string, string] }))), replay);
assert.deepEqual(replayEloRatings([...matches, matches[0]]).updates, replay.updates);
assert.deepEqual(replayEloRatings(matches.map(match => ({ ...match, liveRatingsAfter: { a: 1, b: 9999, c: 9000 } }))), replay);
assert.deepEqual(replayEloRatings(matches, [], { asOf: matches[2].playedAt }).updates,
  replay.updates.filter(update => update.matchId !== 'fourth'));
const seeds = [{ id: 'a', name: 'A', traceStatus: 'trace-user', latestLiveRating: 1 },
  { id: 'b', name: 'B', traceStatus: 'opponent-only', latestLiveRating: 9000 }];
assert.deepEqual(replayEloRatings(matches, seeds).updates,
  replayEloRatings(matches, seeds.map(seed => ({ ...seed, latestLiveRating: 1500,
    traceStatus: seed.traceStatus === 'trace-user' ? 'opponent-only' : 'trace-user' }))).updates);
const skipped = replayEloRatings([{ ...matches[0], liveRatings: undefined }, matches[1]]);
assert.equal(skipped.ratedMatchCount, 1);
assert.ok(skipped.updates.every(update => update.matchEvidence.ownPriorGames === 0 && update.matchEvidence.opponentPriorGames === 0));
assert.ok(replayEloRatings(matches, [], { model: 'coverage-aware' }).updates.every(update => update.matchEvidence.model === 'coverage-aware'));

console.log('Fading Live: independent prior counts, newborn opponent handling, bounded chronological ledger, internal Elo limit, reset attenuation, and eligibility verified');

import assert from 'node:assert/strict';
import { coverageAwareRatingUpdate, opponentTraceWeight, replayEloRatings as replayCurrentRatings, type LiveEloEvent } from '../elo.js';
import type { LiveScaleCalibration } from '../live-scale.js';

// Preserve this model's regression checks as the active replay evolves.
const replayEloRatings: typeof replayCurrentRatings = (events, players, options) =>
  replayCurrentRatings(events, players, { ...options, model: 'coverage-aware' });

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const game = (id: string, day: number, outcome: 0 | 0.5 | 1 = 1): LiveEloEvent => ({
  id, playedAt: new Date(Date.UTC(2026, 0, day)).toISOString(), playerIds: ['a', 'b'], confirmed: true,
  outcome: outcome === 0.5 ? { type: 'draw' } : { type: 'win', winnerId: outcome === 1 ? 'a' : 'b' },
  liveRatings: { a: 1900, b: 1850 },
});

// The unobserved opponent baseline contributes no false skill information.
const fresh = coverageAwareRatingUpdate(1500, 1500, 1900, 1900, 1, 0);
close(fresh.adjustment, coverageAwareRatingUpdate(1500, 2500, 1900, 1900, 1, 0).adjustment);
assert.ok(fresh.adjustment > 24.31 && fresh.adjustment < 32);
close(opponentTraceWeight(0), 0);
close(opponentTraceWeight(20), 0.125);
close(opponentTraceWeight(1), 0.25 / 21);
assert.ok(opponentTraceWeight(100) > opponentTraceWeight(20));
assert.ok(opponentTraceWeight(1000000) < 0.25);
for (const bad of [-1, 0.5, NaN, Infinity]) assert.throws(() => opponentTraceWeight(bad));
for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => opponentTraceWeight(1, bad));

// All four values affect established-opponent updates; bounds and direction hold.
const base = coverageAwareRatingUpdate(1500, 1500, 1500, 1500, 1, 20);
for (let index = 0; index < 4; index++) {
  const inputs: [number, number, number, number] = [1500, 1500, 1500, 1500]; inputs[index] += 100;
  assert.notEqual(coverageAwareRatingUpdate(...inputs, 1, 20).adjustment, base.adjustment);
}
for (const count of [0, 1, 20, 1000]) for (const live of [0, 800, 1500, 3000]) for (const score of [0, 0.5, 1] as const) {
  const update = coverageAwareRatingUpdate(1600, 1700, live, 1900, score, count);
  assert.ok(Math.abs(update.adjustment) <= 32);
  if (score === 1) assert.ok(update.adjustment >= 0);
  if (score === 0) assert.ok(update.adjustment <= 0);
}
// Under perfect Live, a player aligned with true skill has zero mean drift
// against a fresh opponent, even when the matchup is unequal.
for (const [own, other] of [[1900, 1900], [1800, 1900], [1300, 1600]]) {
  const p = 1 / (1 + 10 ** ((other - own) / 400));
  const win = coverageAwareRatingUpdate(own, 1500, own, other, 1, 0).adjustment;
  const loss = coverageAwareRatingUpdate(own, 1500, own, other, 0, 0).adjustment;
  close(p * win + (1 - p) * loss, 0);
}

const matches = [game('first', 1), game('second', 2, 0), game('third', 3, 0.5)];
const replay = replayEloRatings(matches);
assert.equal(replay.ratedMatchCount, 3);
for (let index = 0; index < matches.length; index++) {
  for (const update of replay.updates.filter(row => row.matchId === matches[index].id)) {
    assert.equal(update.matchEvidence.opponentPriorGames, index, 'Use strictly pre-match counts for both players');
    assert.equal(update.matchEvidence.model, 'coverage-aware');
    close(update.matchEvidence.opponentTraceWeight, opponentTraceWeight(index));
    const opposite = replay.updates.find(row => row.matchId === update.matchId && row.playerId === update.opponentId)!;
    close(update.opponentBefore.rating, opposite.before.rating);
  }
}
for (const row of replay.rows) close(row.rating, 1500 + replay.updates.filter(update => update.playerId === row.playerId).reduce((sum, update) => sum + update.adjustment, 0));
assert.deepEqual(replayEloRatings([...matches].reverse()), replay);
assert.deepEqual(replayEloRatings(matches.map(match => ({ ...match, playerIds: ['b', 'a'] as const }))), replay);
assert.deepEqual(replayEloRatings([...matches, matches[0]]).updates, replay.updates);
assert.deepEqual(replayEloRatings(matches.map(match => ({ ...match, liveRatingsAfter: { a: 1, b: 9999 } }))), replay);
const seeds = [{ id: 'a', name: 'A', traceStatus: 'trace-user' }, { id: 'b', name: 'B', traceStatus: 'opponent-only' }];
assert.deepEqual(replayEloRatings(matches, seeds).updates,
  replayEloRatings(matches, seeds.map(seed => ({ ...seed, traceStatus: seed.traceStatus === 'trace-user' ? 'opponent-only' : 'trace-user' }))).updates);
assert.equal(replayEloRatings([{ ...matches[0], liveRatings: undefined }, matches[1]]).updates[0].matchEvidence.opponentPriorGames, 0);
assert.deepEqual(replayEloRatings(matches, [], { asOf: matches[1].playedAt }).updates, replay.updates.filter(update => update.matchId !== 'third'));

// An explicit mapping corrects an equivalent shifted/scaled Live input. It never
// adds a separate adjustment, seeds a rating, or uses future calibration evidence.
const mapping: LiveScaleCalibration = { seasonId: 'shifted', scale: 2, offset: -1100,
  availableAt: matches[1].playedAt, evidence: 'Synthetic known affine scale, not real season data' };
const shifted = matches.map((match, index) => index ? { ...match, seasonId: 'shifted',
  liveRatings: { a: (1900 + 1100) / 2, b: (1850 + 1100) / 2 } } : match);
const corrected = replayEloRatings(shifted, [], { liveScaleCalibrations: [mapping] });
for (let index = 0; index < replay.updates.length; index++) {
  close(corrected.updates[index].adjustment, replay.updates[index].adjustment);
  close(corrected.updates[index].after.rating, replay.updates[index].after.rating);
}
assert.equal(corrected.updates[2].matchEvidence.rawOwnLive, shifted[1].liveRatings!.a);
assert.equal(corrected.updates[2].matchEvidence.ownLive, 1900);
assert.equal(corrected.updates[2].matchEvidence.liveScale?.seasonId, 'shifted');
assert.equal(corrected.updates[0].matchEvidence.liveScale, undefined);
const unavailable = { ...mapping, availableAt: '2027-01-01T00:00:00Z' };
assert.deepEqual(replayEloRatings(shifted, [], { liveScaleCalibrations: [unavailable] }), replayEloRatings(shifted));
assert.deepEqual(replayEloRatings(matches, [], { liveScaleCalibrations: [mapping] }), replay);
for (const broken of [{ ...mapping, scale: 0 }, { ...mapping, offset: NaN }, { ...mapping, evidence: '' }, { ...mapping, availableAt: 'unknown' }])
  assert.throws(() => replayEloRatings(shifted, [], { liveScaleCalibrations: [broken] }));
assert.throws(() => replayEloRatings(shifted, [], { liveScaleCalibrations: [mapping, mapping] }));
assert.throws(() => replayEloRatings(shifted, [], { liveScaleCalibrations: [{ ...mapping, offset: -999999 }] }));

console.log('Coverage-aware rating: prior counts, fresh-opponent independence, bounded simultaneous ledger, eligibility, chronology, no post-score leakage, and explicit causal Live scale mapping verified');

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ACTIVE_ELO_OPTIONS, replayEloRatings } from '../../src/leaderboard/elo.js';
import { projectPublicLeaderboardSnapshot } from '../leaderboard-public-snapshot.js';

const secret = 'PRIVATE /Users/operator/capture.sqlite full-deck-and-log';
const match = {
  id: 'game-1', playedAt: '2026-09-01T12:00:00Z', playerIds: ['alice', 'bob'], confirmed: true,
  outcome: { type: 'win', winnerId: 'alice', log: secret }, seasonId: 'autumn', phase: 'ranked',
  liveRatings: { alice: 1900, bob: 1800, unrelated: secret }, liveRatingsAfter: { alice: 1920 },
  liveRatingEligibility: { timing: 'pre-match', valueType: 'elo', evidence: [secret], extra: secret },
  sources: [secret], timestampSource: secret, rawLog: secret,
  history: {
    players: {
      alice: { pokemon: { name: 'Dragapult ex', cardId: 'sv6_130', artCardId: 'sv6_130', decklist: secret }, prizesTaken: 6, hand: secret },
      bob: { pokemon: { name: 'Charizard ex' }, prizesTaken: 3, decklist: secret },
      unrelated: { rawLog: secret },
    }, durationSeconds: 450, turns: [secret],
  },
};
const snapshot = {
  schema: 'trace-leaderboard/v1', generatedAt: '2026-09-16T12:00:00Z', sourceLabel: secret,
  players: [
    { id: 'alice', name: 'Alice', traceStatus: 'trace-user', latestLiveRating: 1920, liveRatingObservedAt: '2026-09-01T12:00:00Z',
      liveRatingTiming: 'post-match', liveRatingBefore: 1900, liveRatingChange: 20, liveRatingMatchId: secret, accountId: secret },
    { id: 'bob', name: 'Bob', traceStatus: 'opponent-only', decklist: secret },
  ],
  matches: [match, { ...match, id: 'unrated', liveRatings: { alice: 1900 } }],
  diagnostics: secret, coverage: secret, liveRatingObservations: [secret], unknownFutureField: secret,
};
const before = JSON.stringify(snapshot);
const published = projectPublicLeaderboardSnapshot(snapshot);
assert.equal(published.sourceLabel, 'Trace matches');
assert.equal(JSON.stringify(published).includes(secret), false, 'No private values survive any nested boundary');
assert.deepEqual(Object.keys(published).sort(), ['generatedAt', 'matches', 'players', 'schema', 'sourceLabel']);
assert.deepEqual(Object.keys(published.matches[0]).sort(), ['confirmed', 'history', 'id', 'liveRatingEligibility', 'liveRatings', 'outcome', 'phase', 'playedAt', 'playerIds', 'seasonId']);
assert.deepEqual(published.matches[0].history, {
  players: {
    alice: { pokemon: { name: 'Dragapult ex', cardId: 'sv6_130', artCardId: 'sv6_130' }, prizesTaken: 6 },
    bob: { pokemon: { name: 'Charizard ex' }, prizesTaken: 3 },
  }, durationSeconds: 450,
});
assert.deepEqual(published.players[0], {
  id: 'alice', name: 'Alice', traceStatus: 'trace-user', latestLiveRating: 1920,
  liveRatingObservedAt: '2026-09-01T12:00:00Z', liveRatingTiming: 'post-match', liveRatingBefore: 1900, liveRatingChange: 20,
});
assert.equal(JSON.stringify(snapshot), before, 'Projection never mutates the input');
assert.notEqual(published.matches[0].history, match.history);
assert.notEqual(published.matches[0].playerIds, match.playerIds);
assert.deepEqual(projectPublicLeaderboardSnapshot(published), published, 'Projection is idempotent');

// Compare every unrounded rating update and acceptance decision, including the
// excluded missing-score match. JSON parsing here models the actual input boundary.
const original = JSON.parse(before);
assert.deepEqual(replayEloRatings(published.matches, published.players, ACTIVE_ELO_OPTIONS),
  replayEloRatings(original.matches, original.players, ACTIVE_ELO_OPTIONS));

const duplicates = { ...original, matches: [
  { ...original.matches[0], id: 'conflict', phase: 'one' },
  { ...original.matches[0], id: 'conflict', phase: 'two' },
  { ...original.matches[0], id: 'partial', liveRatings: { alice: 1900 } },
  { ...original.matches[0], id: 'partial', liveRatings: { bob: 1800 } },
  { ...original.matches[0], id: 'disputed', liveRatings: { alice: 1900, bob: 1800 } },
  { ...original.matches[0], id: 'disputed', liveRatings: { alice: 1900, bob: 1801 } },
] };
const projectedDuplicates = projectPublicLeaderboardSnapshot(duplicates);
const duplicateReplay = replayEloRatings(projectedDuplicates.matches, projectedDuplicates.players, ACTIVE_ELO_OPTIONS);
assert.deepEqual(duplicateReplay, replayEloRatings(duplicates.matches, duplicates.players, ACTIVE_ELO_OPTIONS));
assert.equal(duplicateReplay.ratedMatchCount, 1, 'Partial observations merge; conflicting phase or scores stay excluded');
assert.equal(duplicateReplay.duplicateMatchCount, 2);

const withCalibration = { ...snapshot, liveScaleCalibrations: [{ seasonId: 'autumn', scale: 1.1, offset: -100,
  availableAt: '2026-08-01T00:00:00Z', evidence: secret, diagnostics: secret }] };
const calibrated = projectPublicLeaderboardSnapshot(withCalibration);
assert.equal(JSON.stringify(calibrated).includes(secret), false);
assert.equal(calibrated.liveScaleCalibrations?.[0].evidence, 'Verified season-scale mapping.');
const privateReplay = replayEloRatings(original.matches, original.players, { ...ACTIVE_ELO_OPTIONS, liveScaleCalibrations: withCalibration.liveScaleCalibrations });
const publicReplay = replayEloRatings(calibrated.matches, calibrated.players, { ...ACTIVE_ELO_OPTIONS, liveScaleCalibrations: calibrated.liveScaleCalibrations });
assert.deepEqual(publicReplay.rows, privateReplay.rows, 'Calibration numbers and availability are unchanged');
assert.deepEqual(publicReplay.updates.map(({ adjustment, expectedScore }) => ({ adjustment, expectedScore })),
  privateReplay.updates.map(({ adjustment, expectedScore }) => ({ adjustment, expectedScore })));
assert.throws(() => projectPublicLeaderboardSnapshot({ ...withCalibration, liveScaleCalibrations: [{ ...withCalibration.liveScaleCalibrations[0], evidence: '' }] }), TypeError);
assert.throws(() => projectPublicLeaderboardSnapshot({ ...snapshot, schema: 'unknown' }), TypeError);
assert.throws(() => projectPublicLeaderboardSnapshot({ ...snapshot, players: [{ ...snapshot.players[0], latestLiveRating: { secret } }] }), TypeError);
assert.throws(() => projectPublicLeaderboardSnapshot({ ...snapshot, matches: [{ ...match, liveRatingEligibility: { timing: 'pre-match', valueType: 'league-points' } }] }), TypeError);

// The private fixture stays local and is optional in a clean production checkout.
const fixtureUrl = new URL('../../data/leaderboard/events.json', import.meta.url);
if (existsSync(fixtureUrl)) {
  const archive = JSON.parse(readFileSync(fixtureUrl, 'utf8'));
  const archiveBefore = JSON.stringify(archive), projected = projectPublicLeaderboardSnapshot(archive);
  const sourceReplay = replayEloRatings(archive.matches, archive.players, { ...ACTIVE_ELO_OPTIONS, liveScaleCalibrations: archive.liveScaleCalibrations });
  const publishedReplay = replayEloRatings(projected.matches, projected.players, { ...ACTIVE_ELO_OPTIONS, liveScaleCalibrations: projected.liveScaleCalibrations });
  assert.deepEqual(publishedReplay.rows, sourceReplay.rows);
  assert.deepEqual(publishedReplay.updates.map(({ matchEvidence, ...update }) => ({ ...update, matchEvidence: { ...matchEvidence,
    ...(matchEvidence?.liveScale ? { liveScale: { ...matchEvidence.liveScale, evidence: 'redacted' } } : {}) } })),
  sourceReplay.updates.map(({ matchEvidence, ...update }) => ({ ...update, matchEvidence: { ...matchEvidence,
    ...(matchEvidence?.liveScale ? { liveScale: { ...matchEvidence.liveScale, evidence: 'redacted' } } : {}) } })));
  assert.equal(publishedReplay.ratedMatchCount, sourceReplay.ratedMatchCount);
  assert.deepEqual(publishedReplay.rejectedMatches, sourceReplay.rejectedMatches);
  assert.equal(JSON.stringify(archive), archiveBefore);
  console.log(`Public archive projection: exact ratings and updates preserved for ${publishedReplay.ratedMatchCount} rated matches`);
}
console.log('Public snapshot: recursive allowlist, no private provenance/deck/log fields, calibration integrity, and immutability verified');

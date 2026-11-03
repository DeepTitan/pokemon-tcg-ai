import assert from 'node:assert/strict';
import { replayEloRatings, traceRatingEvents, prepareRankedEloEvents, type LiveEloEvent } from '../elo.js';
import { getLeaderboardPreviewData } from '../../../scripts/leaderboard-social-preview.js';
const players = [{ id: 'a', name: 'A', traceStatus: 'trace-user' as const }, { id: 'b', name: 'B', traceStatus: 'trace-user' as const }];
const first: LiveEloEvent = { id: 'first', playedAt: '2026-10-29T19:59:26Z', playerIds: ['a', 'b'], confirmed: true,
  outcome: { type: 'win', winnerId: 'a' }, liveRatings: { a: 1611, b: 1599 } };
const exit: LiveEloEvent = { ...first, id: 'exit', playedAt: '2026-10-29T20:10:18Z', confirmed: false,
  resultReason: 'local-client-closed', outcome: { type: 'win', winnerId: 'b' } };
const snapshot = { generatedAt: '2026-11-02T08:00:00Z', players, matches: [first], clientExitMatches: [exit] };
const before = JSON.stringify(snapshot);
const replay = replayEloRatings(traceRatingEvents(snapshot), players);
const confirmedControl = replayEloRatings([first, { ...exit, confirmed: true }], players);
assert.deepEqual(replay, confirmedControl, 'Client-close losses receive exactly the standard chronological Trace update');
assert.equal(replay.ratedMatchCount, 2);
assert.equal(replay.rows.find(r => r.playerId === 'a')!.losses, 1);
assert.equal(replay.rows.find(r => r.playerId === 'b')!.wins, 1);
assert.ok(replay.updates.find(u => u.matchId === 'exit' && u.playerId === 'a')!.adjustment < 0);
assert.ok(replay.updates.find(u => u.matchId === 'exit' && u.playerId === 'b')!.adjustment > 0);
assert.equal(JSON.stringify(snapshot), before, 'Archive still marks the outcome as inferred');
assert.equal(prepareRankedEloEvents(traceRatingEvents(snapshot)).accepted[1].resultReason, 'local-client-closed');
assert.equal(replayEloRatings([exit, exit], players).ratedMatchCount, 1, 'Retries do not count twice');
assert.equal(replayEloRatings([exit, { ...exit, confirmed: true }], players).ratedMatchCount, 1, 'A matching server result does not double count');
assert.equal(replayEloRatings([exit, { ...exit, outcome: { type: 'win', winnerId: 'a' } }], players).ratedMatchCount, 0);
for (const change of [{ resultReason: undefined }, { liveRatings: { a: 1611 } }, { outcome: { type: 'draw' } },
  { outcome: { type: 'win', winnerId: 'outsider' } }, { liveRatings: { a: -1, b: 1599 } }]) {
  assert.equal(replayEloRatings([{ ...exit, ...change } as LiveEloEvent], players).ratedMatchCount, 0);
}
assert.equal(replayEloRatings([first, exit], players, { asOf: first.playedAt }).ratedMatchCount, 1);
const social = getLeaderboardPreviewData(snapshot, 'trace');
assert.equal(social.ratedMatchCount, replay.ratedMatchCount);
for (const row of replay.rows) assert.equal(social.rows.find(r => r.playerId === row.playerId)!.rating, row.rating);
console.log('Client-close Trace eligibility: normal loss/win points, chronological replay, duplicate/conflict safety, incomplete rejection, history provenance and social parity verified');

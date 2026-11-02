import assert from 'node:assert/strict';
import { buildLeaderboardDataset } from '../export-trace-leaderboard.js';
import { projectPublicLeaderboardSnapshot } from '../leaderboard-public-snapshot.js';
import { replayEloRatings } from '../../src/leaderboard/elo.js';
const exit = { id: 'live-exit', source: 'live-network', importedAt: '2026-10-31T03:56:36.861Z',
  localPlayer: 'isaiahw', opponent: 'seality5', localRating: 1611, opponentRating: 1599,
  winner: 'seality5', resultReason: 'local-client-closed' };
const build = (...reviews: Record<string, unknown>[]) => buildLeaderboardDataset(reviews.map((review, index) => ({ review, sourceLabel: `fixture-${index}` })));
const published = (data: ReturnType<typeof build>) => projectPublicLeaderboardSnapshot(JSON.parse(JSON.stringify(data)));
const data = build(exit), view = published(data);
const isaiah = view.players.find(p => p.name === 'isaiahw')!;
assert.equal(isaiah.latestLiveRating, 1598);
assert.equal(isaiah.liveRatingBefore, 1611);
assert.equal(isaiah.liveRatingChange, -13);
assert.equal(isaiah.liveRatingCalculated, true);
assert.equal(view.players.find(p => p.name === 'seality5')!.latestLiveRating, 1611);
assert.equal(data.matches.length, 0);
assert.equal(data.diagnostics.excluded['inferred-client-exit'], 1);
assert.equal(replayEloRatings(view.matches, view.players).ratedMatchCount, 0);
assert.deepEqual(projectPublicLeaderboardSnapshot(view), view, 'Never apply the loss twice');
assert.equal(published(build(exit, exit)).players.find(p => p.name === 'isaiahw')!.latestLiveRating, 1598);
for (const change of [{ recording: true }, { winner: undefined }, { winner: 'isaiahw' },
  { opponentRating: undefined }, { result: 'draw' }, { localRatingConflict: true }, { opponentRatingConflict: true }]) {
  assert.notEqual(published(build({ ...exit, ...change })).players.find(p => p.name === 'isaiahw')?.liveRatingTiming, 'post-match');
}
const future = { ...exit, id: 'live-newer', importedAt: '2026-11-01T03:56:36.861Z', resultReason: undefined,
  winner: undefined, localRating: 1650 };
assert.equal(published(build(exit, future)).players.find(p => p.name === 'isaiahw')!.latestLiveRating, 1650);
assert.equal(published(build(exit, { ...exit, resultReason: undefined, winner: 'isaiahw' })).players.find(p => p.name === 'isaiahw')!.latestLiveRating, 1623,
  'A confirmed result takes precedence over an inferred duplicate');
assert.notEqual(published(build(exit, { ...exit, localRating: 1600 })).players.find(p => p.name === 'seality5')!.liveRatingTiming, 'post-match',
  'Either disputed starting rating blocks the calculation');
console.log('Client-close Live ratings: correct loss, no Trace admission, no double application, newer observations and conflicts respected');

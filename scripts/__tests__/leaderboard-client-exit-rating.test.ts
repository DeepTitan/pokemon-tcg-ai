import assert from 'node:assert/strict';
import { buildLeaderboardDataset } from '../export-trace-leaderboard.js';
import { projectPublicLeaderboardSnapshot } from '../leaderboard-public-snapshot.js';
import { replayEloRatings, traceRatingEvents } from '../../src/leaderboard/elo.js';
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
assert.equal(replayEloRatings(traceRatingEvents(view), view.players).ratedMatchCount, 1);
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
console.log('Client-close Live ratings: correct loss, Trace forfeit admission, no double application, newer observations and conflicts respected');
assert.equal(view.clientExitMatches?.length, 1);
assert.equal(view.clientExitMatches![0].confirmed, false);
assert.equal(view.clientExitMatches![0].resultReason, 'local-client-closed');
assert.deepEqual(view.clientExitMatches![0].liveRatings, Object.fromEntries(view.players.map(p => [p.id, p.liveRatingBefore])));
assert.equal(published(build(exit, exit)).clientExitMatches?.length, 1, 'Duplicate captures create one history row');
assert.equal(published(build(exit, future)).clientExitMatches?.length, 1, 'Keep historical client-close games after a newer observation');
assert.equal(published(build(exit, { ...exit, localRating: 1600 })).clientExitMatches?.length, 0, 'Do not publish a disputed client-close calculation');
const secretHistory = build({ ...exit, rawLog: 'PRIVATE', history: { players: {
  isaiahw: { pokemon: { name: 'Dragapult ex', cardId: 'sv6_130', secret: 'PRIVATE' }, prizesTaken: 1, decklist: 'PRIVATE' },
  seality5: { prizesTaken: 2 },
}, rawLog: 'PRIVATE' } });
const safe = published(secretHistory);
assert.ok(!JSON.stringify(safe).includes('PRIVATE'));
assert.equal(safe.clientExitMatches![0].history!.players[isaiah.id].prizesTaken, 1);
assert.throws(() => projectPublicLeaderboardSnapshot({ ...view, clientExitMatches: [{ ...view.clientExitMatches![0], confirmed: true }] }));

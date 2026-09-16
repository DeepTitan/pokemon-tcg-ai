import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createWorker, keysFromEvent, type SourceKey, type IndexedMatch, type ReviewObject, type WorkerStore, type SnapshotObject } from './worker.js';
import { sourceKeyFor, createHistoricalEnrichment, applyHistoricalEnrichment, projectCloudReview, buildPublicSnapshot, type SourceProjection } from './projector.js';
import { replayEloRatings, ACTIVE_ELO_OPTIONS } from '../../src/leaderboard/elo.js';
import { projectLeaderboardReview } from '../../scripts/export-trace-leaderboard.js';

const first = { deviceId: 'device-alice-123456', matchId: 'live-game-1' };
const second = { deviceId: 'device-bob-12345678', matchId: 'live-game-1' };
const raw = { id: first.matchId, source: 'live-network', importedAt: '2026-09-16T12:00:00Z',
  localPlayer: 'Alice', opponent: 'Bob', winner: 'Alice', localRating: 1900, opponentRating: 1800,
  turns: [{ snapshot: { players: {} } }], rawLog: 'PRIVATE LOG', privateField: 'PRIVATE SECRET' };
const rawBefore = JSON.stringify(raw);
const projected = projectLeaderboardReview(raw);
const enrichment = createHistoricalEnrichment(projected, { ...projected, ratingAfter: 1912, ratingChange: 12,
  history: { players: { Alice: {}, Bob: {} }, durationSeconds: 300 } }, sourceKeyFor(first.deviceId, first.matchId));
const enriched = applyHistoricalEnrichment(projected, enrichment);
assert.equal(enriched.ratingAfter, 1912);
assert.equal((enriched.history as { durationSeconds: number }).durationSeconds, 300);
assert.equal(applyHistoricalEnrichment({ ...projected, winner: 'Bob' }, enrichment).ratingAfter, undefined, 'An outcome correction invalidates old after-score enrichment');
assert.equal(applyHistoricalEnrichment({ ...projected, localRating: 1700 }, enrichment).ratingAfter, undefined, 'A before-score correction invalidates old enrichment');
assert.equal(applyHistoricalEnrichment({ ...projected, ratingAfter: 1920 }, enrichment).ratingAfter, 1920, 'New cloud after-score takes priority');
assert.throws(() => createHistoricalEnrichment(projected, { ...projected, winner: 'Bob' }, enrichment.sourceKey), /same match facts/);
const missingScore = { ...projected, localRating: undefined, opponentRating: undefined };
assert.doesNotThrow(() => createHistoricalEnrichment(missingScore, projected, enrichment.sourceKey));
assert.throws(() => createHistoricalEnrichment(projected, { ...projected, localRating: 1500 }, enrichment.sourceKey), /same match facts/);

// A partial backfill can know the recorder's after-score before another source
// supplies their before-score. The normal exported JSON omits optional undefined
// properties; the worker must preserve that transport behavior before allowlisting.
const partialSource = projectCloudReview({ sourceKey: 'partial-source', matchId: first.matchId,
  review: { ...raw, localRating: undefined, ratingAfter: 1912, ratingChange: 12 }, catalog: new Map() });
const partialSnapshot = buildPublicSnapshot([partialSource], '2026-09-16T13:00:00Z');
const partialAlice = partialSnapshot.players.find(player => player.name === 'Alice')!;
assert.equal(partialAlice.latestLiveRating, 1912);
assert.equal(partialAlice.liveRatingTiming, 'post-match');
assert.equal(Object.hasOwn(partialAlice, 'liveRatingBefore'), false, 'Unknown before-score is absent, not undefined or null');
assert.equal(partialAlice.liveRatingChange, 12);
assert.equal(replayEloRatings(partialSnapshot.matches, partialSnapshot.players, ACTIVE_ELO_OPTIONS).ratedMatchCount, 0,
  'An after-score never qualifies a match whose before-score is missing');

const records = new Map<string, SourceProjection>();
const reviews = new Map<string, { index: IndexedMatch; object: ReviewObject }>();
let publications: SnapshotObject[] = [], failPublish = false, indexReads = 0;
function putReview(key: SourceKey, review: unknown, version = 'v1') {
  const objectKey = `devices/${key.deviceId}/matches/${createHash('sha256').update(key.matchId).digest('hex')}.json.gz`;
  reviews.set(sourceKeyFor(key.deviceId, key.matchId), { index: { objectKey, objectVersionId: version }, object: { bytes: gzipSync(JSON.stringify(review)), versionId: version } });
}
const store: WorkerStore = {
  async readIndex(key) { indexReads++; return reviews.get(sourceKeyFor(key.deviceId, key.matchId))?.index; },
  async readReview(index) { const entry = [...reviews.values()].find(value => value.index.objectKey === index.objectKey)!;
    assert.equal(index.objectVersionId, entry.object.versionId); return entry.object; },
  async putProjection(projection) { records.set(projection.sourceKey, structuredClone(projection)); },
  async deleteProjection(key) { records.delete(key); },
  async scanProjections() { return [...records.values()].reverse(); },
  async publishSnapshot(snapshot) { if (failPublish) { failPublish = false; throw new Error('temporary publication failure'); } publications.push(snapshot); },
};
const worker = createWorker(store, { catalog: new Map(), enrichments: [enrichment] }, () => '2026-09-16T13:00:00Z');
const snapshot = () => JSON.parse(gunzipSync(publications.at(-1)!.bytes).toString('utf8'));
const replay = () => replayEloRatings(snapshot().matches, snapshot().players, ACTIVE_ELO_OPTIONS);

putReview(first, raw);
failPublish = true;
await assert.rejects(worker({ action: 'backfill', keys: [first] }), /temporary publication/);
assert.equal(records.size, 1, 'Source writes can survive a failed publication');
assert.equal(publications.length, 0);
await worker({ action: 'backfill', keys: [first] });
assert.equal(publications.length, 1, 'Retry must rebuild even when the current projection already exists');
assert.equal(replay().ratedMatchCount, 1);
assert.equal(JSON.stringify(snapshot()).includes('PRIVATE'), false);
assert.equal(JSON.stringify([...records.values()]).includes('PRIVATE'), false, 'Even private source projections discard full logs/decks');
assert.equal(snapshot().players.find((p: { name: string }) => p.name === 'Alice').latestLiveRating, 1912);
assert.equal(snapshot().matches[0].history.durationSeconds, 300);
assert.equal(JSON.stringify(raw), rawBefore);

putReview(second, { ...raw, localPlayer: 'Bob', opponent: 'Alice', localRating: 1800, opponentRating: 1900 });
await worker({ action: 'backfill', keys: [second] });
assert.equal(replay().ratedMatchCount, 1, 'Both recorders still describe one match');
assert.equal(snapshot().players.filter((p: { traceStatus: string }) => p.traceStatus === 'trace-user').length, 2);
assert.notEqual(sourceKeyFor(first.deviceId, first.matchId), sourceKeyFor(second.deviceId, second.matchId));

const late = { ...first, matchId: 'live-earlier-game' };
putReview(late, { ...raw, id: late.matchId, importedAt: '2026-09-15T10:00:00Z', winner: 'Bob' });
await worker({ action: 'backfill', keys: [late] });
assert.equal(snapshot().matches[0].id, late.matchId, 'Late uploads replay in match-time order');
const expected = buildPublicSnapshot([...records.values()], '2026-09-16T13:00:00Z');
assert.deepEqual(snapshot(), expected);

putReview(first, { ...raw, winner: 'Bob' }, 'corrected-v2');
const event = { Records: [first, first].map(key => ({ eventSource: 'aws:dynamodb', eventName: 'MODIFY',
  dynamodb: { Keys: { deviceId: { S: key.deviceId }, matchId: { S: key.matchId } }, OldImage: { ignored: 'old revision' } } })) };
const readsBefore = indexReads;
await worker(event);
assert.equal(indexReads - readsBefore, 1, 'Duplicate source events fetch the latest current revision once');
assert.equal(replay().ratedMatchCount, 1, 'Conflicting recorder outcomes exclude the disputed game');
assert.equal(records.get(sourceKeyFor(first.deviceId, first.matchId))!.review.ratingAfter, undefined);
putReview(second, { ...raw, localPlayer: 'Bob', opponent: 'Alice', localRating: 1800, opponentRating: 1900, winner: 'Bob' }, 'corrected-v2');
await worker({ action: 'backfill', keys: [second] });
assert.equal(replay().ratedMatchCount, 2, 'Matching corrections restore the game without freezing historical IDs');

reviews.delete(sourceKeyFor(second.deviceId, second.matchId));
await worker({ action: 'backfill', keys: [second] });
assert.equal(records.size, 2, 'A missing current index row removes that recorder projection');
assert.equal(replay().ratedMatchCount, 2, 'The other recorder still supplies the match');
const publicationCount = publications.length;
await worker({ action: 'rebuild' });
assert.equal(publications.length, publicationCount + 1);
assert.deepEqual(keysFromEvent({ action: 'rebuild' }), []);
assert.throws(() => keysFromEvent({ body: '{}' }), /Expected a source stream/);
assert.throws(() => projectCloudReview({ sourceKey: 'x', matchId: 'wrong', review: raw, catalog: new Map() }), /identity mismatch/);
putReview(first, { ...raw, id: 'wrong' });
await assert.rejects(worker({ action: 'backfill', keys: [first] }), /identity mismatch/);
assert.equal(publications.length, publicationCount + 1, 'Failed input validation cannot replace the last good snapshot');
console.log('Leaderboard worker: source replacement, retry-safe publication, chronological replay, duplicate/conflict corrections, guarded migration, and private-data omission verified');

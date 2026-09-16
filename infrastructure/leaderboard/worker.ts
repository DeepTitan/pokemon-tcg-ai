import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { buildPublicSnapshot, projectCloudReview, sourceKeyFor, type HistoricalEnrichment, type SourceProjection } from './projector.js';
import type { CardInfo } from '../../src/tracker/types.js';
import type { LiveRatingAudit } from '../../scripts/export-trace-leaderboard.js';
import { buildLeaderboardCardCatalog } from '../../scripts/leaderboard-card-catalog.js';

export interface SourceKey { deviceId: string; matchId: string }
export interface IndexedMatch {
  objectKey: string;
  objectVersionId?: string;
  updatedAt?: string;
}
export interface ReviewObject { bytes: Uint8Array; versionId?: string; etag?: string }
export interface SnapshotObject { bytes: Uint8Array; sha256: string; generatedAt: string }
export interface WorkerStore {
  readIndex(key: SourceKey): Promise<IndexedMatch | undefined>;
  readReview(index: IndexedMatch): Promise<ReviewObject>;
  putProjection(projection: SourceProjection): Promise<void>;
  deleteProjection(sourceKey: string): Promise<void>;
  scanProjections(): Promise<SourceProjection[]>;
  publishSnapshot(snapshot: SnapshotObject): Promise<void>;
}
export const PUBLISHER_LOCK_KEY = '__publisher_lock';
// Longer than this worker's configured 300-second Lambda execution timeout.
export const PUBLISHER_LEASE_SECONDS = 360;
export interface PublisherLease {
  acquire(owner: string, expiresAt: number, now: number): Promise<boolean>;
  release(owner: string): Promise<void>;
}
export class PublisherLeaseBusyError extends Error {
  constructor() { super('The leaderboard publisher is busy; retry this event.'); this.name = 'PublisherLeaseBusyError'; }
}

/** Serialize the entire read/update/replay/publication transaction across Lambda
 * instances. Busy invocations fail before touching source rows; AWS retries them.
 * A timed-out invocation's lease expires without depending on finally execution.
 */
export function withPublisherLease<T>(worker: (event: unknown) => Promise<T>, lease: PublisherLease,
  clock = () => Math.floor(Date.now() / 1000), newOwner: () => string = randomUUID) {
  return async (event: unknown): Promise<T> => {
    const owner = newOwner(), now = clock();
    if (!Number.isSafeInteger(now) || now < 0 || !owner) throw new Error('Invalid publisher lease identity or time');
    if (!await lease.acquire(owner, now + PUBLISHER_LEASE_SECONDS, now)) throw new PublisherLeaseBusyError();
    let workerFailed = false;
    try { return await worker(event); }
    catch (error) { workerFailed = true; throw error; }
    finally {
      try { await lease.release(owner); }
      catch (error) { if (!workerFailed) throw error; }
    }
  };
}
export interface WorkerAssets {
  catalog: ReadonlyMap<string, CardInfo>;
  historicalAudit?: LiveRatingAudit;
  enrichments?: readonly HistoricalEnrichment[];
}
type JsonRecord = Record<string, unknown>;
const object = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
function sourceKey(value: unknown): SourceKey {
  const key = object(value);
  if (typeof key.deviceId !== 'string' || !/^[A-Za-z0-9._-]{16,128}$/.test(key.deviceId)
    || typeof key.matchId !== 'string' || !/^[A-Za-z0-9._:-]{1,220}$/.test(key.matchId)) throw new TypeError('Invalid source key');
  return { deviceId: key.deviceId, matchId: key.matchId };
}

export function keysFromEvent(value: unknown): SourceKey[] {
  const event = object(value);
  let keys: SourceKey[];
  if (event.action === 'rebuild') return [];
  if (event.action === 'backfill' && Array.isArray(event.keys)) keys = event.keys.map(sourceKey);
  else if (Array.isArray(event.Records)) keys = event.Records.map(value => {
    const record = object(value), keys = object(object(record.dynamodb).Keys);
    if (record.eventSource !== 'aws:dynamodb') throw new TypeError('Only DynamoDB source events are supported');
    return sourceKey({ deviceId: object(keys.deviceId).S, matchId: object(keys.matchId).S });
  });
  else throw new TypeError('Expected a source stream, backfill, or rebuild event');
  return [...new Map(keys.map(key => [sourceKeyFor(key.deviceId, key.matchId), key])).values()];
}

/** The production caller holds a publisher lease. Every successful retry rebuilds,
 * even when source writes from the previous attempt already succeeded. Therefore
 * a failed publication cannot be lost by an "already processed" shortcut.
 */
export function createWorker(store: WorkerStore, assets: WorkerAssets, clock = () => new Date().toISOString()) {
  const enrichments = new Map(assets.enrichments?.map(value => [value.sourceKey, value]) ?? []);
  return async function worker(event: unknown) {
    const keys = keysFromEvent(event);
    for (const key of keys) {
      const id = sourceKeyFor(key.deviceId, key.matchId);
      const index = await store.readIndex(key);
      if (!index) { await store.deleteProjection(id); continue; }
      const expectedKey = `devices/${key.deviceId}/matches/${createHash('sha256').update(key.matchId).digest('hex')}.json.gz`;
      if (index.objectKey !== expectedKey) throw new Error('Cloud index object identity mismatch');
      const body = await store.readReview(index);
      const review = JSON.parse(gunzipSync(body.bytes, { maxOutputLength: 128 * 1024 * 1024 }).toString('utf8'));
      const projection = projectCloudReview({ sourceKey: id, matchId: key.matchId, review, catalog: assets.catalog,
        enrichment: enrichments.get(id), sourceRevision: body.versionId ?? body.etag, sourceUpdatedAt: index.updatedAt });
      await store.putProjection(projection);
    }
    const generatedAt = clock();
    const snapshot = buildPublicSnapshot(await store.scanProjections(), generatedAt, assets.historicalAudit);
    const json = Buffer.from(JSON.stringify(snapshot));
    const sha256 = createHash('sha256').update(json).digest('hex');
    await store.publishSnapshot({ bytes: gzipSync(json), sha256, generatedAt });
    return { processedSources: keys.length, generation: sha256, generatedAt, players: snapshot.players.length, matches: snapshot.matches.length };
  };
}

async function readAsset(name: string): Promise<unknown> {
  return JSON.parse(gunzipSync(await readFile(new URL(`./assets/${name}.json.gz`, import.meta.url))).toString('utf8'));
}
export async function loadAssets(): Promise<WorkerAssets> {
  const [cards, printed, audit, enrichments] = await Promise.all([
    readAsset('catalog'), readAsset('printed-catalog'), readAsset('historical-audit'), readAsset('historical-enrichment'),
  ]);
  if (!Array.isArray(cards) || !Array.isArray(object(printed).cards) || !Array.isArray(enrichments)) {
    throw new TypeError('Invalid leaderboard worker assets');
  }
  const catalog = buildLeaderboardCardCatalog(object(printed).cards as CardInfo[], cards as CardInfo[]);
  return { catalog, historicalAudit: audit as LiveRatingAudit, enrichments: enrichments as HistoricalEnrichment[] };
}

/** Load the Lambda-provided AWS SDK only in production; tests inject a store. */
export async function createAwsStore(env: NodeJS.ProcessEnv = process.env): Promise<WorkerStore & PublisherLease> {
  const sourceTable = env.SOURCE_TABLE, matchesTable = env.MATCHES_TABLE, bucket = env.PAYLOAD_BUCKET, snapshotKey = env.SNAPSHOT_KEY;
  if (!sourceTable || !matchesTable || !bucket || snapshotKey !== 'leaderboard/snapshot.json.gz') throw new Error('Missing or invalid leaderboard worker configuration');
  // These imports remain external in the worker bundle and use Node24 Lambda's SDK.
  const dynamoModule = '@aws-sdk/client-dynamodb', s3Module = '@aws-sdk/client-s3';
  const ddb = await import(dynamoModule), s3sdk = await import(s3Module);
  const dynamo = new ddb.DynamoDBClient({}), s3 = new s3sdk.S3Client({});
  return {
    async acquire(owner, expiresAt, now) {
      try {
        await dynamo.send(new ddb.PutItemCommand({ TableName: sourceTable,
          Item: { sourceKey: { S: PUBLISHER_LOCK_KEY }, owner: { S: owner }, expiresAt: { N: String(expiresAt) } },
          ConditionExpression: 'attribute_not_exists(sourceKey) OR #expiry <= :now',
          ExpressionAttributeNames: { '#expiry': 'expiresAt' }, ExpressionAttributeValues: { ':now': { N: String(now) } },
        }));
        return true;
      } catch (error) {
        if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return false;
        throw error;
      }
    },
    async release(owner) {
      try {
        await dynamo.send(new ddb.DeleteItemCommand({ TableName: sourceTable, Key: { sourceKey: { S: PUBLISHER_LOCK_KEY } },
          ConditionExpression: '#owner = :owner', ExpressionAttributeNames: { '#owner': 'owner' },
          ExpressionAttributeValues: { ':owner': { S: owner } },
        }));
      } catch (error) {
        // A former owner must never remove a newer invocation's lease.
        if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
      }
    },
    async readIndex(key) {
      const response = await dynamo.send(new ddb.GetItemCommand({ TableName: matchesTable, ConsistentRead: true,
        Key: { deviceId: { S: key.deviceId }, matchId: { S: key.matchId } } }));
      const item = response.Item;
      if (!item) return undefined;
      if (!item.objectKey?.S) throw new Error('Cloud index is missing its review object');
      return { objectKey: item.objectKey.S, objectVersionId: item.objectVersionId?.S ?? item.versionId?.S, updatedAt: item.updatedAt?.S };
    },
    async readReview(index) {
      const response = await s3.send(new s3sdk.GetObjectCommand({ Bucket: bucket, Key: index.objectKey,
        ...(index.objectVersionId ? { VersionId: index.objectVersionId } : {}) }));
      if (!response.Body) throw new Error('Cloud review has no body');
      return { bytes: await response.Body.transformToByteArray(), versionId: response.VersionId, etag: response.ETag };
    },
    async putProjection(projection) {
      await dynamo.send(new ddb.PutItemCommand({ TableName: sourceTable, Item: {
        sourceKey: { S: projection.sourceKey }, matchId: { S: projection.matchId }, reviewJson: { S: JSON.stringify(projection.review) },
        ...(projection.sourceRevision ? { sourceRevision: { S: projection.sourceRevision } } : {}),
        ...(projection.sourceUpdatedAt ? { sourceUpdatedAt: { S: projection.sourceUpdatedAt } } : {}),
      } }));
    },
    async deleteProjection(key) {
      await dynamo.send(new ddb.DeleteItemCommand({ TableName: sourceTable, Key: { sourceKey: { S: key } } }));
    },
    async scanProjections() {
      const records: SourceProjection[] = [];
      let cursor: Record<string, unknown> | undefined;
      do {
        const response = await dynamo.send(new ddb.ScanCommand({ TableName: sourceTable, ConsistentRead: true, ExclusiveStartKey: cursor }));
        for (const row of response.Items ?? []) {
          if (row.sourceKey?.S === PUBLISHER_LOCK_KEY) continue;
          if (!row.sourceKey?.S || !row.matchId?.S || !row.reviewJson?.S) throw new Error('Invalid stored source projection');
          records.push({ sourceKey: row.sourceKey.S, matchId: row.matchId.S, review: JSON.parse(row.reviewJson.S),
            sourceRevision: row.sourceRevision?.S, sourceUpdatedAt: row.sourceUpdatedAt?.S });
        }
        cursor = response.LastEvaluatedKey && Object.keys(response.LastEvaluatedKey).length ? response.LastEvaluatedKey : undefined;
      } while (cursor);
      return records;
    },
    async publishSnapshot(snapshot) {
      await s3.send(new s3sdk.PutObjectCommand({ Bucket: bucket, Key: snapshotKey, Body: snapshot.bytes,
        ContentType: 'application/json', ContentEncoding: 'gzip', CacheControl: 'public, max-age=15', ServerSideEncryption: 'AES256',
        Metadata: { contentsha256: snapshot.sha256, generatedat: snapshot.generatedAt } }));
    },
  };
}

let runtime: Promise<ReturnType<typeof createWorker>> | undefined;
export async function handler(event: unknown) {
  runtime ??= Promise.all([createAwsStore(), loadAssets()]).then(([store, assets]) => withPublisherLease(createWorker(store, assets), store))
    .catch(error => { runtime = undefined; throw error; });
  return (await runtime)(event);
}

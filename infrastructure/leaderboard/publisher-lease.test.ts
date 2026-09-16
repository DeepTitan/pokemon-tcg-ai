import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createWorker, withPublisherLease, PublisherLeaseBusyError, PUBLISHER_LEASE_SECONDS,
  type PublisherLease, type SourceKey, type WorkerStore, type SnapshotObject } from './worker.js';
import { sourceKeyFor, type SourceProjection } from './projector.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
class MemoryLease implements PublisherLease {
  current?: { owner: string; expiresAt: number };
  async acquire(owner: string, expiresAt: number, now: number) {
    if (this.current && this.current.expiresAt > now) return false;
    this.current = { owner, expiresAt };
    return true;
  }
  async release(owner: string) { if (this.current?.owner === owner) this.current = undefined; }
  owner() { return this.current?.owner; }
}
const lease = new MemoryLease(), enteredPublish = deferred(), finishPublish = deferred();
const first = { deviceId: 'device-first-12345', matchId: 'live-first' };
const second = { deviceId: 'device-second-1234', matchId: 'live-second' };
const objectKey = (key: SourceKey) => `devices/${key.deviceId}/matches/${createHash('sha256').update(key.matchId).digest('hex')}.json.gz`;
const sources = new Map<string, SourceProjection>(), published: SnapshotObject[] = [];
let reads = 0, writes = 0, shouldHold = true, failPublish = false, now = 1000, sequence = 0;
const store: WorkerStore = {
  async readIndex(key) { reads++; return { objectKey: objectKey(key), objectVersionId: 'latest' }; },
  async readReview(index) {
    const key = [first, second].find(key => objectKey(key) === index.objectKey)!;
    return { bytes: gzipSync(JSON.stringify({ id: key.matchId, source: 'live-network', importedAt: '2026-09-16T12:00:00Z',
      localPlayer: 'Alice', opponent: 'Bob', winner: key === first ? 'Alice' : 'Bob', localRating: 1800, opponentRating: 1800 })), versionId: 'latest' };
  },
  async putProjection(source) { writes++; sources.set(source.sourceKey, source); },
  async deleteProjection(id) { writes++; sources.delete(id); },
  async scanProjections() { return [...sources.values()]; },
  async publishSnapshot(snapshot) {
    if (shouldHold) { shouldHold = false; enteredPublish.resolve(); await finishPublish.promise; }
    if (failPublish) { failPublish = false; throw new Error('publish failed'); }
    published.push(snapshot);
  },
};
const worker = withPublisherLease(createWorker(store, { catalog: new Map() }), lease, () => now, () => `owner-${++sequence}`);
const event = (key: SourceKey) => ({ action: 'backfill', keys: [key] });

const runningA = worker(event(first));
await enteredPublish.promise;
assert.equal(sources.size, 1);
assert.equal(lease.current?.expiresAt, now + PUBLISHER_LEASE_SECONDS);
const beforeB = { reads, writes };
await assert.rejects(worker(event(second)), PublisherLeaseBusyError);
assert.deepEqual({ reads, writes }, beforeB, 'A busy invocation cannot even read the source index or mutate projections');
assert.equal(sources.has(sourceKeyFor(second.deviceId, second.matchId)), false);
finishPublish.resolve();
await runningA;
assert.equal(lease.current, undefined, 'Successful publication releases the lease');
await worker(event(second));
assert.equal(sources.size, 2);
assert.equal(JSON.parse(gunzipSync(published.at(-1)!.bytes).toString('utf8')).matches.length, 2,
  'After acquiring the released lease, B rebuilds from both A and B sources');

failPublish = true;
await assert.rejects(worker(event(first)), /publish failed/);
assert.equal(lease.current, undefined, 'A failed publish releases the lease for retry');
const count = published.length;
await worker(event(first));
assert.equal(published.length, count + 1, 'Retry replays and publishes after a persisted source write');

// Simulate an invocation killed by Lambda before finally can run.
lease.current = { owner: 'timed-out-owner', expiresAt: now + PUBLISHER_LEASE_SECONDS };
await assert.rejects(worker({ action: 'rebuild' }), PublisherLeaseBusyError);
now += PUBLISHER_LEASE_SECONDS;
await worker({ action: 'rebuild' });
assert.equal(lease.current, undefined, 'An expired lease is replaceable without a waiting invocation');
await lease.acquire('old', now + 1, now);
await lease.acquire('new', now + 400, now + 2);
await lease.release('old');
assert.equal(lease.owner(), 'new', 'Releasing an old invocation cannot delete the new owner');
await lease.release('new');

const original = new Error('original worker failure'), releaseFailure = new Error('release failed');
const failingRelease: PublisherLease = { async acquire() { return true; }, async release() { throw releaseFailure; } };
await assert.rejects(withPublisherLease(async () => { throw original; }, failingRelease)({ action: 'rebuild' }),
  error => error === original, 'A release error must not mask the work failure');
await assert.rejects(withPublisherLease(async () => 'published', failingRelease)({ action: 'rebuild' }),
  error => error === releaseFailure, 'If publication succeeded but release failed, surface the error for retry');
assert.equal(PUBLISHER_LEASE_SECONDS, 360, 'Lease exceeds the infrastructure Lambda timeout of 300 seconds');
console.log('Publisher lease: overlapping work excluded before mutations, full replay after release, expired-lock recovery, owner-safe release, and original failure preservation verified');

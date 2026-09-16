import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { isLeaderboardSnapshot, startSnapshotRefresh, type LeaderboardSnapshot, type SnapshotRefreshRuntime, type SnapshotRefreshStatus } from '../snapshot-refresh.js';

const snapshot = (revision?: string): LeaderboardSnapshot => ({
  schema: 'trace-leaderboard/v1', generatedAt: '2026-09-16T12:00:00Z', sourceLabel: 'Trace matches', revision,
  players: [{ id: 'alice', name: 'Alice', traceStatus: 'trace-user' }, { id: 'bob', name: 'Bob', traceStatus: 'opponent-only' }],
  matches: [{ id: 'match-1', playedAt: '2026-09-16T11:00:00Z', playerIds: ['alice', 'bob'], confirmed: true,
    outcome: { type: 'win', winnerId: 'alice' }, phase: 'ranked', liveRatings: { alice: 1800, bob: 1750 } }],
});
const json = (value: unknown, etag?: string) => new Response(JSON.stringify(value), { headers: etag ? { ETag: etag } : undefined });

function harness(visible = true) {
  let time = 1_000;
  let nextTimer = 0;
  let active = visible;
  const timers = new Map<number, { due: number; callback(): void }>();
  const listeners = new Set<() => void>();
  const requests: { url: unknown; init: RequestInit; resolve(response: Response): void; reject(error: Error): void }[] = [];
  const snapshots: LeaderboardSnapshot[] = [];
  const statuses: SnapshotRefreshStatus[] = [];
  const runtime: SnapshotRefreshRuntime = {
    fetch: ((url: unknown, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
      requests.push({ url, init, resolve, reject });
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })) as typeof fetch,
    now: () => time, visible: () => active,
    schedule(callback, milliseconds) { const id = ++nextTimer; timers.set(id, { due: time + milliseconds, callback }); return id; },
    cancel(id) { timers.delete(id); },
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
  };
  const stop = startSnapshotRefresh({ url: '/trace/leaderboard-static/events.json', runtime,
    onSnapshot: value => snapshots.push(value), onStatus: value => statuses.push(value) });
  return {
    requests, snapshots, statuses, timers, listeners, stop,
    latest: () => statuses[statuses.length - 1],
    activity() { for (const listener of listeners) listener(); },
    visibility(value: boolean) { active = value; this.activity(); },
    async advance(milliseconds: number) {
      const until = time + milliseconds;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        time = next[1].due; timers.delete(next[0]); next[1].callback(); await setImmediate();
      }
      time = until;
    },
    async respond(index: number, response: Response) { requests[index].resolve(response); await setImmediate(); },
  };
}

test('initial load polls after 15 seconds, sends ETags, and keeps the snapshot on 304', async () => {
  const app = harness();
  try {
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].url, '/trace/leaderboard-static/events.json');
    assert.equal(app.requests[0].init.cache, 'no-store');
    assert.equal(app.latest().checking, true);
    await app.respond(0, json(snapshot(), '"v1"'));
    assert.equal(app.snapshots.length, 1);
    assert.equal(app.latest().lastCheckedAt, 1_000);
    await app.advance(14_999); assert.equal(app.requests.length, 1);
    await app.advance(1); assert.equal(app.requests.length, 2);
    assert.equal(new Headers(app.requests[1].init.headers).get('If-None-Match'), '"v1"');
    await app.respond(1, new Response(null, { status: 304 }));
    assert.equal(app.snapshots.length, 1, '304 does not replace data or trigger a rating replay');
    assert.deepEqual(app.latest(), { checking: false, failed: false, lastCheckedAt: 16_000 });
    const changed = snapshot(); changed.players[0].name = 'Alice renamed';
    await app.advance(15_000); await app.respond(2, json(changed, '"v2"'));
    assert.equal(app.snapshots.length, 2);
    assert.equal(app.snapshots[1].players[0].name, 'Alice renamed');
  } finally { app.stop(); }
});

test('unchanged content, revision and ETag never replace the current data', async () => {
  const app = harness();
  try {
    await app.respond(0, json(snapshot('r1'), '"v1"'));
    app.activity(); await app.respond(1, new Response('not parsed when the ETag is unchanged', { headers: { ETag: '"v1"' } }));
    assert.equal(app.snapshots.length, 1);
    const sameContent = snapshot('r2'); sameContent.generatedAt = '2026-09-16T13:00:00Z';
    app.activity(); await app.respond(2, json(sameContent));
    assert.equal(app.snapshots.length, 1, 'A regenerated timestamp does not replay identical data');
    const changed = snapshot('r2'); changed.players[0].name = 'New name';
    app.activity(); await app.respond(3, json(changed));
    assert.equal(app.snapshots.length, 1, 'An unchanged revision keeps the accepted snapshot');
    changed.revision = 'r3';
    app.activity(); await app.respond(4, json(changed));
    assert.equal(app.snapshots.length, 2, 'A later revision is compared against the displayed snapshot');
  } finally { app.stop(); }
});

test('visibility pauses polling; focus/online activity refreshes immediately without overlaps', async () => {
  const app = harness(false);
  try {
    assert.equal(app.requests.length, 0);
    app.activity(); assert.equal(app.requests.length, 0);
    app.visibility(true); assert.equal(app.requests.length, 1);
    app.activity(); app.activity(); assert.equal(app.requests.length, 1, 'Concurrent focus/online events share the pending request');
    await app.respond(0, json(snapshot()));
    app.visibility(false); await app.advance(120_000);
    assert.equal(app.requests.length, 1);
    app.visibility(true); assert.equal(app.requests.length, 2);
    await app.respond(1, json(snapshot()));
    app.activity(); assert.equal(app.requests.length, 3, 'Focus or online activity does not wait for the next poll');
  } finally { app.stop(); }
});

test('HTTP, malformed snapshot and network errors retain data and the last successful check', async () => {
  const app = harness();
  try {
    await app.respond(0, json(snapshot(), '"good"'));
    for (const response of [new Response('unavailable', { status: 503 }), json({ players: [], matches: [] }), new Response('{broken')]) {
      await app.advance(15_000);
      await app.respond(app.requests.length - 1, response);
      assert.equal(app.snapshots.length, 1);
      assert.deepEqual(app.latest(), { checking: false, failed: true, lastCheckedAt: 1_000 });
    }
    app.activity(); app.requests.at(-1)!.reject(new Error('Offline')); await setImmediate();
    assert.equal(app.snapshots.length, 1); assert.equal(app.latest().failed, true);
    app.activity(); await app.respond(app.requests.length - 1, new Response(null, { status: 304 }));
    assert.equal(app.latest().failed, false); assert.equal(app.latest().lastCheckedAt, 46_000);
  } finally { app.stop(); }
});

test('timeouts permit retries and disposal aborts pending work without late callbacks', async () => {
  const app = harness();
  await app.advance(10_000);
  assert.equal(app.requests[0].init.signal?.aborted, true);
  assert.deepEqual(app.latest(), { checking: false, failed: true, lastCheckedAt: null });
  await app.advance(5_000); assert.equal(app.requests.length, 2, 'Request duration does not add to the 15-second polling interval');
  const statusCount = app.statuses.length;
  app.stop();
  assert.equal(app.requests[1].init.signal?.aborted, true);
  assert.equal(app.listeners.size, 0); assert.equal(app.timers.size, 0);
  await app.respond(1, json(snapshot())); await app.advance(60_000);
  assert.equal(app.snapshots.length, 0); assert.equal(app.statuses.length, statusCount); assert.equal(app.requests.length, 2);
});

test('initial 304 and malformed display fields cannot replace a valid snapshot', async () => {
  const app = harness();
  try {
    await app.respond(0, new Response(null, { status: 304 }));
    assert.equal(app.latest().failed, true); assert.equal(app.snapshots.length, 0);
    assert.equal(isLeaderboardSnapshot(snapshot()), true);
    assert.equal(isLeaderboardSnapshot({ ...snapshot(), generatedAt: 'not a date' }), false);
    assert.equal(isLeaderboardSnapshot({ ...snapshot(), players: [{ id: 'x', name: 23 }] }), false);
    const badHistory = snapshot();
    badHistory.matches[0].history = { players: { alice: { pokemon: { name: 42 as unknown as string } } } };
    assert.equal(isLeaderboardSnapshot(badHistory), false);
    app.activity(); await app.respond(1, json(snapshot()));
    assert.equal(app.latest().failed, false); assert.equal(app.snapshots.length, 1);
  } finally { app.stop(); }
});

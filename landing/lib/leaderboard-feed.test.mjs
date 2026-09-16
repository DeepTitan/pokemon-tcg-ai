import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeaderboardFeedLoader } from './leaderboard-feed.mjs';
import { createLeaderboardDataHandler } from '../api/leaderboard-data.mjs';

const snapshot = { schema: 'trace-leaderboard/v1', generatedAt: '2026-09-16T12:00:00Z', players: [], matches: [] };
const ok = value => ({ ok: true, json: async () => value });

test('coalesces requests, caches briefly, and strips private archive fields', async () => {
  let calls = 0, clock = 0;
  const load = createLeaderboardFeedLoader({ now: () => clock, fetcher: async (url, options) => {
    calls++; assert.equal(new URL(url).pathname, '/v1/leaderboard'); assert.equal(options.redirect, 'error');
    return ok({ ...snapshot, sources: ['private-device'], rawLog: 'private' });
  } });
  const [a, b] = await Promise.all([load(), load()]);
  assert.equal(calls, 1); assert.equal(a, b); assert.doesNotMatch(a.body, /private|sources|rawLog/);
  await load(); assert.equal(calls, 1);
  clock = 3001; const c = await load(); assert.equal(calls, 2); assert.equal(c.etag, a.etag);
});

test('failed or malformed refreshes never masquerade as a fresh snapshot and can recover', async () => {
  let clock = 0, mode = 'good';
  const load = createLeaderboardFeedLoader({ now: () => clock, fetcher: async () => mode === 'bad-status' ? { ok: false } : ok(mode === 'malformed' ? { secret: 'raw' } : snapshot) });
  await load(); clock = 3001; mode = 'bad-status'; await assert.rejects(load());
  mode = 'malformed'; await assert.rejects(load());
  mode = 'good'; assert.equal((await load()).snapshot.schema, 'trace-leaderboard/v1');
});

async function request(input = {}, loader = async () => ({ body: JSON.stringify(snapshot), etag: '"revision"' })) {
  const response = { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(body) { this.body = body; } };
  await createLeaderboardDataHandler(loader)({ method: 'GET', ...input }, response);
  return response;
}

test('GET, HEAD and conditional requests preserve correct cache and response semantics', async () => {
  const get = await request(); assert.equal(get.statusCode, 200); assert.equal(get.headers['cache-control'], 'no-store');
  const head = await request({ method: 'HEAD' }); assert.equal(head.statusCode, 200); assert.deepEqual(head.headers, get.headers); assert.equal(head.body, undefined);
  for (const tag of ['"revision"', 'W/"revision"', '"old", "revision"', '*']) {
    const response = await request({ headers: { 'if-none-match': tag } });
    assert.equal(response.statusCode, 304); assert.equal(response.body, undefined); assert.equal(response.headers['content-length'], undefined);
  }
  assert.equal((await request({ headers: { 'if-none-match': '"old"' } })).statusCode, 200);
});

test('errors are generic, retriable, and unsupported methods never load data', async () => {
  const broken = async () => { throw new Error('private bucket credentials'); };
  const result = await request({}, broken); assert.equal(result.statusCode, 503); assert.equal(result.headers['retry-after'], '15'); assert.doesNotMatch(result.body, /private|credentials/);
  assert.equal((await request({ method: 'HEAD' }, broken)).body, undefined);
  const post = await request({ method: 'POST' }, broken); assert.equal(post.statusCode, 405); assert.equal(post.headers.allow, 'GET, HEAD');
});

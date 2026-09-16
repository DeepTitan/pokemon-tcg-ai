import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeaderboardPageHandler, findLeaderboardPage } from '../api/leaderboard-page.mjs';

const pages = {
  version: 1,
  board: { html: '<!doctype html><title>Trace leaderboard</title>' },
  players: [
    { id: 'name-123', name: 'Eevee & friends / +?#', html: '<title>Eevee &amp; friends / +?# · Trace</title>' },
    { id: 'name-456', name: '__proto__', html: '<title>__proto__ · Trace</title>' },
    { id: 'name-789', name: '$& $` <player>', html: '<title>$&amp; $` &lt;player&gt; · Trace</title>' },
  ],
};

async function request(input = {}, loader = async () => pages) {
  const headers = {};
  const response = {
    statusCode: 0,
    headers,
    body: undefined,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; },
  };
  await createLeaderboardPageHandler(loader)({ method: 'GET', url: '/', ...input }, response);
  return response;
}

test('lookup returns only exact player names and IDs, including object-property-like names', () => {
  assert.equal(findLeaderboardPage(pages, undefined), pages.board.html);
  assert.equal(findLeaderboardPage(pages, pages.players[0].name), pages.players[0].html);
  assert.equal(findLeaderboardPage(pages, 'name-123'), pages.players[0].html);
  assert.equal(findLeaderboardPage(pages, '__proto__'), pages.players[1].html);
  for (const key of ['constructor', 'toString', 'NAME-123', '', null, ['name-123']]) {
    assert.equal(findLeaderboardPage(pages, key), null);
  }
});

test('board GET has HTML, cache, and content type headers', async () => {
  const response = await request();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, pages.board.html);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(response.headers['cache-control'], 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['content-length'], Buffer.byteLength(pages.board.html));
});

test('rewritten player/name queries and encoded URL parameters preserve special characters', async () => {
  for (const player of pages.players) {
    for (const input of [
      { query: { player: player.name } },
      { query: { name: player.name } },
      { query: { player: player.id } },
      { url: `/api/leaderboard-page?player=${encodeURIComponent(player.name)}` },
      { url: `/api/leaderboard-page?name=${encodeURIComponent(player.name)}` },
    ]) {
      const response = await request(input);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, player.html);
    }
  }
});

test('unknown and ambiguous players return an uncached generic 404', async () => {
  for (const input of [
    { query: { player: 'missing<script>' } },
    { query: { player: '' } },
    { query: { player: ['name-123', 'name-456'] } },
    { url: '/api/leaderboard-page?player=name-123&player=name-456' },
  ]) {
    const response = await request(input);
    assert.equal(response.statusCode, 404);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(response.body, /Player not found/);
    assert.doesNotMatch(response.body, /missing<script>/);
  }
});

test('HEAD preserves GET status and headers without a response body', async () => {
  for (const query of [{}, { player: 'name-123' }, { player: 'missing' }]) {
    const get = await request({ query });
    const head = await request({ method: 'HEAD', query });
    assert.equal(head.statusCode, get.statusCode);
    assert.deepEqual(head.headers, get.headers);
    assert.equal(head.body, undefined);
  }
});

test('non-read methods do not load the bundle and return 405', async () => {
  const response = await request({ method: 'POST' }, async () => { throw new Error('Should not load'); });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, 'GET, HEAD');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('bundle failures return an uncached generic response without internal error details', async () => {
  const loader = async () => { throw new Error('/private/path/secret.json is missing'); };
  const response = await request({}, loader);
  assert.equal(response.statusCode, 500);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.body, /The leaderboard could not be opened/);
  assert.doesNotMatch(response.body, /secret|private\/path/);
  const head = await request({ method: 'HEAD' }, loader);
  assert.equal(head.statusCode, 500);
  assert.equal(head.body, undefined);
});

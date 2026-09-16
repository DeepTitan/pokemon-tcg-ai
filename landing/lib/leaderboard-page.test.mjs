import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeaderboardPageHandler, findLeaderboardPlayer } from '../api/leaderboard-page.mjs';
import * as social from './generated/leaderboard-social-preview.mjs';

const pages = {
  version: 2,
  shell: '<!doctype html><html><head><meta charset="utf-8"><title>Trace</title><script src="/trace/leaderboard-static/assets/app.js"></script></head><body><div id="root"></div></body></html>',
  boardImage: { url: 'https://victoryroad.app/trace/leaderboard-static/previews/leaderboard.jpg?v=board', alt: 'The reviewed leaderboard screenshot.' },
  playerImages: [{ id: 'name-123', url: 'https://victoryroad.app/trace/leaderboard-static/previews/name-123.jpg?v=known', alt: 'The reviewed player screenshot.' }],
};
const snapshot = {
  schema: 'trace-leaderboard/v1', generatedAt: '2026-09-16T12:00:00Z', sourceLabel: 'Trace matches',
  players: [
    { id: 'name-123', name: 'Eevee & friends / +?#', traceStatus: 'trace-user' },
    { id: 'name-456', name: '__proto__', traceStatus: 'opponent-only' },
    { id: 'name-789', name: '$& $` <player>', traceStatus: 'trace-user' },
  ],
  matches: [{ id: 'match-1', playedAt: '2026-09-16T11:00:00Z', playerIds: ['name-123', 'name-456'], confirmed: true,
    phase: 'ranked', outcome: { type: 'win', winnerId: 'name-123' }, liveRatings: { 'name-123': 1800, 'name-456': 1800 } }],
};
const feed = value => ({ snapshot: value, etag: '"feed-revision"', body: JSON.stringify(value) });
const dependencies = { readPages: async () => pages, readFeed: async () => feed(snapshot), readSocial: async () => social };

async function request(input = {}, overrides = {}, handler = createLeaderboardPageHandler({ ...dependencies, ...overrides })) {
  const headers = {};
  const response = {
    statusCode: 0, headers, body: undefined,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; },
  };
  await handler({ method: 'GET', url: '/', ...input }, response);
  return response;
}

test('lookup uses the current roster and exact names or IDs, without object-property lookup', () => {
  assert.equal(findLeaderboardPlayer(snapshot, undefined), undefined);
  assert.equal(findLeaderboardPlayer(snapshot, snapshot.players[0].name), snapshot.players[0]);
  assert.equal(findLeaderboardPlayer(snapshot, 'name-123'), snapshot.players[0]);
  assert.equal(findLeaderboardPlayer(snapshot, '__proto__'), snapshot.players[1]);
  for (const key of ['constructor', 'toString', 'NAME-123', '', null, ['name-123']]) assert.equal(findLeaderboardPlayer(snapshot, key), null);
});

test('board metadata comes from current matches and cannot be held in a CDN cache', async () => {
  const response = await request();
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<title>Trace leaderboard<\/title>/);
  assert.match(response.body, /Explore 2 Trace players and 1 rated matches/);
  assert.match(response.body, /https:\/\/victoryroad\.app\/trace\/leaderboard"/);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  for (const header of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) assert.equal(response.headers[header], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['content-length'], Buffer.byteLength(response.body));
  assert.ok(response.body.indexOf('property="og:image"') < response.body.indexOf('</head>'));
});

test('known players keep their exact screenshot URL and alt text with current rating metadata', async () => {
  const response = await request({ query: { player: 'name-123' } });
  const expected = social.getPlayerSocialMetadata(snapshot, 'name-123', 'https://victoryroad.app');
  assert.equal(response.statusCode, 200);
  assert.ok(response.body.includes(social.escapePreviewHtml(expected.description)), 'SSR uses the existing chronological rating implementation');
  assert.ok(response.body.includes(pages.playerImages[0].url));
  assert.ok(response.body.includes(pages.playerImages[0].alt));
  assert.match(response.body, /og:image:width" content="1200"/);
  assert.match(response.body, /og:image:height" content="630"/);
});

test('new incoming players work without regenerating the shell or screenshot manifest', async () => {
  const current = structuredClone(snapshot);
  const options = { readFeed: async () => feed(current) };
  const warmHandler = createLeaderboardPageHandler({ ...dependencies, ...options });
  assert.equal((await request({ query: { player: 'New +?/# & $&' } }, options, warmHandler)).statusCode, 404);
  const newcomer = { id: 'new-incoming-player', name: 'New +?/# & $&', traceStatus: 'trace-user' };
  current.players.push(newcomer);
  current.matches.push({ ...current.matches[0], id: 'match-2', playedAt: '2026-09-16T12:01:00Z',
    playerIds: [newcomer.id, 'name-123'], outcome: { type: 'win', winnerId: newcomer.id }, liveRatings: { [newcomer.id]: 1900, 'name-123': 1800 } });
  const response = await request({ query: { player: newcomer.name } }, options, warmHandler);
  assert.equal(response.statusCode, 200);
  assert.ok(response.body.includes(`https://victoryroad.app/trace/players/${encodeURIComponent(newcomer.name)}`));
  assert.ok(response.body.includes(social.escapePreviewHtml(`${newcomer.name} · Trace`)));
  assert.match(response.body, /1W · 0L/);
  assert.ok(response.body.includes(pages.boardImage.url), 'An uncaptured player uses the board screenshot');
  assert.ok(response.body.includes(pages.boardImage.alt), 'The fallback image is described accurately');
  const board = await request({}, options, warmHandler);
  assert.match(board.body, /Explore 3 Trace players and 2 rated matches/);
  assert.equal(pages.playerImages.length, 1, 'The static screenshot manifest does not grow during a request');
});

test('rewritten player/name queries and encoded URL parameters preserve special characters', async () => {
  for (const player of snapshot.players) {
    for (const input of [
      { query: { player: player.name } }, { query: { name: player.name } }, { query: { player: player.id } },
      { url: `/api/leaderboard-page?player=${encodeURIComponent(player.name)}` },
      { url: `/api/leaderboard-page?name=${encodeURIComponent(player.name)}` },
    ]) {
      const response = await request(input);
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes(social.escapePreviewHtml(`${player.name} · Trace`)));
      assert.ok(response.body.includes(`https://victoryroad.app/trace/players/${encodeURIComponent(player.name)}`));
      assert.equal([...response.body.matchAll(/<title>/g)].length, 1, 'Replacement characters must not interpolate the old title');
    }
  }
});

test('unknown and ambiguous players return an uncached generic 404', async () => {
  for (const input of [
    { query: { player: 'missing<script>' } }, { query: { player: '' } },
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

test('HEAD preserves current GET status and headers without a response body', async () => {
  for (const query of [{}, { player: 'name-123' }, { player: 'missing' }]) {
    const get = await request({ query });
    const head = await request({ method: 'HEAD', query });
    assert.equal(head.statusCode, get.statusCode);
    assert.deepEqual(head.headers, get.headers);
    assert.equal(head.body, undefined);
  }
});

test('non-read methods do not read the live feed or shell', async () => {
  const fail = async () => { throw new Error('Should not load'); };
  const response = await request({ method: 'POST' }, { readPages: fail, readFeed: fail });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, 'GET, HEAD');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('upstream failures give an honest retryable 503, never a stale page or false 404', async () => {
  const readFeed = async () => { throw new Error('Private upstream endpoint or internal failure'); };
  for (const query of [{}, { player: 'name-123' }, { player: 'unknown-new-player' }]) {
    const response = await request({ query }, { readFeed });
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['retry-after'], '15');
    assert.match(response.body, /Live match updates are temporarily unavailable/);
    assert.doesNotMatch(response.body, /Private upstream|internal failure/);
  }
  const head = await request({ method: 'HEAD' }, { readFeed });
  assert.equal(head.statusCode, 503); assert.equal(head.body, undefined);
});

test('local asset failures return a generic 500 without internal details', async () => {
  const readPages = async () => { throw new Error('/private/path/secret.json is missing'); };
  const response = await request({}, { readPages });
  assert.equal(response.statusCode, 500);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.doesNotMatch(response.body, /secret|private\/path/);
});

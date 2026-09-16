import assert from 'node:assert/strict';
import test from 'node:test';
import { Resvg } from '@resvg/resvg-js';
import { originalCardArt, shareCardCatalog } from './share-catalog.mjs';
import { publicCardArtUrl } from './generated/share-matchup.mjs';
import { createLeaderboardArtHandler, knownCardId, renderLeaderboardCardArt } from '../api/leaderboard-art.mjs';

function request(handler, input = {}) {
  const headers = {};
  const response = { statusCode: 0, headers, body: undefined,
    setHeader(name, value) { headers[name.toLowerCase()] = value; }, end(body) { this.body = body; } };
  handler({ method: 'GET', url: '/', ...input }, response);
  return response;
}
const catalog = shareCardCatalog();
const bundledId = [...catalog.keys()].find(id => originalCardArt(id));

test('bundled card output uses the full audited portrait frame with GET/HEAD parity', () => {
  const handler = createLeaderboardArtHandler();
  const get = request(handler, { query: { cardId: bundledId } });
  assert.equal(get.statusCode, 200);
  assert.equal(get.headers['content-type'], 'image/png');
  assert.equal(get.body.readUInt32BE(16), 182);
  assert.equal(get.body.readUInt32BE(20), 256);
  assert.equal(Number(get.headers['content-length']), get.body.length);
  const head = request(handler, { method: 'HEAD', query: { cardId: bundledId } });
  assert.equal(head.statusCode, 200); assert.deepEqual(head.headers, get.headers); assert.equal(head.body, undefined);
  const cached = request(handler, { query: { cardId: bundledId }, headers: { 'if-none-match': get.headers.etag } });
  assert.equal(cached.statusCode, 304); assert.equal(cached.body, undefined);
});

test('crop keeps the card itself and removes square texture gutters', () => {
  const texture = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="blue"/><rect x="37" width="182" height="256" fill="red"/></svg>').render().asPng();
  const png = renderLeaderboardCardArt({ bytes: texture, contentType: 'image/png', layout: 'ptcgl-square' });
  const pixels = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="182" height="256"><image href="data:image/png;base64,${png.toString('base64')}" width="182" height="256"/></svg>`).render().pixels;
  for (const [x, y] of [[0, 0], [181, 255], [91, 128]]) assert.deepEqual([...pixels.subarray((y * 182 + x) * 4, (y * 182 + x) * 4 + 4)], [255, 0, 0, 255]);
});

test('known cards without bundled art redirect to their fixed public CDN printing', () => {
  const handler = createLeaderboardArtHandler({ originalArt: () => undefined });
  for (const id of ['bw10_1', 'me3_21']) {
    assert.ok(catalog.has(id));
    const get = request(handler, { query: { cardId: id } });
    assert.equal(get.statusCode, 302); assert.equal(get.headers.location, publicCardArtUrl(id));
    const head = request(handler, { method: 'HEAD', url: `/api/leaderboard-art?cardId=${id}` });
    assert.equal(head.statusCode, 302); assert.deepEqual(head.headers, get.headers); assert.equal(head.body, undefined);
  }
});

test('unknown IDs, paths, URLs and repeated parameters cannot reach artwork loading', () => {
  let loaded = 0;
  const handler = createLeaderboardArtHandler({ originalArt() { loaded++; throw new Error('Unexpected'); }, publicUrl() { loaded++; return 'https://evil.example/art.png'; } });
  for (const input of [
    { query: { cardId: '../../secret' } }, { query: { cardId: 'https://evil.example/a.png' } },
    { query: { cardId: 'unknown_999999' } }, { query: { cardId: '__proto__' } },
    { query: { cardId: ['bw10_1', 'bw10_2'] } }, { url: '/api/leaderboard-art?cardId=bw10_1&cardId=bw10_2' }, {},
  ]) {
    const response = request(handler, input);
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, '/trace/leaderboard-static/pokemon-card-back.jpg');
    assert.equal(response.headers['cache-control'], 'public, max-age=30, s-maxage=30');
  }
  assert.equal(loaded, 0);
});

test('catalog finish aliases remain bounded, and corrupt bundled art falls back safely', () => {
  assert.equal(knownCardId('BW10_1_ph2', catalog), 'bw10_1_ph2');
  assert.equal(knownCardId('unknown_999_ph2', catalog), undefined);
  const handler = createLeaderboardArtHandler({ originalArt: () => ({ bytes: Buffer.from('broken'), contentType: 'image/png', layout: 'ptcgl-square' }) });
  const response = request(handler, { query: { cardId: 'bw10_1_ph2' } });
  assert.equal(response.statusCode, 302); assert.equal(response.headers.location, publicCardArtUrl('bw10_1'));
});

test('fallback URLs are limited to the fixed HTTPS image hosts, and writes are rejected', () => {
  for (const url of ['https://evil.example/a.png', 'http://images.pokemontcg.io/bw10/1.png', 'https://images.pokemontcg.io:8443/bw10/1.png', 'https://user:password@images.pokemontcg.io/bw10/1.png']) {
    const handler = createLeaderboardArtHandler({ originalArt: () => undefined, publicUrl: () => url });
    assert.equal(request(handler, { query: { cardId: 'bw10_1' } }).headers.location, '/trace/leaderboard-static/pokemon-card-back.jpg');
  }
  const response = request(createLeaderboardArtHandler(), { method: 'POST', query: { cardId: bundledId } });
  assert.equal(response.statusCode, 405); assert.equal(response.headers.allow, 'GET, HEAD');
  assert.equal(response.headers['cache-control'], 'no-store');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDownloadHandler } from './download-access.mjs';
const response = () => ({ statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(body = '') { this.body = body; } });
test('legacy passwords and grant cookies cannot authorize downloads', async () => {
  for (const request of [
    { method: 'POST', url: '/trace/access', headers: { origin: 'https://victoryroad.app', 'content-type': 'application/json' }, body: { code: 'old-master-password' } },
    { method: 'GET', url: '/trace/access?action=download&platform=mac', headers: { cookie: '__Host-trace-master-access=old-token; __Host-trace-download-grant=old-grant' } },
  ]) {
    const result = response();
    await createDownloadHandler({ service: { configured: true, call: async () => { throw Error('no account credentials'); } } })(request, result);
    for (const value of result.headers['set-cookie'] || []) assert.match(value, /Max-Age=0/);
    if (request.method === 'POST') assert.equal(result.statusCode, 405);
    else assert.equal(result.headers.location, 'https://victoryroad.app/trace/login?download=mac');
  }
});
test('public landing does not expose password unlock or direct installer links', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /Private preview|access-password|releases\/latest\/download/);
  const handler = readFileSync(new URL('../../api/download-access.mjs', import.meta.url), 'utf8');
  assert.match(handler, /createMemberDownloadHandler/);
});

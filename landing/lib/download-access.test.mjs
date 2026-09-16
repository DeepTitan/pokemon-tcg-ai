import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BROWSER_COOKIE, GRANT_COOKIE, MASTER_COOKIE, DOWNLOADS, browserSessionHash, createDownloadHandler, verifyDownloadGrant } from './download-access.mjs';
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const key = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const now = 1789420000;
const browser = 'a'.repeat(64);
const code = 'B'.repeat(32);
function grant(sessionId = browserSessionHash(browser), issuedAt = now) {
  const payload = Buffer.from(JSON.stringify({ version: 1, product: 'trace-download', sessionId, issuedAt, expiresAt: issuedAt + 30 * 86400 })).toString('base64url');
  return `${payload}.${sign('sha256', Buffer.from(payload), keys.privateKey).toString('base64url')}`;
}
const goodCookie = `${BROWSER_COOKIE}=${browser}; ${GRANT_COOKIE}=${grant()}`;
async function invoke(options = {}, dependencies = {}) {
  const req = { method: 'GET', url: '/trace/access', headers: {}, ...options };
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(body = '') { this.body = body; } };
  const handler = createDownloadHandler({ key, clock: () => now, newBrowser: () => browser, redeem: async (_code, sessionId) => ({ status: 200, body: { grant: grant(sessionId) } }), ...dependencies });
  await handler(req, res);
  return res;
}
const post = (extra = {}) => ({ method: 'POST', headers: { origin: 'https://victoryroad.app', 'content-type': 'application/json', cookie: `${BROWSER_COOKIE}=${browser}` }, body: { code }, ...extra });
test('master password unlocks both downloads, persists, and rejects copied or forged cookies', async () => {
  const deps = { masterPassword: 'test-master', masterSecret: 'random-test-only-signing-secret', redeem: async () => { throw new Error('must not call Discord redemption'); } };
  const result = await invoke(post({ body: { code: 'test-master' } }), deps);
  assert.equal(result.statusCode, 200);
  const token = result.headers['set-cookie'].split(';')[0];
  assert(token.startsWith(`${MASTER_COOKIE}=`));
  const headers = { cookie: `${BROWSER_COOKIE}=${browser}; ${token}` };
  assert.equal(JSON.parse((await invoke({ headers }, deps)).body).unlocked, true);
  for (const platform of ['mac', 'windows']) assert.equal((await invoke({ headers, url: `/trace/access?action=download&platform=${platform}` }, deps)).headers.location, DOWNLOADS[platform]);
  assert.equal(JSON.parse((await invoke({ headers: { cookie: `${BROWSER_COOKIE}=${'b'.repeat(64)}; ${token}` } }, deps)).body).unlocked, false);
  assert.equal(JSON.parse((await invoke({ headers: { cookie: `${headers.cookie}x` } }, deps)).body).unlocked, false);
  assert.equal(JSON.parse((await invoke({ headers }, { ...deps, clock: () => now + 31 * 86400 })).body).unlocked, false);
  assert.equal((await invoke(post({ body: { code: 'wrong' } }), deps)).statusCode, 400);
});

test('first visit creates an HttpOnly browser nonce, not unlocked access', async () => {
  const result = await invoke();
  assert.equal(JSON.parse(result.body).unlocked, false);
  assert.match(result.headers['set-cookie'], /Secure; HttpOnly; SameSite=Lax/);
  assert.match(result.headers['cache-control'], /no-store/);
  assert.equal(result.headers['vercel-cdn-cache-control'], 'no-store');
});
test('valid code sets a signed cookie; refresh stays unlocked without another code', async () => {
  const result = await invoke(post());
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { unlocked: true, expiresAt: now + 30 * 86400 });
  assert.match(result.headers['set-cookie'], new RegExp(`^${GRANT_COOKIE}=`));
  assert.match(result.headers['set-cookie'], /HttpOnly/);
  const refreshed = await invoke({ headers: { cookie: goodCookie } });
  assert.equal(JSON.parse(refreshed.body).unlocked, true);
});
test('both downloads are protected server-side and point to normal app installers', async () => {
  for (const platform of ['mac', 'windows']) {
    const url = `/trace/access?action=download&platform=${platform}`;
    const locked = await invoke({ url });
    assert.equal(locked.statusCode, 302);
    assert.equal(locked.headers.location, 'https://victoryroad.app/trace?access=required');
    const unlocked = await invoke({ url, headers: { cookie: goodCookie } });
    assert.equal(unlocked.headers.location, DOWNLOADS[platform]);
  }
  assert.equal((await invoke({ url: '/trace/access?action=download&platform=https://evil.example' })).statusCode, 400);
});
test('forged, expired or transplanted cookies do not unlock downloads', () => {
  assert(verifyDownloadGrant(grant(), browser, key, now));
  assert.equal(verifyDownloadGrant(grant(), 'b'.repeat(64), key, now), null);
  assert.equal(verifyDownloadGrant(grant(), browser, key, now + 31 * 86400), null);
  assert.equal(verifyDownloadGrant(`x${grant()}`, browser, key, now), null);
  assert.equal(verifyDownloadGrant(grant(), browser, 'bad', now), null);
});
test('CSRF, missing cookies, malformed requests and non-POST writes are rejected', async () => {
  assert.equal((await invoke(post({ headers: { origin: 'https://evil.example', 'content-type': 'application/json', cookie: goodCookie } }))).statusCode, 403);
  assert.equal((await invoke(post({ headers: { origin: 'https://victoryroad.app', 'content-type': 'application/json' } }))).statusCode, 400);
  assert.equal((await invoke(post({ body: '{' }))).statusCode, 400);
  assert.equal((await invoke(post({ body: { code: 'wrong' } }))).statusCode, 400);
  assert.equal((await invoke({ method: 'DELETE' })).statusCode, 405);
});
test('outages, used codes and invalid signatures never produce a grant cookie', async () => {
  for (const redeem of [async () => { throw new Error('upstream detail'); }, async () => ({ status: 409, body: {} }), async () => ({ status: 200, body: { grant: 'forged' } })]) {
    const result = await invoke(post(), { redeem });
    assert(result.statusCode >= 400);
    assert.equal(result.headers['set-cookie'], undefined);
    assert.equal(result.body.includes('upstream detail'), false);
  }
});
test('website keeps the original simple preview copy without weakening download protection', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
  assert.match(html, /Private preview/);
  assert.match(html, /Enter the password to continue\./);
  assert.match(js, /Unlock Trace/);
  assert.equal(html.includes('access-help'), false);
  assert.equal(html.includes('Build Victory Road with us'), false);
  assert.equal(html.includes('releases/latest/download'), false);
  assert.equal(js.includes('accessHash'), false);
  assert.equal(js.includes('sessionStorage.getItem'), false);
});

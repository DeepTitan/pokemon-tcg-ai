import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ACCESS_COOKIE, REFRESH_COOKIE, DISCORD_COOKIE, DISCORD_JOIN_URL, createDiscordHandler, createMemberDownloadHandler, publicAccount, safeDiscordUrl } from './membership.mjs';

const origin = 'https://victoryroad.app';
const state = 'a'.repeat(43);
const oauth = `${'https://discord.com/oauth2/authorize'}?client_id=123456789&response_type=code&redirect_uri=${encodeURIComponent(`${origin}/trace/discord/callback`)}&scope=identify%20guilds.members.read&state=${state}`;
const sessionCookie = `${ACCESS_COOKIE}=private.access; ${REFRESH_COOKIE}=private.refresh`;
const account = { email: 'player@example.test', plan: 'none', status: 'none', traceAccess: false, expiresAt: null, capabilities: { recordMatches: true }, activation: { required: true, verified: false, joinUrl: DISCORD_JOIN_URL } };
const response = () => ({ statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(body = '') { this.body = body; } });
function proofCookie(overrides = {}) {
  return `${DISCORD_COOKIE}=${encodeURIComponent(JSON.stringify({ hash: createHash('sha256').update(state).digest('hex'), issuedAt: Date.now(), userCode: 'ABCDE23456', ...overrides }))}`;
}
async function invoke({ method = 'GET', url = `/trace/discord/callback?code=private-code&state=${state}`, headers = {}, body, service } = {}) {
  const result = response();
  await createDiscordHandler({ service: service || { configured: true, call: async (action) => ({ status: 200, body: action === 'discord/start' ? { url: oauth } : { verified: true, accessToken: 'never-return' } }) } })({
    method, url, headers: { cookie: `${sessionCookie}; ${proofCookie()}`, ...(method === 'POST' ? { origin, 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers }, body,
  }, result);
  return result;
}

test('Discord starts via same-origin form and server redirect, with browser-bound HttpOnly proof', async () => {
  const calls = [];
  const result = await invoke({ method: 'POST', body: 'userCode=ABCDE23456&download=mac&next=https%3A%2F%2Fevil.test', service: { configured: true, call: async (action, input) => { calls.push({ action, input }); return { status: 200, body: { url: oauth, accessToken: 'secret' } }; } } });
  assert.equal(result.statusCode, 303);
  assert.equal(result.headers.location, oauth);
  assert.equal(result.body, '');
  assert.deepEqual(calls, [{ action: 'discord/start', input: { method: 'POST', body: {}, accessToken: 'private.access' } }]);
  const cookie = result.headers['set-cookie'].find((value) => value.startsWith(DISCORD_COOKIE));
  assert.match(cookie, /Max-Age=600; Secure; HttpOnly; SameSite=Lax$/);
  const proof = JSON.parse(decodeURIComponent(cookie.split(';')[0].slice(DISCORD_COOKIE.length + 1)));
  assert.equal(proof.userCode, 'ABCDE23456'); assert.equal(proof.download, 'mac');
  assert.equal(proof.hash, createHash('sha256').update(state).digest('hex'));
  assert.equal(proof.next, undefined);
  assert.doesNotMatch(cookie, new RegExp(state));
});

test('Discord start rejects cross-site, absent Origin and unexpected content types before upstream', async () => {
  let calls = 0;
  for (const headers of [{ origin: undefined }, { origin: 'https://evil.test' }, { origin: 'https://victoryroad.app.evil.test' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'application/json' }]) {
    const result = await invoke({ method: 'POST', headers, service: { configured: true, call: async () => { calls++; } } });
    assert.equal(result.statusCode, 403);
  }
  assert.equal(calls, 0);
});

test('Discord authorization URL requires fixed host, callback, code flow and minimal scopes', () => {
  assert.equal(safeDiscordUrl(oauth)?.href, oauth);
  for (const target of [oauth.replace('discord.com/', 'discord.com.evil.test/'), oauth.replace('https://', 'http://'), oauth.replace('discord.com/', 'user@discord.com/'), oauth.replace('response_type=code', 'response_type=token'), oauth.replace('identify%20guilds.members.read', 'identify%20email'), oauth.replace('client_id=123456789', 'client_id=123456789&client_id=9'), `${oauth}&state=other`, oauth.replace(encodeURIComponent(`${origin}/trace/discord/callback`), encodeURIComponent('https://evil.test/callback'))]) assert.equal(safeDiscordUrl(target), null);
});

test('callback exchanges code only server-side, clears proof and preserves app-link context', async () => {
  const calls = [];
  const result = await invoke({ service: { configured: true, call: async (action, input) => { calls.push({ action, input }); return { status: 200, body: { verified: true, token: 'private-provider-token' } }; } } });
  assert.deepEqual(calls, [{ action: 'discord/complete', input: { method: 'POST', body: { code: 'private-code', state }, accessToken: 'private.access' } }]);
  assert.equal(result.headers.location, `${origin}/trace/account?discord=verified&userCode=ABCDE23456`);
  assert.match(result.headers['set-cookie'][0], /Max-Age=0/);
  assert.equal(result.headers['referrer-policy'], 'no-referrer');
  assert.match(result.headers['cache-control'], /no-store/);
  assert.equal(result.body, '');
  assert.doesNotMatch(JSON.stringify(result.headers), /private-code|private-provider-token/);
});

test('missing, mismatched, expired and duplicated callback proof never contacts backend', async () => {
  let calls = 0;
  const attempts = [
    { headers: { cookie: sessionCookie } },
    { headers: { cookie: `${sessionCookie}; ${proofCookie({ hash: 'f'.repeat(64) })}` } },
    { headers: { cookie: `${sessionCookie}; ${proofCookie({ issuedAt: Date.now() - 700000 })}` } },
    { url: `/trace/discord/callback?code=private-code&state=${state}&state=${state}` },
    { url: `/trace/discord/callback?code=one&code=two&state=${state}` },
  ];
  for (const attempt of attempts) {
    const result = await invoke({ ...attempt, service: { configured: true, call: async () => { calls++; } } });
    assert.match(result.headers.location, /discord=retry/);
    assert.doesNotMatch(result.headers.location, /private-code/);
  }
  assert.equal(calls, 0);
});

test('Discord callback refreshes an expired access cookie without exposing session credentials', async () => {
  const calls = [];
  const result = await invoke({ service: { configured: true, call: async (action, input) => {
    calls.push(action);
    if (action === 'auth/refresh') return { status: 200, body: { accessToken: 'fresh.access', expiresIn: 3600 } };
    return input.accessToken === 'fresh.access' ? { status: 200, body: { verified: true } } : { status: 401, body: {} };
  } } });
  assert.match(result.headers.location, /discord=verified/);
  assert.deepEqual(calls, ['discord/complete', 'auth/refresh', 'discord/complete']);
  assert.equal(result.headers['set-cookie'].length, 3);
  assert.equal(result.body, '');
});

test('canceled, missing-session, not-joined, pending and unavailable states return safe recovery', async () => {
  const canceled = await invoke({ url: `/trace/discord/callback?error=access_denied&state=${state}`, service: { configured: true, call: () => { throw new Error('must not call'); } } });
  assert.match(canceled.headers.location, /discord=canceled/);
  const missing = await invoke({ headers: { cookie: proofCookie() } });
  assert.match(missing.headers.location, /discord=signin/);
  for (const [error, status] of [['discord_not_joined', 'join'], ['discord_pending', 'pending'], ['discord_state_invalid', 'retry'], ['discord_already_linked', 'linked'], ['private-error', 'unavailable']]) {
    const result = await invoke({ service: { configured: true, call: async () => ({ status: 403, body: { error, accessToken: 'private' } }) } });
    assert.match(result.headers.location, new RegExp(`discord=${status}`));
    assert.doesNotMatch(result.headers.location, /private|code=|state=/);
  }
});

test('activation is allowlisted and new downloads require verified Discord even for paid access', async () => {
  const normalized = publicAccount({ ...account, activation: { required: true, verified: false, joinUrl: 'https://evil.test', discordToken: 'secret' } });
  assert.deepEqual(normalized.activation, { required: true, verified: false, joinUrl: DISCORD_JOIN_URL });
  for (const activation of [{ required: true, verified: false }, { required: 'false', verified: 'true' }, null]) {
    const result = response();
    await createMemberDownloadHandler({ service: { configured: true, call: async () => ({ status: 200, body: { ...account, plan: 'trace', status: 'active', traceAccess: true, expiresAt: '2099-01-01T00:00:00Z', activation } }) } })({ method: 'GET', url: '/trace/access?action=download&platform=mac', headers: { cookie: sessionCookie } }, result);
    assert.equal(result.statusCode, 303);
    assert.equal(result.headers.location, `${origin}/trace/account?download=mac`);
  }
  // Existing accounts remain exempt; ongoing recording capabilities are unchanged.
  assert.equal(publicAccount({ ...account, activation: { required: false, verified: false } }).capabilities.recordMatches, true);
});

test('callback and native link aliases route before public share catch-all', () => {
  for (const filename of ['../../vercel.json', '../vercel.json']) {
    const config = JSON.parse(readFileSync(new URL(filename, import.meta.url)));
    for (const source of ['/trace/discord/callback', '/trace/link']) {
      const index = config.rewrites.findIndex((r) => r.source === source);
      assert(index >= 0 && index < config.rewrites.findIndex((r) => r.source === '/trace/:shareId'));
    }
    assert(config.headers.some((entry) => entry.source.includes('|link)')));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCESS_COOKIE, REFRESH_COOKIE, DOWNLOADS, createMembershipHandler, createMemberDownloadHandler, createMembershipService, membershipOrigin, publicAccount, safeBillingUrl } from './membership.mjs';
const ORIGIN = 'https://victoryroad.app';
const access = 'private.access.token';
const refresh = 'private.refresh.token';
const cookies = `${ACCESS_COOKIE}=${access}; ${REFRESH_COOKIE}=${refresh}`;
const account = { email: 'member@example.test', plan: 'supporter', traceAccess: true, opponentDecklists: true, admin: false, status: 'active', expiresAt: '2099-01-01T00:00:00Z', cancelAtPeriodEnd: false };
const session = { accessToken: access, refreshToken: refresh, expiresIn: 3600 };
const response = () => ({ statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(value = '') { this.body = value; } });
async function invoke(action, { method = action === 'account' ? 'GET' : 'POST', headers = {}, body = {}, service, origin = ORIGIN } = {}) {
  const request = { url: `/trace/api/${action}`, method, headers: { ...(method === 'POST' ? { origin: ORIGIN, 'content-type': 'application/json' } : {}), cookie: cookies, ...headers }, body };
  const result = response();
  await createMembershipHandler({ origin, service: service || { configured: true, call: async (name) => ({ status: 200, body: name === 'account' ? account : session }) } })(request, result);
  return result;
}
const parsed = (value) => JSON.parse(value.body);

test('login stores secure host-only HttpOnly tokens and returns no credentials or provider fields', async () => {
  const result = await invoke('auth/login', { body: { email: 'member@example.test', password: 'test password' }, service: { configured: true, call: async () => ({ status: 200, body: { ...session, idToken: 'secret', debug: 'private details' } }) } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(parsed(result), { authenticated: true });
  assert.equal(result.headers['set-cookie'].length, 2);
  for (const value of result.headers['set-cookie']) { assert.match(value, /; Path=\/; Max-Age=\d+; Secure; HttpOnly; SameSite=Lax$/); assert.doesNotMatch(value, /Domain=/); }
  assert.match(result.headers['cache-control'], /no-store/);
  assert.equal(result.headers['vercel-cdn-cache-control'], 'no-store');
  assert.equal(result.headers.vary, 'Cookie');
});

test('CSRF origin matching is exact; caller host and Vercel URL cannot bless origins', async () => {
  let calls = 0;
  const service = { configured: true, call: async () => { calls++; return { status: 200, body: {} }; } };
  for (const origin of [undefined, 'null', 'https://evil.test', 'https://www.victoryroad.app', 'https://victoryroad.app.evil.test', 'http://victoryroad.app', 'https://victoryroad.app/', 'https://victoryroad.app:444']) {
    const result = await invoke('portal', { headers: { origin, host: 'evil.test', 'x-forwarded-host': 'victoryroad.app' }, service });
    assert.equal(result.statusCode, 403);
  }
  for (const headers of [{ 'content-type': 'text/plain' }, { 'content-type': 'application/jsonp' }, { 'sec-fetch-site': 'cross-site' }]) assert.equal((await invoke('portal', { headers, service })).statusCode, 403);
  assert.equal(calls, 0);
  assert.equal(membershipOrigin('https://victoryroad.app/path'), null);
  assert.equal(membershipOrigin('https://user@victoryroad.app'), null);
  assert.equal(membershipOrigin('http://127.0.0.1:3000'), null);
});

test('public action response redaction and field allowlists apply even to successful providers', async () => {
  let sent;
  const service = { configured: true, call: async (_action, input) => { sent = input.body; return { status: 200, body: { accessToken: 'secret', refreshToken: 'secret', email: 'other@example.test' } }; } };
  const result = await invoke('auth/signup', { body: { email: ' member@example.test ', password: 'SafeTestPassword!2', admin: true, traceAccess: true }, service });
  assert.deepEqual(sent, { email: 'member@example.test', password: 'SafeTestPassword!2' });
  assert.deepEqual(parsed(result), { ok: true });
  const details = await invoke('account', { service: { configured: true, call: async () => ({ status: 200, body: { ...account, accessToken: 'secret', stripeCustomerId: 'private', userId: 'private' } }) } });
  assert.deepEqual(parsed(details), account);
});

test('missing, malformed and unknown permissions fail closed', () => {
  for (const value of [null, {}, { ...account, plan: 'super-admin' }, { ...account, status: undefined }]) assert.equal(publicAccount(value), null);
  for (const override of [{ plan: 'none' }, { status: 'trialing' }, { status: 'past_due' }, { status: 'unknown' }, { expiresAt: null }, { expiresAt: '2020-01-01T00:00:00Z' }, { status: 'admin', admin: true, plan: 'trace' }, { traceAccess: 'true' }, { status: 'active', admin: true, plan: 'none' }]) assert.equal(publicAccount({ ...account, ...override }).traceAccess, false);
  assert.equal(publicAccount({ ...account, plan: 'trace' }).opponentDecklists, false);
  assert.equal(publicAccount({ ...account, opponentDecklists: 'true' }).opponentDecklists, false);
  assert.deepEqual(publicAccount({ ...account, status: 'admin', admin: true, expiresAt: null }), { ...account, status: 'admin', admin: true, expiresAt: null });
});

test('expired session refreshes with HttpOnly refresh token then retries, never browser-supplied token', async () => {
  const calls = [];
  const service = { configured: true, call: async (action, input) => {
    calls.push({ action, input });
    if (action === 'auth/refresh') return { status: 200, body: { accessToken: 'new.token', expiresIn: 3600 } };
    return input.accessToken === 'new.token' ? { status: 200, body: account } : { status: 401, body: {} };
  } };
  const result = await invoke('account', { service });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls.map((call) => call.action), ['account', 'auth/refresh', 'account']);
  assert.deepEqual(calls[1].input.body, { refreshToken: refresh });
  assert.match(result.headers['set-cookie'][1], new RegExp(refresh));
  const manual = await invoke('auth/refresh', { body: { refreshToken: 'attacker-controlled' }, service });
  assert.equal(manual.statusCode, 200);
  assert.deepEqual(parsed(manual), { authenticated: true });
  assert.deepEqual(calls.at(-1).input.body, { refreshToken: refresh });
});

test('refresh fails closed, clears invalid session and does not turn outages into authentication', async () => {
  const invalid = await invoke('account', { service: { configured: true, call: async () => ({ status: 401, body: { error: 'unauthorized', accessToken: 'secret' } }) } });
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.headers['set-cookie'].length, 2);
  for (const value of invalid.headers['set-cookie']) assert.match(value, /Max-Age=0/);
  const malformed = await invoke('auth/refresh', { service: { configured: true, call: async () => ({ status: 200, body: { accessToken: '\r\nmalicious', expiresIn: 3600 } }) } });
  assert.equal(malformed.statusCode, 503);
  assert.equal(malformed.headers['set-cookie'], undefined);
  const unconfigured = await invoke('account', { service: { configured: false, call: async () => { throw Error('must not call'); } } });
  assert.equal(unconfigured.statusCode, 503);
});

test('logout clears session even if provider revocation has an outage', async () => {
  const result = await invoke('auth/logout', { service: { configured: true, call: async () => { throw Error('private provider error'); } } });
  assert.deepEqual(parsed(result), { signedOut: true });
  assert.equal(result.headers['set-cookie'].length, 2);
  assert.doesNotMatch(result.body, /private/);
});

test('Stripe redirect allowlist rejects script URLs, credentials, host suffixes and unrelated paths', async () => {
  assert.equal(safeBillingUrl('https://checkout.stripe.com/c/pay/cs_test_example#state', 'checkout'), 'https://checkout.stripe.com/c/pay/cs_test_example#state');
  assert.equal(safeBillingUrl('https://billing.stripe.com/p/session/test', 'portal'), 'https://billing.stripe.com/p/session/test');
  for (const url of ['javascript:alert(1)', '//checkout.stripe.com/c/pay/a', 'https://checkout.stripe.com.evil.test/c/pay/a', 'https://user@checkout.stripe.com/c/pay/a', 'https://checkout.stripe.com/anything', 'http://checkout.stripe.com/c/pay/a', 'https://billing.stripe.com/p/session/a']) {
    assert.equal(safeBillingUrl(url, 'checkout'), null);
    const result = await invoke('checkout', { body: { plan: 'trace', success_url: 'https://evil.test' }, service: { configured: true, call: async (_action, input) => { assert.deepEqual(input.body, { plan: 'trace' }); return { status: 200, body: { url } }; } } });
    assert.equal(result.statusCode, 503);
    assert.equal(result.headers.location, undefined);
  }
});

test('account email and billing errors are allowlisted, without raw upstream errors', async () => {
  const result = await invoke('portal', { service: { configured: true, call: async () => ({ status: 500, body: { error: 'Bearer secret-token', debug: 'private' } }) } });
  assert.equal(result.statusCode, 503);
  assert.doesNotMatch(result.body, /secret-token|private|Bearer/);
  const verified = await invoke('auth/login', { body: { email: 'member@example.test', password: 'example' }, service: { configured: true, call: async () => ({ status: 403, body: { error: 'email_not_verified' } }) } });
  assert.equal(parsed(verified).code, 'email_not_verified');
});

test('only explicit POST can approve a link and normalized code alone reaches server', async () => {
  let calls = 0;
  const service = { configured: true, call: async (action, input) => { calls++; assert.equal(action, 'devices/link/approve'); assert.deepEqual(input.body, { userCode: 'ABCDEF2345' }); return { status: 200, body: { linked: true, accessToken: 'private' } }; } };
  assert.equal((await invoke('devices/link/approve', { method: 'GET', service })).statusCode, 405);
  assert.equal((await invoke('devices/link/approve', { body: { userCode: 'ABCDEF0189' }, service })).statusCode, 400);
  const result = await invoke('devices/link/approve', { body: { userCode: 'abcde-f2345', subject: 'someone-else', admin: true }, service });
  assert.deepEqual(parsed(result), { linked: true }); assert.equal(calls, 1);
});

test('web proxy is not a public relay for device credentials, webhooks or arbitrary actions', async () => {
  for (const action of ['webhook', 'devices/status', 'devices/link/start', 'devices/unlink', 'admin', '../account', 'account/']) assert.equal((await invoke(action)).statusCode, 404);
  assert.equal((await invoke('checkout', { body: { plan: 'admin' } })).statusCode, 400);
  assert.equal((await invoke('auth/signup', { body: '{' })).statusCode, 400);
});

test('download route checks current membership, ignores legacy cookies and restricts destination', async () => {
  for (const platform of ['mac', 'windows']) {
    const result = response();
    let calls = 0;
    await createMemberDownloadHandler({ service: { configured: true, call: async (action) => { calls++; assert.equal(action, 'account'); return { status: 200, body: account }; } } })({ method: 'GET', url: `/trace/access?action=download&platform=${platform}`, headers: { cookie: cookies } }, result);
    assert.equal(result.statusCode, 303); assert.equal(result.headers.location, DOWNLOADS[platform]); assert.equal(calls, 1);
  }
  for (const headers of [{}, { cookie: '__Host-trace-master-access=legacy; __Host-trace-download-grant=legacy' }]) {
    const result = response();
    await createMemberDownloadHandler({ service: { configured: true, call: async () => { throw Error('no valid session'); } } })({ method: 'GET', url: '/trace/access?action=download&platform=mac&next=https://evil.test', headers }, result);
    assert.equal(result.statusCode, 303); assert.equal(result.headers.location, `${ORIGIN}/trace/login?download=mac`);
  }
  const result = response();
  await createMemberDownloadHandler({ service: { configured: true, call: async () => ({ status: 200, body: { ...account, traceAccess: false } }) } })({ method: 'GET', url: '/trace/access?action=download&platform=mac', headers: { cookie: cookies } }, result);
  assert.equal(result.headers.location, `${ORIGIN}/trace/account?download=mac`);
});

test('outages or invalid account response never unlock downloads', async () => {
  for (const reply of [{ status: 503, body: {} }, { status: 200, body: { traceAccess: true } }]) {
    const result = response();
    await createMemberDownloadHandler({ service: { configured: true, call: async () => reply } })({ method: 'GET', url: '/trace/access?action=download&platform=windows', headers: { cookie: cookies } }, result);
    assert.equal(result.statusCode, 503); assert.equal(result.headers.location, undefined);
  }
});

test('upstream calls use fixed configured HTTPS service, no redirects and private cache policy', async () => {
  let received;
  const service = createMembershipService({ upstream: 'https://api.example.test', fetcher: async (...args) => { received = args; return { status: 200, text: async () => JSON.stringify(account) }; } });
  await service.call('account', { method: 'GET', accessToken: access });
  assert.equal(received[0], 'https://api.example.test/v1/account');
  assert.equal(received[1].redirect, 'error'); assert.equal(received[1].cache, 'no-store');
  assert.equal(received[1].headers.Authorization, `Bearer ${access}`);
  for (const upstream of [undefined, 'http://api.example.test', 'https://user:pass@api.example.test', 'https://api.example.test?redirect=evil']) assert.equal(createMembershipService({ upstream, fetcher: () => { throw Error('must not call'); } }).configured, false);
});

test('routing preserves public share/leaderboard before catch-all, and legacy access no longer runs master passwords', () => {
  const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url)));
  const index = (source) => config.rewrites.findIndex((rule) => rule.source === source);
  for (const source of ['/trace/account', '/trace/connect', '/trace/api/:action*', '/trace/leaderboard', '/trace/players/:player']) assert(index(source) >= 0 && index(source) < index('/trace/:shareId'));
  const handler = readFileSync(new URL('../../api/download-access.mjs', import.meta.url), 'utf8');
  assert.match(handler, /createMemberDownloadHandler/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /Private preview|Free beta|type="password"|releases\/latest\/download/);
  assert.match(html, /\$14\.99/); assert.match(html, /\$39\.99/);
  const client = readFileSync(new URL('../member.js', import.meta.url), 'utf8');
  assert.doesNotMatch(client, /localStorage|sessionStorage|accessToken|refreshToken/);
});

test('logout revokes refresh-only sessions without restoring browser cookies', async () => {
  const calls = [];
  const result = await invoke('auth/logout', { headers: { cookie: `${REFRESH_COOKIE}=${refresh}` }, service: { configured: true, call: async (action, input) => {
    calls.push({ action, input });
    return action === 'auth/refresh' ? { status: 200, body: session } : { status: 200, body: { ok: true } };
  } } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls.map((call) => call.action), ['auth/refresh', 'auth/logout']);
  assert.equal(calls[1].input.accessToken, access);
  for (const value of result.headers['set-cookie']) assert.match(value, /Max-Age=0/);
});

test('duplicate subscriptions direct the customer to manage existing billing', async () => {
  const result = await invoke('checkout', { body: { plan: 'supporter' }, service: { configured: true, call: async () => ({ status: 409, body: { error: 'subscription_exists' } }) } });
  assert.equal(result.statusCode, 409);
  assert.equal(parsed(result).code, 'subscription_exists');
  assert.match(parsed(result).error, /Manage billing/);
});

test('confirmation resend strips extra fields and never returns account existence', async () => {
  const result = await invoke('auth/resend', { body: { email: 'member@example.test', admin: true }, service: { configured: true, call: async (action, input) => {
    assert.equal(action, 'auth/resend'); assert.deepEqual(input.body, { email: 'member@example.test' }); return { status: 200, body: { ok: true, userExists: true } };
  } } });
  assert.deepEqual(parsed(result), { ok: true });
});

test('rejected access token at logout retries revocation through refresh, without issuing new cookies', async () => {
  const calls = [];
  const result = await invoke('auth/logout', { service: { configured: true, call: async (action, input) => {
    calls.push(action);
    if (action === 'auth/refresh') return { status: 200, body: { ...session, accessToken: 'fresh.logout.token' } };
    return { status: input.accessToken === access ? 401 : 200, body: {} };
  } } });
  assert.deepEqual(calls, ['auth/logout', 'auth/refresh', 'auth/logout']);
  assert.deepEqual(parsed(result), { signedOut: true });
  for (const value of result.headers['set-cookie']) assert.match(value, /Max-Age=0/);
});

test('local logout remains available when membership service is unconfigured', async () => {
  const result = await invoke('auth/logout', { service: { configured: false, call: async () => { throw Error('must not call'); } } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['set-cookie'].length, 2);
});

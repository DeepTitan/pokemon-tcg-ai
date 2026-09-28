import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { ACCESS_COOKIE, REFRESH_COOKIE, CHECKOUT_COOKIE, createMembershipHandler, createMembershipService } from './membership.mjs';
const proof = 'a'.repeat(64);
const checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_test_offline';
const token = 'private.access.token';
const none = { email: 'player@example.test', plan: 'none', status: 'none', admin: false, traceAccess: false, opponentDecklists: false, expiresAt: null, cancelAtPeriodEnd: false, capabilities: { recordMatches: true, leaderboard: true, recentReplayDays: 7, fullHistory: false, expandedSharing: false, opponentDecklists: false, freeSharesPerWindow: 1, shareWindowDays: 7 } };
const active = { ...none, plan: 'supporter', status: 'active', traceAccess: true, opponentDecklists: true, expiresAt: '2099-10-01T00:00:00Z', capabilities: { ...none.capabilities, fullHistory: true, expandedSharing: true, opponentDecklists: true } };
const result = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = body; } });
const json = (res) => JSON.parse(res.body);
async function invoke(action, { cookie = '', body = {}, headers = {}, service, newCheckoutToken = () => proof } = {}) {
  const res = result();
  await createMembershipHandler({ newCheckoutToken, service: service || { configured: true, guestConfigured: true, call: async (name) => ({ status: 200, body: name === 'checkout/status' ? { state: 'none', plan: 'none', expiresAt: null } : { url: checkoutUrl } }) } })({ method: 'POST', url: `/trace/api/${action}`, headers: { origin: 'https://victoryroad.app', 'content-type': 'application/json', cookie, ...headers }, body }, res);
  return res;
}

test('prepare sets strong HttpOnly proof without creating a Stripe session or exposing it to JavaScript', async () => {
  let calls = 0;
  const res = await invoke('checkout/prepare', { body: { checkoutToken: 'caller-proof' }, service: { configured: true, guestConfigured: true, call: async () => { calls++; throw Error('no payment effects'); } } });
  assert.deepEqual(json(res), { ready: true }); assert.equal(calls, 0);
  assert.deepEqual(res.headers['set-cookie'], [`${CHECKOUT_COOKIE}=${proof}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`]);
  assert.doesNotMatch(res.body, /aaaa|Token|secret/);
  const reused = await invoke('checkout/prepare', { cookie: `${CHECKOUT_COOKIE}=${proof}`, newCheckoutToken: () => { throw Error('must not replace'); } });
  assert.deepEqual(json(reused), { ready: true }); assert.equal(reused.headers['set-cookie'], undefined);
});

test('cookie-less checkout attempts cannot create sessions, including simultaneous first requests or lost prepare responses', async () => {
  let calls = 0;
  const service = { configured: true, guestConfigured: true, call: async () => { calls++; throw Error('must not call'); } };
  const responses = await Promise.all([invoke('checkout/guest', { body: { plan: 'trace' }, service }), invoke('checkout/guest', { body: { plan: 'trace' }, service })]);
  assert.deepEqual(responses.map((res) => res.statusCode), [400, 400]); assert.equal(calls, 0);
  for (const res of responses) assert(!(res.headers['set-cookie'] || []).some((value) => value.startsWith(CHECKOUT_COOKIE + '=')));
});

test('guest checkout forwards only the stored proof and plan; successful and failed responses never replace proof', async () => {
  for (const status of [200, 503]) {
    const calls = [];
    const service = { configured: true, guestConfigured: true, call: async (action, input) => {
      calls.push({ action, input });
      return action === 'checkout/status' ? { status: 200, body: { state: 'none', plan: 'none', expiresAt: null } } : { status, body: { url: checkoutUrl, checkoutToken: proof, sessionId: 'private', email: 'private' } };
    } };
    const res = await invoke('checkout/guest', { cookie: `${CHECKOUT_COOKIE}=${proof}`, body: { plan: 'trace', checkoutToken: 'b'.repeat(64), sessionId: 'attacker', returnTo: 'https://evil.test' }, service });
    assert.equal(res.statusCode, status);
    assert.deepEqual(calls.map((call) => call.action), ['checkout/status', 'checkout/guest']);
    assert.deepEqual(calls[1].input.body, { plan: 'trace', checkoutToken: proof });
    assert(!(res.headers['set-cookie'] || []).some((value) => value.startsWith(CHECKOUT_COOKIE + '=')));
    assert.doesNotMatch(res.body, /aaaa|private|sessionId|checkoutToken/);
  }
});

test('guest prepare, status, checkout and claim all enforce exact origin and JSON', async () => {
  let calls = 0;
  const service = { configured: true, guestConfigured: true, call: async () => { calls++; throw Error('blocked'); } };
  for (const action of ['checkout/prepare', 'checkout/guest', 'checkout/status', 'checkout/claim']) {
    const res = await invoke(action, { headers: { origin: 'https://victoryroad.app.evil.test' }, body: { plan: 'trace' }, service });
    assert.equal(res.statusCode, 403); assert.equal(res.headers['set-cookie'], undefined);
  }
  assert.equal(calls, 0);
});

test('owner and existing paid members reach account without another checkout', async () => {
  for (const account of [active, { ...active, status: 'admin', admin: true, expiresAt: null }]) {
    const calls = [];
    const res = await invoke('checkout/guest', { cookie: `${ACCESS_COOKIE}=${token}`, body: { plan: 'trace' }, service: { configured: true, guestConfigured: true, call: async (action) => { calls.push(action); return { status: 200, body: account }; } } });
    assert.deepEqual(json(res), { accountRequired: true }); assert.deepEqual(calls, ['account']);
  }
});

test('signed-in free accounts use authenticated checkout only when no guest purchase is associated', async () => {
  const calls = [];
  const res = await invoke('checkout/guest', { cookie: `${ACCESS_COOKIE}=${token}; ${CHECKOUT_COOKIE}=${proof}`, body: { plan: 'trace' }, service: { configured: true, guestConfigured: true, call: async (action, input) => {
    calls.push({ action, input });
    return { status: 200, body: action === 'account' ? none : action === 'checkout/status' ? { state: 'none', plan: 'none', expiresAt: null } : { url: checkoutUrl } };
  } } });
  assert.deepEqual(json(res), { url: checkoutUrl });
  assert.deepEqual(calls.map((call) => call.action), ['account', 'checkout/status', 'checkout']);
  assert.equal(calls[2].input.accessToken, token);
});

test('paid or processing guest proof blocks both anonymous and authenticated duplicate checkout paths', async () => {
  for (const state of ['paid', 'processing', 'claimed']) for (const action of ['checkout/guest', 'checkout']) {
    const calls = [];
    const res = await invoke(action, { cookie: `${ACCESS_COOKIE}=${token}; ${CHECKOUT_COOKIE}=${proof}`, body: { plan: 'trace' }, service: { configured: true, guestConfigured: true, call: async (name) => {
      calls.push(name); return { status: 200, body: name === 'account' ? none : { state, plan: 'supporter', expiresAt: null } };
    } } });
    assert.deepEqual(json(res), { accountRequired: true });
    assert(!calls.includes('checkout')); assert(!calls.includes('checkout/guest'));
  }
});

test('open or expired guest checkout resumes the bound guest path after sign-in; plan changes stay on the guest path that expires the old session', async () => {
  for (const state of ['open', 'expired']) {
    const calls = [];
    const service = { configured: true, guestConfigured: true, call: async (action) => {
      calls.push(action); return { status: 200, body: action === 'account' ? none : action === 'checkout/status' ? { state, plan: 'trace', expiresAt: '2099-01-01T00:00:00Z' } : { url: checkoutUrl } };
    } };
    const res = await invoke('checkout/guest', { cookie: `${ACCESS_COOKIE}=${token}; ${CHECKOUT_COOKIE}=${proof}`, body: { plan: 'trace' }, service });
    assert.deepEqual(json(res), { url: checkoutUrl }); assert.deepEqual(calls, ['account', 'checkout/status', 'checkout/guest']);
    calls.length = 0;
    const changed = await invoke('checkout/guest', { cookie: `${ACCESS_COOKIE}=${token}; ${CHECKOUT_COOKIE}=${proof}`, body: { plan: 'supporter' }, service });
    assert.deepEqual(json(changed), { url: checkoutUrl }); assert.deepEqual(calls, ['account', 'checkout/status', 'checkout/guest']);
  }
});

test('complete but inactive subscription is a billing recovery state, never a new purchase', async () => {
  const service = { configured: true, guestConfigured: true, call: async () => ({ status: 200, body: { state: 'processing', reason: 'purchase_not_active', plan: 'supporter', expiresAt: null, customerEmail: 'private', subscriptionId: 'private' } }) };
  const status = await invoke('checkout/status', { cookie: `${CHECKOUT_COOKIE}=${proof}`, service });
  assert.deepEqual(json(status), { state: 'processing', reason: 'purchase_not_active', plan: 'supporter', expiresAt: null });
  const claim = await invoke('checkout/claim', { cookie: `${ACCESS_COOKIE}=${token}; ${CHECKOUT_COOKIE}=${proof}`, service: { ...service, call: async () => ({ status: 409, body: { error: 'purchase_not_active' } }) } });
  assert.equal(claim.statusCode, 409); assert.match(json(claim).error, /before paying again/);
});

test('status cannot look up arbitrary caller tokens and redacts private Stripe identifiers', async () => {
  const absent = await invoke('checkout/status', { body: { checkoutToken: proof } });
  assert.deepEqual(json(absent), { state: 'none', plan: 'none', expiresAt: null });
  const res = await invoke('checkout/status', { cookie: `${CHECKOUT_COOKIE}=${proof}`, body: { checkoutToken: 'b'.repeat(64) }, service: { configured: true, guestConfigured: true, call: async (_action, input) => {
    assert.deepEqual(input.body, { checkoutToken: proof });
    return { status: 200, body: { state: 'paid', plan: 'supporter', expiresAt: null, email: 'private', sessionId: 'private', checkoutToken: proof } };
  } } });
  assert.deepEqual(json(res), { state: 'paid', plan: 'supporter', expiresAt: null });
});

test('claim requires a verified session plus stored proof, clears proof only after success, and preserves refreshed session cookies', async () => {
  const calls = [];
  const res = await invoke('checkout/claim', { cookie: `${REFRESH_COOKIE}=refresh.token; ${CHECKOUT_COOKIE}=${proof}`, body: { checkoutToken: 'b'.repeat(64), email: 'attacker@example.test' }, service: { configured: true, guestConfigured: true, call: async (action, input) => {
    calls.push({ action, input });
    return action === 'auth/refresh' ? { status: 200, body: { accessToken: token, expiresIn: 3600 } } : { status: 200, body: { claimed: true, accessToken: 'private', sessionId: 'private' } };
  } } });
  assert.deepEqual(json(res), { claimed: true }); assert.deepEqual(calls.map((call) => call.action), ['auth/refresh', 'checkout/claim']);
  assert.deepEqual(calls[1].input.body, { checkoutToken: proof }); assert.equal(calls[1].input.accessToken, token);
  assert.equal(res.headers['set-cookie'].length, 3); assert(res.headers['set-cookie'].some((value) => value.startsWith(CHECKOUT_COOKIE + '=;') && value.includes('Max-Age=0')));
  for (const code of ['checkout_email_mismatch', 'payment_processing', 'purchase_already_claimed']) {
    const failed = await invoke('checkout/claim', { cookie: `${ACCESS_COOKIE}=${token}; ${CHECKOUT_COOKIE}=${proof}`, service: { configured: true, guestConfigured: true, call: async () => ({ status: 409, body: { error: code } }) } });
    assert.equal(failed.statusCode, 409); assert(!(failed.headers['set-cookie'] || []).some((value) => value.startsWith(CHECKOUT_COOKIE + '=')));
  }
  assert.equal((await invoke('checkout/claim', { cookie: `${CHECKOUT_COOKIE}=${proof}` })).statusCode, 401);
  assert.equal((await invoke('checkout/claim', { cookie: `${ACCESS_COOKIE}=${token}`, body: { checkoutToken: proof } })).statusCode, 410);
});

test('logout keeps purchase proof available for signing in with the correct checkout email', async () => {
  const res = await invoke('auth/logout', { cookie: `${ACCESS_COOKIE}=${token}; ${CHECKOUT_COOKIE}=${proof}` });
  assert.deepEqual(json(res), { signedOut: true });
  assert(!(res.headers['set-cookie'] || []).some((value) => value.startsWith(CHECKOUT_COOKIE + '=')));
});

test('proxy secret is sent only server-to-server on guest routes and unconfigured guest calls fail closed', async () => {
  const secret = 'offline-secret-only-for-unit-test-123456789-ABCDEF';
  const received = [];
  const service = createMembershipService({ upstream: 'https://api.example.test', proxySecret: secret, fetcher: async (url, init) => { received.push({ url, init }); return { status: 200, text: async () => '{}' }; } });
  for (const action of ['checkout/guest', 'checkout/status', 'checkout/claim']) await service.call(action, { body: { checkoutToken: proof }, accessToken: token });
  await service.call('account', { method: 'GET', accessToken: token });
  for (const call of received.slice(0, 3)) assert.equal(call.init.headers['x-trace-proxy-key'], secret);
  assert.equal(received[3].init.headers['x-trace-proxy-key'], undefined);
  const missing = createMembershipService({ upstream: 'https://api.example.test', proxySecret: '', fetcher: () => { throw Error('must not call'); } });
  assert.equal((await missing.call('checkout/guest')).status, 503);
  assert.equal((await invoke('checkout/prepare', { service: missing })).statusCode, 503);
});

test('free plan starts signup while paid plan buttons still directly open Stripe', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-plan="trace"/); assert.match(html, /data-plan="supporter"/);
  assert.doesNotMatch(html, /href="\/trace\/signup\?plan=/);
  assert.match(html, /href="\/trace\/signup">Start free/);
  assert.match(html, /<h3>Free<\/h3>/); assert.match(html, /<h3>Pro<\/h3>/);
  assert.match(html, /Last 7 days of replays/); assert.match(html, /Full replay archive/);
  assert.match(html, /Post-match deck study/); assert.doesNotMatch(html, /opponent decklist/i);
});

test('two browser tabs serialize prepare and checkout under the same Web Lock; unsupported browsers do not start requests', async () => {
  const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
  const events = []; const navigated = [];
  let queue = Promise.resolve(); let storedProof = null;
  const locks = { request(name, work) { assert.equal(name, 'trace-checkout'); const task = queue.then(work); queue = task.catch(() => {}); return task; } };
  function tab(id, supported = true) {
    let listener;
    const button = { dataset: { plan: 'trace' }, textContent: 'Get Trace', disabled: false, addEventListener(_name, fn) { listener = fn; } };
    const message = { hidden: true, textContent: '', replaceChildren() {}, append() {}, scrollIntoView() {} };
    const fetcher = async (url) => {
      events.push(`${id}:${url.endsWith('prepare') ? 'prepare' : 'checkout'}`);
      await Promise.resolve();
      if (url.endsWith('prepare')) { storedProof ||= proof; return { ok: true, json: async () => ({ ready: true }) }; }
      assert.equal(storedProof, proof);
      return { ok: true, json: async () => ({ url: checkoutUrl }) };
    };
    vm.runInNewContext(script, { document: { getElementById: (id) => id === 'year' ? {} : message, querySelectorAll: () => [button], createElement: () => ({}) }, navigator: supported ? { locks } : {}, fetch: fetcher, URL, Date, location: { assign: (url) => navigated.push(url) } });
    return { click: () => listener(), message };
  }
  const first = tab('A'); const second = tab('B');
  await Promise.all([first.click(), second.click()]);
  assert.deepEqual(events, ['A:prepare', 'A:checkout', 'B:prepare', 'B:checkout']);
  assert.deepEqual(navigated, [checkoutUrl, checkoutUrl]);
  const unsupported = tab('C', false); await unsupported.click();
  assert.equal(events.length, 4); assert.match(unsupported.message.textContent, /up-to-date browser/);
});

test('account checkout and guest resume share the pricing lock; billing portal stays independent', async () => {
  const script = readFileSync(new URL('../member.js', import.meta.url), 'utf8');
  let queue = Promise.resolve(); let insideLock = false; const paths = [];
  const locks = { request(name, work) {
    assert.equal(name, 'trace-checkout');
    const task = queue.then(async () => { assert.equal(insideLock, false); insideLock = true; try { return await work(); } finally { insideLock = false; } });
    queue = task.catch(() => {}); return task;
  } };
  const element = { setAttribute() {}, scrollIntoView() {}, innerHTML: '', hidden: true, textContent: '' };
  const context = vm.createContext({
    document: { getElementById: () => element }, window: { addEventListener() {} },
    location: { pathname: '/trace/account', search: '', assign() {} }, URL, URLSearchParams,
    navigator: { locks }, setTimeout,
    fetch: async (url) => {
      if (url.endsWith('/account')) return new Promise(() => {}); // Initial load is unrelated to the tested button actions.
      paths.push(url);
      if (url.includes('/checkout')) assert.equal(insideLock, true, 'checkout request must hold the shared lock');
      const destination = url.endsWith('/portal') ? 'https://billing.stripe.com/p/session/offline' : checkoutUrl;
      return { ok: true, json: async () => ({ url: destination }) };
    },
  });
  vm.runInContext(script, context);
  const button = () => ({ disabled: false, textContent: 'Continue' });
  await Promise.all([context.billing('checkout', button(), { plan: 'trace' }), context.billing('checkout/guest', button(), { plan: 'supporter' })]);
  await context.billing('portal', button());
  assert.deepEqual(paths, ['/trace/api/checkout', '/trace/api/checkout/guest', '/trace/api/portal']);
});

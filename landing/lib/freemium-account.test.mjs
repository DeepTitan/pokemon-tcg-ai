import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { publicAccount } from './membership.mjs';

const free = { email: 'player@example.test', plan: 'none', status: 'none', admin: false, traceAccess: false, opponentDecklists: false, expiresAt: null, cancelAtPeriodEnd: false, capabilities: { recordMatches: true, leaderboard: true, recentReplayDays: 7, fullHistory: false, expandedSharing: false, opponentDecklists: false, freeSharesPerWindow: 1, shareWindowDays: 7 } };
const pro = { ...free, plan: 'trace', status: 'active', traceAccess: true, expiresAt: '2099-10-01T00:00:00Z', capabilities: { ...free.capabilities, fullHistory: true, expandedSharing: true } };

function browser(search = '') {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', hidden: true, textContent: '', listeners: {}, setAttribute() {}, scrollIntoView() {}, addEventListener(name, listener) { this.listeners[name] = listener; }, querySelectorAll: () => [] });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element, querySelectorAll: () => [] },
    window: { scrollTo() {}, addEventListener() {} },
    location: { pathname: '/trace/account', search },
    URL, URLSearchParams, setTimeout() {},
    fetch: () => new Promise(() => {}), // The tested renderer receives a normalized account directly.
  });
  vm.runInContext(readFileSync(new URL('../member.js', import.meta.url), 'utf8'), context);
  return { context, element, html: () => element('account-root').innerHTML };
}

test('signup and reset show the same simple eight-character password rule', () => {
  for (const name of ['signup', 'reset']) {
    const view = browser(); view.context.renderAuth(name);
    assert.match(view.html(), /minlength="8"/);
    assert.match(view.html(), /maxlength="128"/);
    assert.match(view.html(), /8–128 characters\. No numbers or symbols required/);
    assert.doesNotMatch(view.html(), /minlength="12"|Include uppercase/);
    assert.doesNotMatch(view.html().match(/<input name="password"[^>]+>/)[0], /pattern=/);
  }
  const view = browser(); view.context.renderAuth('login');
  assert.doesNotMatch(view.html(), /minlength=/);
});

test('an existing signup opens explicit confirmation recovery without sending an email automatically', async () => {
  const view = browser('?setup=payment');
  let submitted;
  const calls = [];
  view.context.api = async (action) => { calls.push(action); throw Object.assign(new Error('account exists'), { code: 'account_exists' }); };
  view.context.navigate = (name) => { calls.push('navigate:' + name); view.context.renderAuth(name); };
  view.context.submitForm = (_form, _label, work) => { submitted = work({ get: (key) => key === 'email' ? 'member@example.test' : 'abcdefgh' }); return submitted; };
  view.context.renderAuth('signup');
  view.element('auth-form').listeners.submit({ preventDefault() {} });
  await submitted;
  assert.deepEqual(calls, ['auth/signup', 'navigate:confirm']);
  assert.match(view.html(), /Enter the code from your confirmation email/);
  assert.match(view.html(), /Send another code|Back to sign in/);
  assert.match(view.html(), /value="member@example.test"/);
  assert.match(view.element('message').textContent, /already has a Trace account/);
});

test('free account offers downloads and account linking before optional upgrades', () => {
  const view = browser(); view.context.renderAccount(free);
  const html = view.html();
  assert.match(html, /<h2>Free<\/h2>/);
  assert.match(html, /No subscription needed/);
  for (const platform of ['mac', 'windows']) assert.match(html, new RegExp(`platform=${platform}`));
  assert.match(html, /data-route href="\/trace\/connect">Link app<\/a>/);
  assert(html.indexOf('Download for macOS') < html.indexOf('data-checkout="trace"'));
  assert.match(html, /Choose Pro/); assert.match(html, /Choose Supporters Club/);
  assert.doesNotMatch(html, /Opponent decklist|See the other side|No active plan|Choose a monthly plan to use Trace/i);
});

test('Pro and owner accounts show access without duplicate purchase buttons', () => {
  for (const account of [pro, { ...pro, plan: 'supporter', status: 'admin', admin: true, expiresAt: null, opponentDecklists: true }]) {
    const view = browser(); view.context.renderAccount(account);
    assert.match(view.html(), account.admin ? /<h2>Owner access<\/h2>/ : /<h2>Pro<\/h2>/);
    assert.match(view.html(), /Download for macOS/);
    assert.doesNotMatch(view.html(), /data-checkout=/);
    if (account.admin) assert.doesNotMatch(view.html(), /id="manage-billing"/);
  }
});

test('overdue members retain free downloads and get billing recovery rather than another subscription', () => {
  const view = browser(); view.context.renderAccount({ ...free, plan: 'trace', status: 'past_due' });
  assert.match(view.html(), /<h2>Free<\/h2>/);
  assert.match(view.html(), /Download for macOS/);
  assert.match(view.html(), /id="manage-billing"/);
  assert.match(view.html(), /Your paid features are inactive/);
  assert.doesNotMatch(view.html(), /data-checkout=/);
});

test('backend billing-problem states retain the Free account UI and billing recovery', () => {
  for (const status of ['payment_pending', 'subscription_conflict', 'invalid_subscription']) {
    const view = browser();
    const plan = status === 'payment_pending' ? 'trace' : 'none';
    view.context.renderAccount(publicAccount({ ...pro, status, plan }));
    assert.match(view.html(), /<h2>Free<\/h2>/);
    assert.match(view.html(), /Download for macOS/);
    assert.match(view.html(), /id="manage-billing"/);
    assert.match(view.html(), /Your paid features are inactive/);
    assert.doesNotMatch(view.html(), /data-checkout=|Access unavailable/);
  }
});

test('missing access does not display downloads or falsely label account Free', () => {
  const view = browser(); view.context.renderAccount({ ...free, capabilities: {} });
  assert.match(view.html(), /Access unavailable/);
  assert.doesNotMatch(view.html(), /Download for macOS|<h2>Free<\/h2>/);
});

test('a free account cannot turn the Stripe success URL into paid membership confirmation', () => {
  const view = browser('?checkout=success'); view.context.renderAccount(free);
  assert.match(view.element('message').textContent, /Confirming your payment/);
  assert.doesNotMatch(view.element('message').textContent, /membership is ready/);
});

test('unfinished upgrades do not block free downloads and can resume on the same guest path', () => {
  for (const state of ['open', 'expired']) {
    const view = browser();
    const purchase = { state, plan: 'trace', expiresAt: null };
    assert.equal(view.context.needsPurchaseSetup(free, purchase, false), false);
    assert.equal(view.context.needsPurchaseSetup(null, purchase, false), true);
    view.context.renderAccount(free, purchase);
    assert.match(view.html(), /Download for macOS/);
    assert.match(view.html(), /You can keep using Free/);
    assert.match(view.html(), /id="resume-upgrade"/);
  }
  const view = browser();
  for (const state of ['paid', 'processing', 'claimed']) assert.equal(view.context.needsPurchaseSetup(free, { state, plan: 'trace' }, false), true);
  assert.equal(view.context.needsPurchaseSetup(free, { state: 'none', plan: 'none' }, true), true);
});

test('native link alias opens the same explicit device confirmation flow', () => {
  const view = browser('?code=ABCDE23456');
  view.context.location.pathname = '/trace/link';
  assert.equal(view.context.viewName(), 'connect');
  view.context.renderConnect(free);
  assert.match(view.html(), /I opened Trace and this is my code/);
  assert.match(view.html(), /ABCDE-23456/);
});

test('account and app-link screens need no Discord activation, even with legacy metadata', () => {
  const view = browser('?userCode=ABCDE23456&discord=retry');
  const account = { ...free, activation: { required: true, verified: false } };
  view.context.renderAccount(account);
  assert.match(view.html(), /Download for macOS/);
  assert.match(view.html(), /Continue linking your app/);
  assert.doesNotMatch(view.html(), /Verify Discord|Join the Trace Discord|discord\/callback/);
  assert.equal(view.context.context().discord, undefined);
  view.context.renderConnect(account);
  assert.match(view.html(), /I opened Trace and this is my code/);
});

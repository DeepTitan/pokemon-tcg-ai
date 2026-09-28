import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const free = { email: 'player@example.test', plan: 'none', status: 'none', admin: false, traceAccess: false, opponentDecklists: false, expiresAt: null, cancelAtPeriodEnd: false, capabilities: { recordMatches: true, leaderboard: true, recentReplayDays: 7, fullHistory: false, expandedSharing: false, opponentDecklists: false, freeSharesPerWindow: 1, shareWindowDays: 7 } };
const pro = { ...free, plan: 'trace', status: 'active', traceAccess: true, expiresAt: '2099-10-01T00:00:00Z', capabilities: { ...free.capabilities, fullHistory: true, expandedSharing: true } };

function browser(search = '') {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', hidden: true, textContent: '', setAttribute() {}, scrollIntoView() {}, addEventListener() {}, querySelectorAll: () => [] });
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

test('free account offers downloads and account linking before optional upgrades', () => {
  const view = browser(); view.context.renderAccount(free);
  const html = view.html();
  assert.match(html, /<h2>Free<\/h2>/);
  assert.match(html, /No subscription needed/);
  for (const platform of ['mac', 'windows']) assert.match(html, new RegExp(`platform=${platform}`));
  assert.match(html, /Have a code from Trace\? Link the app/);
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

test('required Discord activation replaces download links and app approval with explicit verification', () => {
  const view = browser('?userCode=ABCDE23456');
  const pending = { ...free, activation: { required: true, verified: false } };
  view.context.renderAccount(pending);
  assert.match(view.html(), /Join the Trace Discord/);
  assert.match(view.html(), /method="post" action="\/trace\/discord\/callback"/);
  assert.match(view.html(), /name="userCode" value="ABCDE23456"/);
  assert.doesNotMatch(view.html(), /Download for macOS|platform=windows/);
  view.context.renderConnect(pending);
  assert.doesNotMatch(view.html(), /id="link-form"/);
  view.context.renderAccount({ ...pending, activation: { required: true, verified: true } });
  assert.match(view.html(), /Continue linking your app/);
  assert.match(view.html(), /Download for macOS/);
});

test('native link alias opens the same explicit device confirmation flow', () => {
  const view = browser('?code=ABCDE23456');
  view.context.location.pathname = '/trace/link';
  assert.equal(view.context.viewName(), 'connect');
  view.context.renderConnect(free);
  assert.match(view.html(), /I opened Trace and this is my code/);
  assert.match(view.html(), /ABCDE-23456/);
});

test('paid users awaiting Discord retain billing and sign-out recovery without contradictory download instructions', () => {
  const view = browser('?checkout=success');
  view.context.renderAccount({ ...pro, activation: { required: true, verified: false } });
  assert.match(view.html(), /id="manage-billing"/);
  assert.match(view.html(), /id="sign-out"/);
  assert.doesNotMatch(view.html(), /Download for macOS/);
  assert.equal(view.element('message').textContent, 'Your membership is ready. Verify Discord to finish setup.');
});

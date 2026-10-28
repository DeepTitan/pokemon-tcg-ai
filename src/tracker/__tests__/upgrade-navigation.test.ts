import assert from 'node:assert/strict';
import { openMembershipAccount } from '../tauri.js';
const opened: string[] = [];
const previous = globalThis.window;
Object.assign(globalThis, { window: { open(url: string, target: string, features: string) {
  assert.equal(target, '_blank'); assert.equal(features, 'noopener,noreferrer'); opened.push(url);
} } });
try {
  for (const interval of ['month', 'year'] as const) {
    await openMembershipAccount(`checkout-${interval}`);
    const url = new URL(opened.pop()!);
    assert.equal(url.origin, 'https://victoryroad.app');
    assert.equal(url.pathname, '/trace');
    assert.equal(url.searchParams.get('checkout'), 'trace');
    assert.equal(url.searchParams.get('billingInterval'), interval);
  }
  await openMembershipAccount();
  assert.equal(opened.pop(), 'https://victoryroad.app/trace/account');
  await openMembershipAccount('plans');
  assert.equal(opened.pop(), 'https://victoryroad.app/trace#plans');
} finally { Object.assign(globalThis, { window: previous }); }
console.log('upgrade-navigation: both billing intervals and existing account links preserved');

import assert from 'node:assert/strict';
import './shared-card-sources.test.js';
import './shared-access.test.js';
import {
  readStoredShareLinks,
  SHARE_LINKS_STORAGE_KEY,
  sharedReplayIdFromPath,
  storeShareLink,
  loadSharedReplay,
} from '../share-replay.js';

const id = 'Abcdefghijklmnopqrstuvwx';
assert.equal(sharedReplayIdFromPath(`/trace/${id}`), id);
assert.equal(sharedReplayIdFromPath(`/trace/${id}/`), id);
assert.equal(sharedReplayIdFromPath('/trace/too-short'), null);
assert.equal(sharedReplayIdFromPath(`/other/${id}`), null);
assert.equal(sharedReplayIdFromPath(`/trace/${id}/extra`), null);

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) || null,
  setItem: (key: string, value: string) => { values.set(key, value); },
};
const url = `https://victoryroad.app/trace/${id}`;
const stored = storeShareLink(storage, {}, 'match-1', url);
assert.deepEqual(stored, { 'match-1': url });
assert.deepEqual(readStoredShareLinks(storage), stored);

values.set(SHARE_LINKS_STORAGE_KEY, JSON.stringify({
  valid: url,
  wrongHost: `https://example.com/trace/${id}`,
  wrongPath: 'https://victoryroad.app/trace/too-short',
}));
assert.deepEqual(readStoredShareLinks(storage), { valid: url });

values.set(SHARE_LINKS_STORAGE_KEY, '{not json');
assert.deepEqual(readStoredShareLinks(storage), {});

console.log('share replay route tests passed');

const originalFetch = globalThis.fetch;
try {
  const payload = { review: { id: 'match-1', turns: [{ index: 0 }] }, reducerVersion: 11 };
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), `https://p5xbv2rfya.execute-api.us-east-1.amazonaws.com/v1/shares/${id}`);
    assert.equal(init?.cache, 'no-cache', 'Reuse HTTP cache only after server revalidation');
    return new Response(JSON.stringify(payload));
  };
  assert.deepEqual(await loadSharedReplay(id), payload);
  globalThis.fetch = async () => new Response('{}', { status: 404 });
  await assert.rejects(loadSharedReplay(id), /could not be found/);
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  await assert.rejects(loadSharedReplay(id), /temporarily unavailable/);
  globalThis.fetch = async () => new Response('{"review":{}}');
  await assert.rejects(loadSharedReplay(id), /incomplete/);
} finally {
  globalThis.fetch = originalFetch;
}
console.log('shared replay revalidation tests passed');

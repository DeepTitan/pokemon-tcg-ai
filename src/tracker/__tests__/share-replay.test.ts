import assert from 'node:assert/strict';
import {
  readStoredShareLinks,
  SHARE_LINKS_STORAGE_KEY,
  sharedReplayIdFromPath,
  storeShareLink,
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

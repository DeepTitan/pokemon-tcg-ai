import assert from 'node:assert/strict';
import { sharedReplayIdFromPath } from '../share-replay.js';

const id = 'Abcdefghijklmnopqrstuvwx';
assert.equal(sharedReplayIdFromPath(`/trace/${id}`), id);
assert.equal(sharedReplayIdFromPath(`/trace/${id}/`), id);
assert.equal(sharedReplayIdFromPath('/trace/too-short'), null);
assert.equal(sharedReplayIdFromPath(`/other/${id}`), null);
assert.equal(sharedReplayIdFromPath(`/trace/${id}/extra`), null);

console.log('share replay route tests passed');

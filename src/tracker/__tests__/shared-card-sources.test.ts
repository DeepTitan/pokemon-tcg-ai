import assert from 'node:assert/strict';
import { createSharedCardResolver } from '../shared-card-sources.js';

const requested: string[] = [];
const resolve = createSharedCardResolver((async (url: string) => {
  requested.push(url);
  return new Response(JSON.stringify([
    { id: 'me5_39', name: 'Dhelmise', imageDataUrl: '/tracker-assets/card-art/me5_39.png' },
    { id: 'me5_34', name: 'Banette', imageDataUrl: '/tracker-assets/card-art/me5_34.png' },
    { id: 'me5_6', name: 'Sinistcha' },
    { id: 'unrelated_1', name: 'Wrong set' },
  ]));
}) as typeof fetch);
const result = await resolve(['ME5_39', 'me5_34', 'me5_39', '../secrets', 'https://example.com', '']);
assert.deepEqual(requested, ['/tracker-assets/card-catalog/me5.json']);
assert.deepEqual(result.map(card => card.id), ['me5_39', 'me5_34']);
await resolve(['me5_39']);
assert.equal(requested.length, 1, 'Reuse the printed set, not another network request per frame');
let attempts = 0;
const retry = createSharedCardResolver((async () => {
  attempts++;
  return attempts === 1 ? new Response('', { status: 503 }) : new Response(JSON.stringify([{ id: 'me5_39', name: 'Dhelmise' }]));
}) as typeof fetch);
assert.deepEqual(await retry(['me5_39']), []);
assert.equal((await retry(['me5_39']))[0].name, 'Dhelmise');
assert.equal(attempts, 2, 'Temporary failures must remain retryable');
const invalid = createSharedCardResolver((async () => new Response('{}')) as typeof fetch);
assert.deepEqual(await invalid(['me5_39']), []);
const cacheRequests: string[] = [];
const bounded = createSharedCardResolver((async (url: string) => {
  cacheRequests.push(url);
  return new Response('[]');
}) as typeof fetch);
await Promise.all([bounded(['set0_1']), bounded(['set0_2'])]);
assert.equal(cacheRequests.length, 1, 'Concurrent lookups share one in-flight request');
for (let i = 1; i <= 32; i++) await bounded([`set${i}_1`]);
await bounded(['set0_1']);
assert.equal(cacheRequests.length, 34, 'The oldest set is evicted after 32 cached sets');
console.log('shared-card-sources: set batching, exact identities, bounded cache, retry and invalid input passed');

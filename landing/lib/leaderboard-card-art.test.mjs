import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { shareCardCatalog } from './share-catalog.mjs';
import { knownCardId, leaderboardArtManifest, leaderboardCardArt, leaderboardPublicArtUrl } from './leaderboard-card-art.mjs';
import { measureCardArt } from './share-card-art.mjs';
import { createLeaderboardArtHandler } from '../api/leaderboard-art.mjs';

test('all audited history cards have catalog-verified, intact portrait artwork and return images directly', () => {
  const catalog = shareCardCatalog();
  for (const [id, entry] of Object.entries(leaderboardArtManifest.cards)) {
    assert.equal(catalog.get(id)?.name, entry.name, id);
    assert.equal(catalog.get(entry.printing)?.name, entry.name, `${id} source printing`);
    const bytes = readFileSync(new URL(`../assets/leaderboard-card-art/${id}.png`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, id);
    assert.equal(bytes.readUInt32BE(20), 256, id);
    const bounds = measureCardArt({ bytes, contentType: 'image/png' });
    assert.ok(bounds.width >= 170 && bounds.width <= 190, id);
  }
  const handler = createLeaderboardArtHandler();
  for (const id of leaderboardArtManifest.requestedIds) {
    const response = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
    handler({ method: 'GET', query: { cardId: id } }, response);
    assert.equal(response.statusCode, 200, id);
    assert.equal(response.headers['Content-Type'], 'image/png', id);
    assert.ok(response.body.length > 1000, id);
    assert.equal(response.headers.Location, undefined, id);
  }
});

test('Trumbeak and recognized foil finishes share the correct locally hosted card', () => {
  const original = leaderboardCardArt('me5_67');
  assert.equal(leaderboardArtManifest.cards.me5_67.name, 'Trumbeak');
  for (const id of ['ME5_67', 'me5_67_ph', 'me5_67_ph2', 'me5_67_sph', 'me5_67_mph']) {
    assert.deepEqual(leaderboardCardArt(id)?.bytes, original.bytes, id);
  }
  assert.notDeepEqual(leaderboardCardArt('me5_66')?.bytes, original.bytes);
});

test('new illustrations reuse only catalog-confirmed Pokémon; unknown IDs and suffixes cannot borrow art', () => {
  assert.ok(leaderboardCardArt('sm1_107'), 'An older Trumbeak printing has a known-species illustration fallback');
  for (const id of ['../../me5_67', 'https://evil.example/me5_67', 'me5_67_fake', 'unknown_67', '__proto__']) {
    assert.equal(knownCardId(id), undefined);
    assert.equal(leaderboardCardArt(id), undefined);
    assert.equal(leaderboardPublicArtUrl(id), undefined);
  }
});

test('unbundled newer cards use verified public set codes, including cosmetic finishes', () => {
  assert.equal(leaderboardPublicArtUrl('me5_67_ph'), 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/PBL/PBL_067_R_EN_LG.png');
  assert.equal(leaderboardPublicArtUrl('sv8-5_80_mph'), 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/PRE/PRE_080_R_EN_LG.png');
  assert.equal(leaderboardPublicArtUrl('mebsp_66'), 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/MEP/MEP_066_R_EN_LG.png');
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { shareCardCatalog } from './share-catalog.mjs';
import { browserCardCatalog } from './replay-card-catalog.mjs';

test('browser card catalog serves every cached original, including trainers and special Energy', () => {
  const { ids } = JSON.parse(fs.readFileSync(new URL('../assets/replay-art-manifest.json', import.meta.url)));
  const sets = browserCardCatalog(shareCardCatalog().values(), ids);
  assert.ok(ids.length >= 588);
  const cards = new Map([...sets.values()].flat().map(card => [card.id, card]));
  for (const id of ids) {
    const card = cards.get(id);
    assert.ok(card, id);
    assert.equal(card.imageDataUrl, `/tracker-assets/card-art/${id}.png`);
    const png = fs.readFileSync(new URL(`../assets/replay-card-art/${id}.png`, import.meta.url));
    assert.equal(png.readUInt32BE(16), 182, id);
    assert.equal(png.readUInt32BE(20), 256, id);
    assert.equal(card.imagePath, undefined, 'Never ship local filesystem paths');
  }
  for (const id of ['me5_5', 'me5_34', 'me5_39', 'me3_88', 'me4_80', 'me4_82', 'me5_78']) {
    assert.ok(cards.get(id).imageDataUrl.startsWith('/tracker-assets/card-art/'), id);
  }
  assert.equal(cards.get('me2-5_127_ph2').imageDataUrl, '/tracker-assets/card-art/me2-5_127_ph2.png', 'Prefer the exact cached finish');
  const fallbackSets = browserCardCatalog([cards.get('me2-5_127_ph2')], ['me2-5_127']);
  assert.equal(fallbackSets.get('me2-5')[0].imageDataUrl, '/tracker-assets/card-art/me2-5_127.png');
  assert.ok(cards.get('me5_39').actions.length > 0, 'Retain native printed card details');
  assert.ok(cards.get('me5_39').format, 'Retain Pokémon stage and card classification');
  assert.ok(cards.get('me5_39').retreat > 0, 'Do not turn missing retreat data into free retreat');
  assert.ok(cards.get('me4_80').format.includes('A'), 'Retain Stadium classification');
  assert.ok(cards.get('me3_88').rulesText, 'Retain special Energy rules');
  assert.ok(cards.get('me4_80').rulesText, 'Retain Stadium rules');
});

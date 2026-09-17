import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { CARD_BACK_ART, VERIFIED_CARD_ART, cardArtUsesAlternate, cardCatalogEntryNeedsRefresh, findCatalogCard, publicCardArtUrl, resolvedCardArt, showCardBackOnError } from '../card-art.js';
import type { CardInfo } from '../types.js';

const stadiumCatalog = new Map([
  ['me2_85', { id: 'me2_85', name: 'Battle Cage', imageDataUrl: 'asset://battle-cage.png' }],
  ['me1_127', { id: 'me1_127', name: 'Risky Ruins', imageDataUrl: 'asset://risky-ruins.png' }],
]);

assert.equal(findCatalogCard('me2_85', 'me2_85', stadiumCatalog)?.name, 'Battle Cage', 'captured Stadium IDs should resolve their exact printing');
assert.equal(findCatalogCard(undefined, 'Risky Ruins', stadiumCatalog)?.id, 'me1_127', 'older name-only Stadium snapshots should still recover artwork');

assert.equal(publicCardArtUrl('sv9_120'), 'https://images.pokemontcg.io/sv9/120.png');
assert.equal(publicCardArtUrl('sv8-5_6'), 'https://images.pokemontcg.io/sv8pt5/6.png');
assert.equal(publicCardArtUrl('me2-5_183_ph'), 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/ASC/ASC_183_R_EN_LG.png');
assert.equal(publicCardArtUrl('hidden-card'), undefined);
assert.equal(resolvedCardArt(undefined), CARD_BACK_ART);
assert.equal(resolvedCardArt('sv9_120', 'asset://local-card.png'), 'asset://local-card.png');
assert.equal(cardCatalogEntryNeedsRefresh('sv9_120', new Map()), true);
assert.equal(cardCatalogEntryNeedsRefresh('sv9_120', new Map([['sv9_120', { id: 'sv9_120', name: 'sv9_120' }]])), true);
assert.equal(cardCatalogEntryNeedsRefresh('sv9_120', new Map([['sv9_120', { id: 'sv9_120', name: 'Dunsparce', imageDataUrl: 'asset://local-card.png' }]])), false);

const brokenLocalImage = {
  src: 'asset://localhost/missing-local-card.png',
  dataset: { cardId: 'sv9_120' },
} as unknown as HTMLImageElement;
showCardBackOnError({ currentTarget: brokenLocalImage });
assert.equal(brokenLocalImage.src, 'https://images.pokemontcg.io/sv9/120.png', 'a stale local image should try the public artwork before the card back');
showCardBackOnError({ currentTarget: brokenLocalImage });
assert.equal(brokenLocalImage.src, CARD_BACK_ART, 'the card back remains the final fallback when both artwork sources fail');

assert.equal(Object.keys(VERIFIED_CARD_ART).length, 27);
assert.equal(publicCardArtUrl('svbsp_166'), 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVP/SVP_166_R_EN_LG.png');
assert.equal(publicCardArtUrl('me3_21'), 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/POR/POR_021_R_EN_LG.png');
assert.equal(publicCardArtUrl('ME2-5_214_ph'), publicCardArtUrl('me2-5_214'));
assert.equal(cardArtUsesAlternate('svalt_155'), true);
assert.equal(cardArtUsesAlternate('sve_17_ph'), true);
assert.equal(cardArtUsesAlternate('me2-5_47'), false);
assert.equal(resolvedCardArt('me3_21', 'asset://exact.png'), 'asset://exact.png');

const printed: { cards: CardInfo[] } = JSON.parse(gunzipSync(readFileSync(
  new URL('../../../landing/assets/share-card-catalog.json.gz', import.meta.url),
)).toString('utf8'));
const capturedSnorunt = printed.cards.find(card => card.id === 'svalt_103');
const alternateSnorunt = printed.cards.find(card => card.id === 'sv4_37');
assert.ok(capturedSnorunt);
assert.ok(alternateSnorunt);
assert.equal(capturedSnorunt.name, 'Snorunt');
const mechanicKeys = ['name', 'category', 'hp', 'cardType', 'evolvesFrom', 'actions', 'format',
  'retreat', 'weaknessType', 'weaknessAmount', 'resistanceType', 'resistanceAmount', 'rulesText'] as const;
const mechanics = (card: CardInfo) => Object.fromEntries(mechanicKeys.map(key => [key, card[key]]));
assert.deepEqual(mechanics(capturedSnorunt), mechanics(alternateSnorunt),
  'Snorunt artwork fallback must match complete printed mechanics, not only its name');
const snoruntArt = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/PAR/PAR_037_R_EN_LG.png';
for (const suffix of ['', '_ph', '_ph2', '_sph', '_sph2', '_mph']) {
  const id = `SVALT_103${suffix}`;
  assert.equal(publicCardArtUrl(id), snoruntArt, 'Known finishes retain the verified printing alias');
  assert.equal(cardArtUsesAlternate(id), true, 'The fallback remains explicitly alternate artwork');
  assert.equal(resolvedCardArt(id, 'asset://exact-snorunt.png'), 'asset://exact-snorunt.png',
    'Exact captured local artwork takes precedence over the alternate fallback');
}
for (const suffix of ['_unknown', '_ph_extra', '_ph2extra', '_ph_ph']) {
  const id = `svalt_103${suffix}`;
  assert.equal(publicCardArtUrl(id), 'https://images.pokemontcg.io/svalt/103.png',
    'Unknown suffixes retain the existing generic fallback without acquiring a verified alias');
  assert.equal(cardArtUsesAlternate(id), false);
}
assert.equal(publicCardArtUrl('svalt_104'), 'https://images.pokemontcg.io/svalt/104.png',
  'A nearby collector number does not inherit the Snorunt alias');

for (const [id, printing, hp, attack, cost] of [
  ['me2-5_46', 'ASC/046', 70, 'Chilly', 'W'],
  ['me2-5_227', 'ASC/227', 70, 'Chilly', 'W'],
  ['xy9-5r_7', 'GEN/RC7', 50, 'Icy Snow', 'C'],
] as const) {
  const card = printed.cards.find(card => card.id === id);
  assert.ok(card);
  assert.equal(card.name, 'Snorunt');
  assert.equal(card.hp, hp);
  assert.deepEqual(card.actions, [{ kind: 'attack', name: attack, text: '', cost, damage: '10' }],
    'The exact printing must retain its provider-verified attack');
  const [set, number] = printing.split('/');
  const artwork = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${set}/${set}_${number}_R_EN_LG.png`;
  for (const suffix of ['', '_ph', '_ph2', '_sph', '_sph2', '_mph']) {
    const capturedId = `${id}${suffix}`;
    assert.equal(publicCardArtUrl(capturedId), artwork);
    assert.equal(cardArtUsesAlternate(capturedId), false, 'An exact printing is not labeled alternate artwork');
    assert.equal(resolvedCardArt(capturedId, 'asset://exact-finish.png'), 'asset://exact-finish.png',
      'An available exact local finish still takes precedence over provider artwork');
  }
}
assert.notEqual(publicCardArtUrl('me2-5_46'), publicCardArtUrl('me2-5_227'),
  'Mechanically identical Snorunt printings retain their distinct exact artwork');

for (const [internal, provider] of [
  ['me2-5', 'ASC'], ['me3', 'POR'], ['me4', 'CRI'], ['mee', 'MEE'],
  ['rsv10-5', 'WHT'], ['zsv10-5', 'BLK'],
] as const) {
  const setCards = printed.cards.filter(card => new RegExp(`^${internal}_[1-9]\\d*$`).test(card.id));
  assert.ok(setCards.length > 0, `The public catalog must contain ${internal}`);
  for (const card of setCards) {
    const number = card.id.split('_')[1];
    const artwork = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${provider}/${provider}_${number.padStart(3, '0')}_R_EN_LG.png`;
    for (const suffix of ['', '_ph', '_ph2', '_sph', '_mph']) {
      assert.equal(publicCardArtUrl(`${card.id}${suffix}`), artwork,
        'Verified regular sets retain collector numbers across recognized finishes');
    }
    assert.equal(cardArtUsesAlternate(card.id), false);
    assert.equal(resolvedCardArt(card.id, 'asset://cached-printing.png'), 'asset://cached-printing.png');
  }
}
for (const id of ['me4_82_unknown', 'me4_82_ph_extra', 'me4_82abc', 'me4_0', 'me4_082']) {
  assert.ok(!publicCardArtUrl(id)?.includes('/CRI/'), 'Malformed collector IDs cannot acquire a verified set mapping');
}
assert.equal(publicCardArtUrl('mealt_82'), 'https://images.pokemontcg.io/mealt/82.png',
  'Alternate-art namespaces must not inherit a regular set mapping');

for (const id of Object.keys(VERIFIED_CARD_ART)) {
  const img = {src:'asset://missing.png',dataset:{cardId:id}} as unknown as HTMLImageElement;
  showCardBackOnError({currentTarget:img});
  assert.equal(img.src, publicCardArtUrl(id));
  showCardBackOnError({currentTarget:img});
  assert.equal(img.src, CARD_BACK_ART, 'failed provider must terminate without an error loop');
  assert.equal(img.dataset.cardId, id, 'Artwork fallback preserves the captured printing identity');
}

console.log('card art tests passed');

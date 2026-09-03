import assert from 'node:assert/strict';
import { CARD_BACK_ART, cardCatalogEntryNeedsRefresh, publicCardArtUrl, resolvedCardArt, showCardBackOnError } from '../card-art.js';

assert.equal(publicCardArtUrl('sv9_120'), 'https://images.pokemontcg.io/sv9/120.png');
assert.equal(publicCardArtUrl('sv8-5_6'), 'https://images.pokemontcg.io/sv8pt5/6.png');
assert.equal(publicCardArtUrl('me2-5_183_ph'), 'https://images.pokemontcg.io/me2pt5/183.png');
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

console.log('card art tests passed');

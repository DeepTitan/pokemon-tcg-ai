import assert from 'node:assert/strict';
import { CARD_BACK_ART, publicCardArtUrl, resolvedCardArt } from '../card-art.js';

assert.equal(publicCardArtUrl('sv9_120'), 'https://images.pokemontcg.io/sv9/120.png');
assert.equal(publicCardArtUrl('sv8-5_6'), 'https://images.pokemontcg.io/sv8pt5/6.png');
assert.equal(publicCardArtUrl('me2-5_183_ph'), 'https://images.pokemontcg.io/me2pt5/183.png');
assert.equal(publicCardArtUrl('hidden-card'), undefined);
assert.equal(resolvedCardArt(undefined), CARD_BACK_ART);
assert.equal(resolvedCardArt('sv9_120', 'asset://local-card.png'), 'asset://local-card.png');

console.log('card art tests passed');

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const payload = JSON.parse(gunzipSync(readFileSync(new URL('../assets/share-card-catalog.json.gz', import.meta.url))));
const printedCards = new Map(payload.cards.map(card => [card.id.toLowerCase(), card]));
const originalArtIds = new Set(payload.artIds);

export function shareCardCatalog(decklists = []) {
  const catalog = new Map(printedCards);
  for (const deck of decklists) {
    if (!Array.isArray(deck?.cards)) continue;
    for (const entry of deck.cards) {
      const cardId = entry?.cardId;
      if (typeof cardId !== 'string') continue;
      const card = printedCards.get(cardId.toLowerCase().replace(/_ph$/, ''));
      if (card) catalog.set(cardId, { ...card, id: cardId });
    }
  }
  return catalog;
}

export function originalCardArt(cardId) {
  if (typeof cardId !== 'string') return undefined;
  const id = [cardId.toLowerCase(), cardId.toLowerCase().replace(/_ph$/, '')].find(value => originalArtIds.has(value));
  // Only bundled manifest entries can be read; never trust an incoming path.
  if (!id) return undefined;
  return { bytes: readFileSync(new URL(`../assets/share-card-art/${id}.png`, import.meta.url)), contentType: 'image/png' };
}

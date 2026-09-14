import { publicCardArtUrl } from './generated/share-matchup.mjs';

export function browserCardCatalog(cards, artworkIds) {
  const artwork = new Set(artworkIds);
  const sets = new Map();
  for (const card of cards) {
    const id = card.id.toLowerCase();
    const artId = [id, id.replace(/_(?:s?ph)\d*$/, '')].find(value => artwork.has(value));
    const entry = { ...card, id, imageDataUrl: artId
      ? `/tracker-assets/card-art/${artId}.png`
      : publicCardArtUrl(id) };
    const name = id.split('_')[0];
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid printed card set');
    if (!sets.has(name)) sets.set(name, []);
    sets.get(name).push(entry);
  }
  return sets;
}

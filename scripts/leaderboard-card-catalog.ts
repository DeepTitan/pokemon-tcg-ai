import type { CardInfo } from '../src/tracker/types.js';

// Live's foil suffix changes the finish, not the printed card's mechanics.
// Resolve only known finish suffixes; a different collector number is a different card.
const basePrintingId = (id: string) => id.replace(/_(?:s?ph)\d*$/, '');
const metadataKeys = ['hp', 'category', 'cardType', 'setCode', 'number', 'format', 'retreat',
  'weaknessType', 'weaknessAmount', 'resistanceType', 'resistanceAmount', 'evolvesFrom',
  'rulesText', 'actions'] as const;

function metadata(card: CardInfo, id = card.id): CardInfo {
  if (!card || typeof card.id !== 'string' || !card.id || typeof card.name !== 'string' || !card.name) {
    throw new TypeError('Invalid leaderboard card metadata');
  }
  return { id, name: card.name, ...Object.fromEntries(metadataKeys
    .filter(key => card[key] !== undefined).map(key => [key, card[key]])) };
}

function withKnownArt(card: CardInfo, historical?: CardInfo): CardInfo {
  return { ...card,
    ...(historical?.imagePath ? { imagePath: historical.imagePath } : {}),
    ...(historical?.imageDataUrl ? { imageDataUrl: historical.imageDataUrl } : {}),
  };
}

class LeaderboardCardCatalog extends Map<string, CardInfo> {
  override get(id: string): CardInfo | undefined {
    const key = id.toLowerCase();
    const exact = super.get(key);
    if (exact) return exact;
    const baseId = basePrintingId(key);
    const base = baseId !== key ? super.get(baseId) : undefined;
    // Metadata is shared across finishes. Art availability is printing-specific;
    // do not pretend the base image exists under an unobserved finish's filename.
    return base ? metadata(base, key) : undefined;
  }

  override has(id: string): boolean { return this.get(id) !== undefined; }
}

/** Use the same printed mechanics as Trace's card resolver. Historical records
 * retain known art and cards absent from the full catalog; they are not the
 * authoritative universe of cards a new opponent is allowed to play.
 */
export function buildLeaderboardCardCatalog(
  printedCards: readonly CardInfo[],
  historicalCards: readonly CardInfo[],
): Map<string, CardInfo> {
  const printed = new Map(printedCards.map(card => {
    const value = metadata(card);
    return [value.id.toLowerCase(), value] as const;
  }));
  const historical = new Map(historicalCards.map(card => {
    metadata(card);
    return [card.id.toLowerCase(), card] as const;
  }));
  const catalog = new LeaderboardCardCatalog();
  for (const [id, card] of printed) catalog.set(id, withKnownArt(card, historical.get(id)));
  for (const [id, card] of historical) {
    if (catalog.has(id) && printed.has(id)) continue;
    const resolved = printed.get(id) ?? printed.get(basePrintingId(id));
    catalog.set(id, withKnownArt(metadata(resolved ?? card, card.id), card));
  }
  return catalog;
}

import type { CardInfo } from './types.js';

export const CARD_BACK_ART = '/tracker-assets/pokemon-card-back.jpg';

// Verified against the provider's card pages. Live's internal set/variant IDs
// are not public catalog IDs; never infer an alternate printing from its number.
export const VERIFIED_CARD_ART: Readonly<Record<string, { printing: string; alternate?: boolean }>> = {
  me3_106: { printing: 'POR/106' },
  me3_21: { printing: 'POR/21' },
  'me2-5_275': { printing: 'ASC/275' },
  'me2-5_193': { printing: 'ASC/193' },
  'me2-5_46': { printing: 'ASC/46' },
  'me2-5_47': { printing: 'ASC/47' },
  'me2-5_227': { printing: 'ASC/227' },
  'me2-5_214': { printing: 'ASC/214' },
  'me2-5_272': { printing: 'ASC/272' },
  'me2-5_293': { printing: 'ASC/293' },
  'me2-5_209': { printing: 'ASC/209' },
  me5_103: { printing: 'PBL/103' },
  'me2-5_162': { printing: 'ASC/162' },
  mebsp_31: { printing: 'MEP/31' },
  svbsp_115: { printing: 'SVP/115' },
  svbsp_166: { printing: 'SVP/166' },
  'sm11-5_64': { printing: 'HIF/64' },
  svbsp_203: { printing: 'SVP/203' },
  'me2-5_207': { printing: 'ASC/207' },
  'xy9-5r_7': { printing: 'GEN/RC7' },
  // Same gameplay text, not a claim of identical cosmetic artwork.
  // svalt_103 and sv4_37 share Snorunt's complete printed mechanics (PAR/37).
  svalt_103: { printing: 'PAR/37', alternate: true },
  svalt_155: { printing: 'TWM/95', alternate: true },
  svalt_166: { printing: 'JTG/116', alternate: true },
  mealt_3: { printing: 'MEG/1', alternate: true },
  smalt_154: { printing: 'UNB/182', alternate: true },
  swshalt_102: { printing: 'BRS/132', alternate: true },
  sve_17: { printing: 'SVE/1', alternate: true },
};

// Only known finish families inherit an explicitly verified printing alias.
const verifiedArtId = (cardId: string) => cardId.toLowerCase().replace(/_(?:ph|sph|mph)\d*$/, '');

// These regular sets preserve collector numbers in the public catalog. Keep
// internal alternate-art namespaces (svalt, mealt, etc.) in the per-card map.
const VERIFIED_ART_SETS: Readonly<Record<string, string>> = {
  'me2-5': 'ASC',
  me3: 'POR',
  me4: 'CRI',
  mee: 'MEE',
  'rsv10-5': 'WHT',
  'zsv10-5': 'BLK',
};

function printingArtUrl(set: string, number: string): string {
  if (set === 'SVE') return `https://images.pokemontcg.io/sve/${number}.png`;
  return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${set}/${set}_${number.padStart(3, '0')}_R_EN_LG.png`;
}

export function cardArtUsesAlternate(cardId: string): boolean {
  return VERIFIED_CARD_ART[verifiedArtId(cardId)]?.alternate === true;
}

export function findCatalogCard(
  cardId: string | undefined,
  cardName: string | undefined,
  catalog: ReadonlyMap<string, CardInfo>,
): CardInfo | undefined {
  for (const candidate of [cardId, cardName]) {
    if (!candidate) continue;
    const direct = catalog.get(candidate) || catalog.get(candidate.toLowerCase());
    if (direct) return direct;
  }
  const normalizedName = cardName?.trim().toLowerCase();
  if (!normalizedName) return undefined;
  return [...catalog.values()].find((card) => card.name.trim().toLowerCase() === normalizedName);
}

export function cardCatalogEntryNeedsRefresh(cardId: string, catalog: ReadonlyMap<string, CardInfo>): boolean {
  const info = catalog.get(cardId) || catalog.get(cardId.toLowerCase());
  return !info || !info.imageDataUrl || info.name.trim().toLowerCase() === cardId.toLowerCase();
}

export function publicCardArtUrl(cardId: string | undefined): string | undefined {
  if (!cardId) return undefined;
  const verified = VERIFIED_CARD_ART[verifiedArtId(cardId)];
  if (verified) {
    const [set, number] = verified.printing.split('/');
    return printingArtUrl(set, number);
  }
  const printing = verifiedArtId(cardId).match(/^([a-z0-9-]+)_([1-9]\d*)$/);
  const providerSet = printing && VERIFIED_ART_SETS[printing[1]];
  if (providerSet) return printingArtUrl(providerSet, printing[2]);
  const [rawSet, rawNumber] = cardId.toLowerCase().split('_');
  const number = rawNumber?.match(/^\d+/)?.[0];
  if (!rawSet || !number) return undefined;
  // PTCGL writes special expansions as sv8-5, sv6-5, etc. The public card
  // image catalog uses the equivalent sv8pt5 / sv6pt5 identifiers.
  const set = rawSet.replace(/-(\d+)$/, 'pt$1');
  return `https://images.pokemontcg.io/${set}/${Number(number)}.png`;
}

export function resolvedCardArt(cardId: string | undefined, localArt?: string): string {
  return localArt || publicCardArtUrl(cardId) || CARD_BACK_ART;
}

export function showCardBackOnError(event: { currentTarget: HTMLImageElement }): void {
  const image = event.currentTarget;
  const publicFallback = publicCardArtUrl(image.dataset.cardId);
  if (publicFallback && image.src !== publicFallback && image.dataset.publicFallbackTried !== 'true') {
    image.dataset.publicFallbackTried = 'true';
    image.src = publicFallback;
    return;
  }
  if (!image.src.endsWith(CARD_BACK_ART)) image.src = CARD_BACK_ART;
}

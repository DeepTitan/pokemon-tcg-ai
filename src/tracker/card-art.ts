export const CARD_BACK_ART = '/tracker-assets/pokemon-card-back.jpg';

export function publicCardArtUrl(cardId: string | undefined): string | undefined {
  if (!cardId) return undefined;
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
  if (!event.currentTarget.src.endsWith(CARD_BACK_ART)) event.currentTarget.src = CARD_BACK_ART;
}

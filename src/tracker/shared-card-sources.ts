import type { CardInfo } from './types.js';

const CARD_ID = /^[a-z0-9-]+_\d+(?:_[a-z0-9]+)?$/;
const TRACE_ASSET_ORIGIN = 'https://victoryroad-lovat.vercel.app';

export function sharedCardAssetOrigin(hostname: string): string {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? '' : TRACE_ASSET_ORIGIN;
}

/** Browser equivalent of the native card lookup. Only printed metadata and
 * artwork are fetched, lazily by set; recorded board state is never rebuilt. */
export function createSharedCardResolver(fetcher: typeof fetch = fetch, assetOrigin = '') {
  const sets = new Map<string, Promise<CardInfo[]>>();
  return async (cardIds: string[]): Promise<CardInfo[]> => {
    const ids = [...new Set(cardIds.map(id => id.toLowerCase()).filter(id => CARD_ID.test(id)))];
    const names = [...new Set(ids.map(id => id.split('_')[0]))];
    const batches = await Promise.all(names.map(async name => {
      if (!sets.has(name)) {
        const request = (async () => {
          const response = await fetcher(`${assetOrigin}/tracker-assets/card-catalog/${name}.json`);
          if (!response.ok) throw new Error('Card set unavailable');
          const cards: unknown = await response.json();
          if (!Array.isArray(cards)) throw new Error('Invalid card set');
          return cards.filter((card): card is CardInfo => typeof card?.id === 'string'
            && card.id.split('_')[0] === name && typeof card.name === 'string')
            .map(card => assetOrigin && card.imageDataUrl?.startsWith('/tracker-assets/')
              ? { ...card, imageDataUrl: `${assetOrigin}${card.imageDataUrl}` } : card);
        })();
        sets.set(name, request);
        if (sets.size > 32) sets.delete(sets.keys().next().value!);
        void request.catch(() => { if (sets.get(name) === request) sets.delete(name); });
      }
      try { return await sets.get(name)!; } catch { return []; }
    }));
    const requested = new Set(ids);
    return batches.flat().filter(card => requested.has(card.id));
  };
}

// The apex website is a separate deployment, not a proxy for every nested
// tracker asset. Its shared viewer must use the existing Trace asset host.
export const resolveSharedCardSources = createSharedCardResolver(fetch,
  sharedCardAssetOrigin(typeof window === 'undefined' ? 'localhost' : window.location.hostname));

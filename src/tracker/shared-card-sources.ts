import type { CardInfo } from './types.js';

const CARD_ID = /^[a-z0-9-]+_\d+(?:_[a-z0-9]+)?$/;

/** Browser equivalent of the native card lookup. Only printed metadata and
 * artwork are fetched, lazily by set; recorded board state is never rebuilt. */
export function createSharedCardResolver(fetcher: typeof fetch = fetch) {
  const sets = new Map<string, Promise<CardInfo[]>>();
  return async (cardIds: string[]): Promise<CardInfo[]> => {
    const ids = [...new Set(cardIds.map(id => id.toLowerCase()).filter(id => CARD_ID.test(id)))];
    const names = [...new Set(ids.map(id => id.split('_')[0]))];
    const batches = await Promise.all(names.map(async name => {
      if (!sets.has(name)) {
        const request = (async () => {
          const response = await fetcher(`/tracker-assets/card-catalog/${name}.json`);
          if (!response.ok) throw new Error('Card set unavailable');
          const cards: unknown = await response.json();
          if (!Array.isArray(cards)) throw new Error('Invalid card set');
          return cards.filter((card): card is CardInfo => typeof card?.id === 'string'
            && card.id.split('_')[0] === name && typeof card.name === 'string');
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

export const resolveSharedCardSources = createSharedCardResolver();

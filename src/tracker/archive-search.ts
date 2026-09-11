import type { CardInfo, MatchSummary } from './types.js';

const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function cardNames(value: unknown, catalog: ReadonlyMap<string, CardInfo>): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(item => cardNames(item, catalog));
  return Object.entries(value).flatMap(([key, item]) => {
    if (key === 'name' && typeof item === 'string') return [item];
    if (key === 'cardId' && typeof item === 'string') return [catalog.get(item)?.name || catalog.get(item.toLowerCase())?.name || ''];
    return cardNames(item, catalog);
  });
}

/** All terms must match; relative dates use the player's local calendar. */
export function searchArchive(matches: MatchSummary[], query: string, now = new Date(), catalog: ReadonlyMap<string, CardInfo> = new Map()): MatchSummary[] {
  const terms = query.trim().split(/\s+/).map(normalize).filter(Boolean);
  if (!terms.length) return matches;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  return matches.filter((match) => {
    const date = new Date(match.importedAt);
    const result = match.recording ? 'recording live' : !match.winner ? 'incomplete' : match.winner === match.localPlayer ? 'win won victory' : 'loss lost defeat';
    const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const fields = [match.localPlayer, match.opponent, result, localDate,
      Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
      ...cardNames(match.finalSnapshot, catalog)].map(normalize);
    return terms.every((term) => {
      if (term === 'today') return date >= today && date < new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      if (term === 'yesterday') return date >= yesterday && date < today;
      return fields.some((field) => field.includes(term));
    });
  });
}

/** Read the lightweight index, never the full replay/operation payloads. */
export async function readArchiveSearchIndex(
  loadPage: (offset: number, limit: number) => Promise<MatchSummary[]>,
  cancelled: () => boolean,
  onPage: (matches: MatchSummary[]) => void,
): Promise<void> {
  for (let offset = 0; !cancelled(); offset += 200) {
    const page = await loadPage(offset, 200);
    if (cancelled()) return;
    onPage(page);
    if (page.length < 200) return;
  }
}

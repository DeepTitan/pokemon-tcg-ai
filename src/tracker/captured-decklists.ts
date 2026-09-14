import type { CapturedDecklist } from './types.js';

/** Only explicit complete match-start inventories, never inferred from zones. */
export function capturedDecklists(operation: unknown): CapturedDecklist[] {
  if (!operation || typeof operation !== 'object' || !Array.isArray((operation as any).players)) return [];
  return (operation as any).players.flatMap((p: any) => {
    const inventory = p?.deckInfo?.cards;
    if (typeof p?.playerName !== 'string' || !p.playerName || typeof p.playerId !== 'string' || !p.playerId
      || !inventory || typeof inventory !== 'object' || Array.isArray(inventory)) return [];
    const entries = Object.entries(inventory);
    if (new Set(entries.map(([id]) => id.toLowerCase())).size !== entries.length) return [];
    if (!entries.length || entries.some(([id, count]) => !/^[a-z0-9_-]+$/i.test(id)
      || !Number.isInteger(count) || (count as number) < 1 || (count as number) > 60)) return [];
    const total = entries.reduce((sum, [, count]) => sum + (count as number), 0);
    if (total !== 60 || (p.deckSize !== undefined && p.deckSize !== total)) return [];
    return [{ playerName: p.playerName, playerId: p.playerId, source: 'match-start' as const,
      total, cards: entries.map(([cardId, count]) => ({ cardId: cardId.toLowerCase(), count: count as number })) }];
  });
}

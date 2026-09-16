import { archiveMatchup } from '../src/tracker/archive-summary-model.js';
import type { CardInfo, MatchSummary, TrackedCard } from '../src/tracker/types.js';
import type { HistorySide, MatchHistoryPreview } from '../src/leaderboard/history.js';

/** Only export thumbnail evidence. Full lists, boards, hands and logs stay local. */
export function projectHistoryPreview(review: Record<string, unknown>, catalog: ReadonlyMap<string, CardInfo>): MatchHistoryPreview | undefined {
  const localPlayer = typeof review.localPlayer === 'string' ? review.localPlayer : '';
  const opponent = typeof review.opponent === 'string' ? review.opponent : '';
  if (!localPlayer || !opponent || localPlayer === opponent) return undefined;
  const turns = Array.isArray(review.turns) ? review.turns : [];
  const snapshot = turns.at(-1)?.snapshot ?? review.finalSnapshot;
  const summary = { ...review, localPlayer, opponent, finalSnapshot: snapshot } as unknown as MatchSummary;
  const matchup = archiveMatchup(summary, catalog);
  const artId = (card: TrackedCard) => {
    const exact = card.cardId ? catalog.get(card.cardId) : undefined;
    if (exact?.imagePath) return exact.id;
    // A thumbnail represents the Pokémon, not the deck's cosmetic printing.
    return [...catalog.values()].filter(info => info.name === card.name && info.imagePath)
      .sort((a, b) => a.id.localeCompare(b.id))[0]?.id;
  };
  const side = (card: TrackedCard | undefined, prizes: number | undefined): HistorySide => ({
    ...(card?.name ? { pokemon: { name: card.name, ...(card.cardId ? { cardId: card.cardId } : {}), ...(artId(card) ? { artCardId: artId(card) } : {}) } } : {}),
    ...(Number.isInteger(prizes) && prizes! >= 0 && prizes! <= 6 ? { prizesTaken: prizes } : {}),
  });
  const duration = review.durationSeconds;
  return { players: { [localPlayer]: side(matchup.localCard, matchup.localPrizesTaken), [opponent]: side(matchup.opponentCard, matchup.opponentPrizesTaken) },
    ...(typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? { durationSeconds: duration } : {}) };
}

/** Merge duplicate capture perspectives by player identity, never by left/right. */
export function mergeHistoryPreviews(previews: MatchHistoryPreview[]): MatchHistoryPreview | undefined {
  if (!previews.length) return undefined;
  const ids = [...new Set(previews.flatMap(p => Object.keys(p.players)))].sort();
  const players = Object.fromEntries(ids.map(id => {
    const sides = previews.flatMap(p => p.players[id] ? [p.players[id]] : []);
    const prizes = [...new Set(sides.flatMap(s => s.prizesTaken === undefined ? [] : [s.prizesTaken]))];
    const pokemon = sides.flatMap(s => s.pokemon ? [s.pokemon] : []).sort((a, b) =>
      Number(Boolean(b.cardId)) - Number(Boolean(a.cardId)) || JSON.stringify(a).localeCompare(JSON.stringify(b)))[0];
    return [id, { ...(pokemon ? { pokemon } : {}), ...(prizes.length === 1 ? { prizesTaken: prizes[0] } : {}) }];
  }));
  const durations = previews.flatMap(p => p.durationSeconds === undefined ? [] : [p.durationSeconds]);
  return { players, ...(durations.length ? { durationSeconds: Math.max(...durations) } : {}) };
}

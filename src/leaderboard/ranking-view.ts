import type { EloLeaderboardRow } from './elo.js';

export type RankingView = 'live' | 'trace';
type LivePlayer = { id: string; latestLiveRating?: number };

export function rankingViewFromSearch(search: string): RankingView {
  return new URLSearchParams(search).get('ranking') === 'trace' ? 'trace' : 'live';
}

/** Live values come from the shared Live feed, never from Trace Elo. */
export function leaderboardRating(row: EloLeaderboardRow, view: RankingView, player?: LivePlayer): number | undefined {
  if (view === 'trace') return row.games > 0 ? row.rating : undefined;
  const rating = player?.latestLiveRating;
  return typeof rating === 'number' && Number.isFinite(rating) && rating >= 0 ? rating : undefined;
}

export function sortLeaderboardRows(rows: readonly EloLeaderboardRow[], players: readonly LivePlayer[], view: RankingView) {
  const profiles = new Map(players.map(player => [player.id, player]));
  return [...rows].sort((a, b) => {
    const first = leaderboardRating(a, view, profiles.get(a.playerId));
    const second = leaderboardRating(b, view, profiles.get(b.playerId));
    return Number(second !== undefined) - Number(first !== undefined)
      || (second ?? 0) - (first ?? 0) || a.name.localeCompare(b.name) || a.playerId.localeCompare(b.playerId);
  });
}

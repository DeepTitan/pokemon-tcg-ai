const environment = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env;
/** The hosted pages share Trace's existing /trace namespace; localhost keeps its URLs. */
export const LEADERBOARD_BASE = environment?.VITE_TRACE_LEADERBOARD_BASE === '/trace' ? '/trace' : '';
export const LEADERBOARD_HREF = LEADERBOARD_BASE ? `${LEADERBOARD_BASE}/leaderboard` : '/leaderboard.html';
export const LEADERBOARD_DATA_HREF = LEADERBOARD_BASE ? `${LEADERBOARD_BASE}/leaderboard-static/events.json` : '/api/leaderboard';
export const LEADERBOARD_ART_HREF = LEADERBOARD_BASE ? `${LEADERBOARD_BASE}/leaderboard-static/card-art` : '/api/leaderboard/card-art';
export const LEADERBOARD_MASCOT_HREF = LEADERBOARD_BASE ? `${LEADERBOARD_BASE}/leaderboard-static/trace-mascot.png` : '/tracker-assets/trace-mascot.png';
export const LEADERBOARD_CARD_BACK_HREF = LEADERBOARD_BASE ? `${LEADERBOARD_BASE}/leaderboard-static/pokemon-card-back.jpg` : '/tracker-assets/pokemon-card-back.jpg';

/** Readable profile links keep player names within one safely encoded segment. */
export function playerProfileHref(name: string): string {
  return `${LEADERBOARD_BASE}/players/${encodeURIComponent(name)}`;
}

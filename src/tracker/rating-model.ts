import type { MatchReview, MatchSummary } from './types.js';

const COMPETITIVE_ELO_K_FACTOR = 25;

export interface CompetitiveRatingResult {
  change: number;
  ratingAfter: number;
}

/**
 * TCG Live applies a 25-point Elo step and rounds the signed result down.
 * The behavior is verified against consecutive production match snapshots.
 */
export function competitiveRatingResult(
  localRating: number,
  opponentRating: number,
  localWon: boolean,
): CompetitiveRatingResult | undefined {
  if (![localRating, opponentRating].every(Number.isFinite)) return undefined;
  const expectedScore = 1 / (1 + 10 ** ((opponentRating - localRating) / 400));
  const actualScore = localWon ? 1 : 0;
  const change = Math.floor(COMPETITIVE_ELO_K_FACTOR * (actualScore - expectedScore));
  return { change, ratingAfter: localRating + change };
}

export function ratingFieldsForReview(
  review: Pick<MatchReview, 'winner' | 'localPlayer' | 'localRating' | 'opponentRating'>,
): Pick<MatchSummary, 'localRating' | 'opponentRating' | 'ratingChange' | 'ratingAfter'> {
  const localRating = review.localRating;
  const opponentRating = review.opponentRating;
  const result = review.winner && localRating != null && opponentRating != null
    ? competitiveRatingResult(localRating, opponentRating, review.winner === review.localPlayer)
    : undefined;
  return {
    localRating,
    opponentRating,
    ratingChange: result?.change,
    ratingAfter: result?.ratingAfter,
  };
}

export function formatSignedRatingChange(change: number): string {
  if (!Number.isFinite(change)) return '—';
  return `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}`;
}

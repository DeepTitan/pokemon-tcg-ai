import type { MatchReview, TrackedTurn } from './types.js';

export type KeyMomentReason = 'attack' | 'damage' | 'knockout' | 'prize' | 'game-over';

export interface KeyMoment {
  reviewIndex: number;
  reasons: KeyMomentReason[];
}

const LEGACY_ATTACK = /^(?:attacked with\b|attack resolved\b)/i;
const KNOCKOUT_TEXT = /\bknocked out\b/i;
const PRIZE_TEXT = /\btook\s+\d+\s+prize cards?\b/i;
const GAME_OVER_TEXT = /\b(?:game over|won by|conced(?:e|ed|ing))\b/i;

/**
 * Classify the frames that belong in the replay highlight reel. Structured
 * event kinds are authoritative; text fallbacks keep older saved reviews and
 * imported battle logs navigable without rebuilding them.
 */
export function keyMomentReasons(turn: TrackedTurn): KeyMomentReason[] {
  const kinds = new Set(turn.events.map((event) => event.kind));
  const eventText = turn.events.map((event) => event.text).join(' | ');
  const reasons: KeyMomentReason[] = [];

  if (kinds.has('attack') || LEGACY_ATTACK.test(turn.choiceLabel?.trim() || '')) reasons.push('attack');
  if (kinds.has('damage')) reasons.push('damage');
  if (kinds.has('knockout') || KNOCKOUT_TEXT.test(eventText)) reasons.push('knockout');
  if (kinds.has('prize') || PRIZE_TEXT.test(eventText)) reasons.push('prize');
  if (turn.snapshot.winner || GAME_OVER_TEXT.test(eventText)) reasons.push('game-over');

  return reasons;
}

/** One chronological stop per meaningful frame, even when an attack also KOs
 * a Pokémon, awards Prize cards, and ends the game. */
export function buildKeyMoments(review: MatchReview | null): KeyMoment[] {
  if (!review?.turns.length) return [];
  return review.turns.flatMap((turn, reviewIndex) => {
    const reasons = keyMomentReasons(turn);
    return reasons.length ? [{ reviewIndex, reasons }] : [];
  });
}

/**
 * Move only in the requested direction. At either edge, stay on the current
 * frame instead of unexpectedly jumping backward or forward.
 */
export function stepKeyMoment(
  moments: readonly KeyMoment[],
  current: number,
  direction: -1 | 1,
): number {
  if (direction < 0) {
    return [...moments].reverse().find((moment) => moment.reviewIndex < current)?.reviewIndex ?? current;
  }
  return moments.find((moment) => moment.reviewIndex > current)?.reviewIndex ?? current;
}

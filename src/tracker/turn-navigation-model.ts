import type { MatchReview, TrackedTurn } from './types.js';

function isAttackFrame(turn: TrackedTurn): boolean {
  return turn.events.some((event) => event.kind === 'attack')
    || /^(?:attacked with\b|attack resolved\b)/i.test(turn.choiceLabel?.trim() || '');
}

/**
 * Replay stops for coarse navigation: every frame where an attack was used.
 * The choice-label fallback keeps navigation working for older saved reviews
 * that predate structured attack events.
 */
export function buildAttackStops(review: MatchReview | null): number[] {
  if (!review?.turns.length) return [];
  return review.turns.flatMap((turn, index) => isAttackFrame(turn) ? [index] : []);
}

export function stepAttack(stops: readonly number[], current: number, direction: -1 | 1): number {
  if (!stops.length) return current;
  if (direction < 0) {
    return [...stops].reverse().find((stop) => stop < current) ?? stops[0];
  }
  return stops.find((stop) => stop > current) ?? stops[stops.length - 1];
}

import type { MatchReview, TrackedTurn } from './types.js';

function activePlayer(turn: TrackedTurn): string | undefined {
  const canonical = turn.canonical;
  const currentPlayer = canonical?.state.currentPlayer;
  if (canonical && (currentPlayer === 0 || currentPlayer === 1)) {
    return canonical.playerNames[currentPlayer];
  }
  return turn.player;
}

/**
 * Replay stops for coarse navigation: the first frame controlled by each
 * player, followed by the final captured action even when it is mid-turn.
 */
export function buildPlayerTurnStops(review: MatchReview | null): number[] {
  if (!review?.turns.length) return [];
  if (review.turns.length === 1) return [0];

  const stops: number[] = [];
  let previousPlayer: string | undefined;

  // Frame zero is a capture/setup baseline, not a playable player turn.
  for (let index = 1; index < review.turns.length; index += 1) {
    const player = activePlayer(review.turns[index]);
    if (!player) continue;
    if (player !== previousPlayer) {
      stops.push(index);
      previousPlayer = player;
    }
  }

  const finalIndex = review.turns.length - 1;
  if (!stops.length) stops.push(Math.min(1, finalIndex));
  if (stops[stops.length - 1] !== finalIndex) stops.push(finalIndex);
  return stops;
}

export function stepPlayerTurn(stops: readonly number[], current: number, direction: -1 | 1): number {
  if (!stops.length) return current;
  if (direction < 0) {
    return [...stops].reverse().find((stop) => stop < current) ?? stops[0];
  }
  return stops.find((stop) => stop > current) ?? stops[stops.length - 1];
}

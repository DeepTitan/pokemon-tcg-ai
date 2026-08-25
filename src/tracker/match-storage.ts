import type { CapturedOperation, MatchReview, MatchSummary } from './types.js';

export const REDUCER_VERSION = 6;

export function matchSummaryFromReview(review: MatchReview, operationCount = 0): MatchSummary {
  return {
    id: review.id,
    importedAt: review.importedAt,
    source: review.source,
    localPlayer: review.localPlayer,
    opponent: review.opponent,
    winner: review.winner,
    turnCount: review.turns.length,
    operationCount,
    reducerVersion: REDUCER_VERSION,
    finalSnapshot: [...review.turns].reverse().find((turn) => turn.snapshot)?.snapshot,
    recording: review.source === 'live-network' && !review.winner,
  };
}

export function recordingSummaryFromOperation(operation: CapturedOperation, operationCount: number): MatchSummary {
  return {
    id: `live-${operation.matchId || operation.gameId}`,
    importedAt: capturedAtIso(operation.receivedAt),
    source: 'live-network',
    localPlayer: 'You',
    opponent: 'Live game',
    turnCount: 0,
    operationCount,
    reducerVersion: 0,
    recording: true,
  };
}

export function collectCardSourceIds(candidate: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(candidate)) {
    candidate.forEach((item) => collectCardSourceIds(item, found));
  } else if (candidate && typeof candidate === 'object') {
    for (const [key, item] of Object.entries(candidate)) {
      const normalizedKey = key.toLowerCase();
      if (
        (normalizedKey === 'cardsourceid' || normalizedKey === 'reviewsourceid' || normalizedKey === 'cardid')
        && typeof item === 'string'
        && item
      ) found.add(item.toLowerCase());
      collectCardSourceIds(item, found);
    }
  }
  return found;
}

export function operationKey(operation: CapturedOperation): string {
  return [
    operation.matchId || operation.gameId,
    operation.messageIndex ?? 'no-index',
    operation.receivedAt,
    operation.globalMessageType,
    operation.operationId || 'no-operation',
  ].join(':');
}

export function capturedAtIso(value: string): string {
  const unixSeconds = Number(value.replace(/Z$/, ''));
  if (Number.isFinite(unixSeconds) && unixSeconds > 0) return new Date(unixSeconds * 1_000).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

import type { LiveEloEvent } from './elo.js';

export interface HistorySide {
  pokemon?: { name: string; cardId?: string; artCardId?: string };
  prizesTaken?: number;
}
export interface MatchHistoryPreview {
  players: Record<string, HistorySide>;
  durationSeconds?: number;
}
export type HistoryMatch = LiveEloEvent & { history?: MatchHistoryPreview };

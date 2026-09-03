export type OpponentHandSlotState = 'hidden' | 'empty';

export const OPPONENT_HAND_FAN_MAX = 10;

export function opponentHandFanSlots(count: number): OpponentHandSlotState[] {
  const normalized = Math.max(0, Math.trunc(count));
  if (normalized === 0) return ['empty'];
  return Array.from({ length: Math.min(normalized, OPPONENT_HAND_FAN_MAX) }, () => 'hidden');
}

export type PrizeSlotState = 'remaining' | 'taken';

export const PRIZE_SLOT_COUNT = 6;

export function prizeSlotStates(count: number): PrizeSlotState[] {
  const remaining = Math.max(0, Math.min(PRIZE_SLOT_COUNT, Math.trunc(count)));
  return Array.from({ length: PRIZE_SLOT_COUNT }, (_, index) => index < remaining ? 'remaining' : 'taken');
}

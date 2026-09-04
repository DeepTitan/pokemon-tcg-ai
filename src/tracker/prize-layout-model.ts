export type PrizeSlotState = 'remaining';

export const PRIZE_SLOT_COUNT = 6;

export function prizeSlotStates(count: number): PrizeSlotState[] {
  const remaining = Math.max(0, Math.min(PRIZE_SLOT_COUNT, Math.trunc(count)));
  return Array.from({ length: remaining }, () => 'remaining');
}

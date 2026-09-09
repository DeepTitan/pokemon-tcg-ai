export type BoardZoomAction = 'in' | 'out' | 'reset';
export const MIN_BOARD_ZOOM = 0.5;
export const MAX_BOARD_ZOOM = 2.5;

export interface BoardPanStart { x: number; y: number; left: number; top: number }

export function boardPanPosition(start: BoardPanStart, x: number, y: number, maxLeft: number, maxTop: number, dragging = false): { left: number; top: number } | null {
  // A small mouse wobble must remain a normal card click.
  if (!dragging && Math.hypot(x - start.x, y - start.y) < 5) return null;
  return {
    left: Math.max(0, Math.min(maxLeft, start.left - (x - start.x))),
    top: Math.max(0, Math.min(maxTop, start.top - (y - start.y))),
  };
}

export function boardZoomShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>): BoardZoomAction | null {
  if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.isComposing) return null;
  if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return 'in';
  if (event.key === '-' || event.code === 'NumpadSubtract') return 'out';
  if (event.key === '0' || event.code === 'Numpad0') return 'reset';
  return null;
}

export function nextBoardZoom(current: number, action: BoardZoomAction): number {
  if (action === 'reset') return 1;
  return Math.min(MAX_BOARD_ZOOM, Math.max(MIN_BOARD_ZOOM, Math.round((current + (action === 'in' ? 0.1 : -0.1)) * 10) / 10));
}

// Keep the same point under the center of the board view, including when the
// smaller-than-fit board was centered with padding rather than scroll offsets.
export function boardZoomScroll(offset: number, viewport: number, previous: number, next: number): number {
  const padding = Math.max(0, viewport * (1 - previous) / 2);
  return Math.max(0, (offset + viewport / 2 - padding) / previous * next - viewport / 2);
}

import { stepKeyMoment, type KeyMoment } from './key-moment-navigation.js';

export type ReplayShortcut = 'first' | 'latest' | 'previous' | 'next' | 'previous-moment' | 'next-moment';
type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey' | 'isComposing' | 'defaultPrevented'>;

/** One keyboard contract shared by the desktop and browser replay. */
export function replayShortcut(event: ShortcutEvent): ReplayShortcut | null {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'arrowleft' || key === 'a') return event.shiftKey ? 'first' : 'previous';
  if (key === 'arrowright' || key === 'd') return event.shiftKey ? 'latest' : 'next';
  if (key === 'arrowup' || key === 'w') return 'previous-moment';
  if (key === 'arrowdown' || key === 's') return 'next-moment';
  return null;
}

export function replayShortcutFrame(action: ReplayShortcut, current: number, frameCount: number, moments: readonly KeyMoment[]): number {
  const last = Math.max(0, frameCount - 1);
  if (action === 'first') return 0;
  if (action === 'latest') return last;
  if (action === 'previous') return Math.max(0, current - 1);
  if (action === 'next') return Math.min(last, current + 1);
  return stepKeyMoment(moments, current, action === 'previous-moment' ? -1 : 1);
}

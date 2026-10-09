export const FRAME_ANIMATIONS_STORAGE_KEY = 'trace/replay-frame-animations-v1';

export type FrameNavigationRequest = number | ((current: number) => number);
export type FrameNavigationMode = 'animate' | 'scrub' | 'instant';

export function frameAnimationsFromStoredPreference(value: string | null): boolean {
  return value !== 'off';
}

export function resolveFrameNavigationTarget(current: number, request: FrameNavigationRequest, last: number): number {
  const requested = typeof request === 'function' ? request(current) : request;
  return Math.max(0, Math.min(Math.max(0, last), requested));
}

export function frameNavigationMode(animationsEnabled: boolean, prefersReducedMotion: boolean, transitionActive: boolean, alreadyScrubbing: boolean, context?: { compact: boolean; playback: boolean }): FrameNavigationMode {
  if (!animationsEnabled || prefersReducedMotion || (context?.compact && !context.playback)) return 'instant';
  if (transitionActive || alreadyScrubbing) return 'scrub';
  return 'animate';
}

export const MOBILE_PLAYBACK_RATES = [0.75, 1, 1.5, 2] as const;

export function replayFrameDelay(attack: boolean, pass: boolean, compact: boolean, rate = 1): number {
  const duration = compact ? attack ? 1200 : pass ? 900 : 600 : attack ? 2600 : pass ? 1900 : 1200;
  return duration / (compact && MOBILE_PLAYBACK_RATES.includes(rate as typeof MOBILE_PLAYBACK_RATES[number]) ? rate : 1);
}

export function frameCardTransitionName(id: string): string {
  const readable = id.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'card';
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `trace-card-${readable}-${(hash >>> 0).toString(36)}`;
}

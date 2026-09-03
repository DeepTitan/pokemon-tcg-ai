export const FRAME_ANIMATIONS_STORAGE_KEY = 'trace/replay-frame-animations-v1';

export type FrameNavigationRequest = number | ((current: number) => number);

export function frameAnimationsFromStoredPreference(value: string | null): boolean {
  return value !== 'off';
}

export function resolveFrameNavigationTarget(current: number, request: FrameNavigationRequest, last: number): number {
  const requested = typeof request === 'function' ? request(current) : request;
  return Math.max(0, Math.min(Math.max(0, last), requested));
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

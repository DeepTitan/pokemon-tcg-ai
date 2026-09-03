export const FRAME_ANIMATIONS_STORAGE_KEY = 'trace/replay-frame-animations-v1';

export function frameAnimationsFromStoredPreference(value: string | null): boolean {
  return value !== 'off';
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

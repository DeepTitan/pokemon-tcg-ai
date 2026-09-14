export const SHARED_ACCESS_KEY = 'trace/shared-access-open-v1';
export const TRACE_DISCORD_URL = 'https://discord.gg/bxKJGB9dSY';

export function readSharedAccessOpen(storage: Pick<Storage, 'getItem'>, viewportWidth: number): boolean {
  try {
    const preference = storage.getItem(SHARED_ACCESS_KEY);
    if (preference === 'true' || preference === 'false') return preference === 'true';
  } catch { /* The invitation works without browser storage. */ }
  return viewportWidth >= 1180;
}

export function storeSharedAccessOpen(storage: Pick<Storage, 'setItem'>, open: boolean): void {
  try { storage.setItem(SHARED_ACCESS_KEY, String(open)); }
  catch { /* Keep the current session usable when storage is unavailable. */ }
}

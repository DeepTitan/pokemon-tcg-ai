import type { MatchReview } from './types.js';

const DEFAULT_TRACE_API_URL = 'https://p5xbv2rfya.execute-api.us-east-1.amazonaws.com';
const SHARE_PATH = /^\/trace\/([A-Za-z0-9_-]{20,64})\/?$/;
export const SHARE_LINKS_STORAGE_KEY = 'trace/share-links-v1';

interface ShareLinkStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SharedReplayPayload {
  review: MatchReview;
  reducerVersion: number;
  updatedAt?: string;
}

export function sharedReplayIdFromPath(pathname: string): string | null {
  return SHARE_PATH.exec(pathname)?.[1] || null;
}

function isTraceShareUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://victoryroad.app' && sharedReplayIdFromPath(url.pathname) != null;
  } catch {
    return false;
  }
}

export function readStoredShareLinks(storage: ShareLinkStorage): Record<string, string> {
  try {
    const value = JSON.parse(storage.getItem(SHARE_LINKS_STORAGE_KEY) || '{}') as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([matchId, url]) => matchId.trim().length > 0 && isTraceShareUrl(url)),
    );
  } catch {
    return {};
  }
}

export function storeShareLink(
  storage: ShareLinkStorage,
  links: Readonly<Record<string, string>>,
  matchId: string,
  url: string,
): Record<string, string> {
  if (!matchId.trim() || !isTraceShareUrl(url)) return { ...links };
  const next = { ...links, [matchId]: url };
  try {
    storage.setItem(SHARE_LINKS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Sharing still works when the webview storage is unavailable; only the
    // instant local lookup is lost and the server remains the source of truth.
  }
  return next;
}

export async function loadSharedReplay(shareId: string): Promise<SharedReplayPayload> {
  const configured = import.meta.env.VITE_TRACE_SYNC_API_URL?.trim();
  const endpoint = (configured || DEFAULT_TRACE_API_URL).replace(/\/$/, '');
  const response = await fetch(`${endpoint}/v1/shares/${encodeURIComponent(shareId)}`, {
    cache: 'no-store',
  });
  if (response.status === 404) throw new Error('This shared match could not be found.');
  if (!response.ok) throw new Error('This shared match is temporarily unavailable.');
  const payload = await response.json() as Partial<SharedReplayPayload>;
  if (!payload.review || !Array.isArray(payload.review.turns)) {
    throw new Error('This shared match is incomplete.');
  }
  return payload as SharedReplayPayload;
}

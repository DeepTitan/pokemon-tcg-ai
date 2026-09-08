import type { MatchReview } from './types.js';

const DEFAULT_TRACE_API_URL = 'https://p5xbv2rfya.execute-api.us-east-1.amazonaws.com';
const SHARE_PATH = /^\/trace\/([A-Za-z0-9_-]{20,64})\/?$/;

export interface SharedReplayPayload {
  review: MatchReview;
  reducerVersion: number;
  updatedAt?: string;
}

export function sharedReplayIdFromPath(pathname: string): string | null {
  return SHARE_PATH.exec(pathname)?.[1] || null;
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

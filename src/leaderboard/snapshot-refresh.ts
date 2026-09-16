import type { RatingPlayerSeed } from './rating.js';
import type { HistoryMatch } from './history.js';
import { validateLiveScaleCalibrations, type LiveScaleCalibration } from './live-scale.js';

export type SnapshotPlayer = RatingPlayerSeed & {
  latestLiveRating?: number;
  liveRatingObservedAt?: string;
  liveRatingTiming?: 'pre-match' | 'post-match' | 'match-snapshot';
  liveRatingBefore?: number;
  liveRatingChange?: number;
  traceStatus?: 'trace-user' | 'opponent-only';
};
export interface LeaderboardSnapshot {
  schema: 'trace-leaderboard/v1';
  generatedAt: string;
  sourceLabel: string;
  revision?: string;
  players: SnapshotPlayer[];
  matches: HistoryMatch[];
  liveScaleCalibrations?: LiveScaleCalibration[];
}
export interface SnapshotRefreshStatus {
  checking: boolean;
  lastCheckedAt: number | null;
  failed: boolean;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const optionalText = (value: Record<string, unknown>, keys: string[]) => keys.every(key => value[key] === undefined || text(value[key]));

/** Check the display contract. Match eligibility is still decided by the rating engine. */
export function isLeaderboardSnapshot(value: unknown): value is LeaderboardSnapshot {
  if (!record(value) || value.schema !== 'trace-leaderboard/v1' || !text(value.generatedAt)
    || !Number.isFinite(Date.parse(value.generatedAt)) || !text(value.sourceLabel)
    || !Array.isArray(value.players) || !Array.isArray(value.matches)) return false;
  if (!value.players.every(player => record(player) && text(player.id) && text(player.name)
    && ['latestLiveRating', 'liveRatingBefore', 'liveRatingChange'].every(key => player[key] === undefined || finite(player[key]))
    && (player.liveRatingObservedAt === undefined || text(player.liveRatingObservedAt)))) return false;
  if (!value.matches.every(match => {
    if (!record(match) || !text(match.id) || !text(match.playedAt) || typeof match.confirmed !== 'boolean'
      || !Array.isArray(match.playerIds) || !match.playerIds.every(text) || !record(match.outcome)
      || !['win', 'draw'].includes(String(match.outcome.type))) return false;
    if (match.liveRatings !== undefined && (!record(match.liveRatings) || !Object.values(match.liveRatings).every(finite))) return false;
    if (match.history !== undefined) {
      if (!record(match.history) || !record(match.history.players)) return false;
      if (!Object.values(match.history.players).every(side => record(side)
        && (side.prizesTaken === undefined || finite(side.prizesTaken))
        && (side.pokemon === undefined || record(side.pokemon) && text(side.pokemon.name)
          && optionalText(side.pokemon, ['cardId', 'artCardId'])))) return false;
    }
    return true;
  })) return false;
  if (value.liveScaleCalibrations !== undefined) {
    if (!Array.isArray(value.liveScaleCalibrations)) return false;
    try { validateLiveScaleCalibrations(value.liveScaleCalibrations); } catch { return false; }
  }
  return value.revision === undefined || text(value.revision);
}

export interface SnapshotRefreshRuntime {
  fetch: typeof fetch;
  now(): number;
  visible(): boolean;
  schedule(callback: () => void, milliseconds: number): number;
  cancel(timer: number): void;
  subscribe(callback: () => void): () => void;
}

function browserRuntime(): SnapshotRefreshRuntime {
  return {
    fetch: window.fetch.bind(window), now: Date.now,
    visible: () => document.visibilityState !== 'hidden',
    schedule: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
    cancel: timer => window.clearTimeout(timer),
    subscribe(callback) {
      document.addEventListener('visibilitychange', callback);
      window.addEventListener('focus', callback);
      window.addEventListener('online', callback);
      return () => {
        document.removeEventListener('visibilitychange', callback);
        window.removeEventListener('focus', callback);
        window.removeEventListener('online', callback);
      };
    },
  };
}

/** Refresh only data: the caller owns search, pagination, profile and popup state. */
export function startSnapshotRefresh(options: {
  url: string;
  onSnapshot(snapshot: LeaderboardSnapshot): void;
  onStatus(status: SnapshotRefreshStatus): void;
  runtime?: SnapshotRefreshRuntime;
}) {
  const runtime = options.runtime ?? browserRuntime();
  let stopped = false;
  let inFlight: AbortController | null = null;
  let timer: number | undefined;
  let timeout: number | undefined;
  let etag: string | null = null;
  let revision: string | undefined;
  let fingerprint: string | undefined;
  let status: SnapshotRefreshStatus = { checking: false, lastCheckedAt: null, failed: false };
  const setStatus = (next: SnapshotRefreshStatus) => { status = next; if (!stopped) options.onStatus(next); };
  const cancelPoll = () => { if (timer !== undefined) runtime.cancel(timer); timer = undefined; };

  async function refresh() {
    if (stopped || !runtime.visible() || inFlight) return;
    cancelPoll();
    const controller = new AbortController();
    const startedAt = runtime.now();
    inFlight = controller;
    setStatus({ ...status, checking: true });
    timeout = runtime.schedule(() => controller.abort(), 10_000);
    try {
      const response = await runtime.fetch(options.url, {
        signal: controller.signal, cache: 'no-store',
        headers: etag ? { 'If-None-Match': etag } : undefined,
      });
      if (stopped) return;
      if (controller.signal.aborted) throw new Error('The refresh timed out.');
      const nextEtag = response.headers.get('etag');
      if (response.status === 304) {
        if (fingerprint === undefined) throw new Error('A full snapshot is required.');
      } else {
        if (!response.ok) throw new Error('Could not refresh matches.');
        if (!nextEtag || nextEtag !== etag || fingerprint === undefined) {
          const data: unknown = await response.json();
          if (stopped) return;
          if (controller.signal.aborted) throw new Error('The refresh timed out.');
          if (!isLeaderboardSnapshot(data)) throw new Error('Invalid leaderboard snapshot.');
          // Build timestamps alone do not require replaying every player's rating.
          const nextFingerprint = JSON.stringify([data.schema, data.sourceLabel, data.players, data.matches, data.liveScaleCalibrations]);
          if (!(data.revision && data.revision === revision)) {
            if (nextFingerprint !== fingerprint) options.onSnapshot(data);
            fingerprint = nextFingerprint;
            revision = data.revision;
          }
        }
        etag = nextEtag;
      }
      setStatus({ checking: false, failed: false, lastCheckedAt: runtime.now() });
    } catch {
      if (!stopped) setStatus({ ...status, checking: false, failed: true });
    } finally {
      if (timeout !== undefined) runtime.cancel(timeout);
      timeout = undefined;
      inFlight = null;
      if (!stopped && runtime.visible()) timer = runtime.schedule(() => void refresh(), Math.max(0, 15_000 - (runtime.now() - startedAt)));
    }
  }

  const unsubscribe = runtime.subscribe(() => {
    cancelPoll();
    if (runtime.visible()) void refresh();
  });
  void refresh();
  return () => {
    stopped = true;
    cancelPoll();
    if (timeout !== undefined) runtime.cancel(timeout);
    inFlight?.abort();
    unsubscribe();
  };
}

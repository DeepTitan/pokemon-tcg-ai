import type {
  CapturedOperation, CaptureStatus, CardInfo, MatchReview, MatchSummary, StorageStatus, TrackerEnvironment,
} from './types.js';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauri(): boolean {
  return Boolean(window.__TAURI_INTERNALS__);
}

export async function getTrackerEnvironment(): Promise<TrackerEnvironment> {
  if (!isTauri()) {
    return {
      clientInstalled: false,
      clientRunning: false,
      pid: null,
      captureMode: 'existing-client',
      capture: {
        permissionReady: false,
        enabled: false,
        observerRunning: false,
        routeActive: false,
        clientAttached: false,
        frameCount: 0,
        operationCount: 0,
        lastError: null,
        observerPort: 8899,
      },
    };
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<TrackerEnvironment>('tracker_environment');
}

export async function requestCapturePermission(): Promise<CaptureStatus> {
  if (!isTauri()) throw new Error('Capture setup is only available in the native app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<CaptureStatus>('request_capture_permission');
}

export async function startTracking(): Promise<CaptureStatus> {
  if (!isTauri()) throw new Error('Live capture is only available in the native app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<CaptureStatus>('start_tracking');
}

export async function stopTracking(): Promise<CaptureStatus> {
  if (!isTauri()) throw new Error('Live capture is only available in the native app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<CaptureStatus>('stop_tracking');
}

export async function onMatchOperation(
  handler: (operation: CapturedOperation) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<CapturedOperation>('match-operation', (event) => handler(event.payload));
}

export async function getRecentMatchOperations(): Promise<CapturedOperation[]> {
  if (!isTauri()) {
    try {
      const response = await fetch('/api/turnlume/recent-operations', { cache: 'no-store' });
      return response.ok ? await response.json() as CapturedOperation[] : [];
    } catch {
      return [];
    }
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<CapturedOperation[]>('recent_match_operations');
}

export async function resolveCardSources(cardIds: string[]): Promise<CardInfo[]> {
  if (cardIds.length === 0) return [];
  if (!isTauri()) {
    try {
      const response = await fetch('/api/turnlume/card-sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cardIds }),
      });
      return response.ok ? await response.json() as CardInfo[] : [];
    } catch {
      return [];
    }
  }
  const { convertFileSrc, invoke } = await import('@tauri-apps/api/core');
  const cards = await invoke<CardInfo[]>('resolve_card_sources', { cardIds });
  return cards.map((card) => ({
    ...card,
    imageDataUrl: card.imageDataUrl || (card.imagePath ? convertFileSrc(card.imagePath) : undefined),
  }));
}

export async function initializeTrackerStorage(): Promise<StorageStatus> {
  if (!isTauri()) return { rawOperations: 0, rawMatches: 0, derivedMatches: 0, pendingMatches: 0, archivedMatches: 0, importedLegacyOperations: 0 };
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<StorageStatus>('initialize_tracker_storage');
}

export async function listMatchSummaries(offset = 0, limit = 50): Promise<MatchSummary[]> {
  if (!isTauri()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<MatchSummary[]>('list_match_summaries', { offset, limit });
}

export async function loadMatchReview(matchId: string): Promise<MatchReview | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<MatchReview | null>('load_match_review', { matchId });
}

export async function persistMatchReview(review: MatchReview, reducerVersion: number): Promise<MatchSummary> {
  if (!isTauri()) throw new Error('Persistent match storage is only available in the native app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<MatchSummary>('persist_match_review', { review, reducerVersion });
}

export async function loadMatchOperations(matchId: string): Promise<CapturedOperation[]> {
  if (!isTauri()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<CapturedOperation[]>('load_match_operations', { matchId });
}

export async function listRawMatchIds(pendingOnly: boolean, limit = 5_000, reducerVersion = 0): Promise<string[]> {
  if (!isTauri()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string[]>('list_raw_match_ids', { pendingOnly, reducerVersion, limit });
}

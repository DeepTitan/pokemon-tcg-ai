import type { TrackerEnvironment } from './types.js';

export type CaptureIndicatorTone = 'paused' | 'ready' | 'waiting' | 'connecting' | 'live' | 'error';

export interface CaptureIndicator {
  label: 'Paused' | 'Ready' | 'Waiting' | 'Connecting' | 'Live' | 'Attention';
  tone: CaptureIndicatorTone;
}

export function captureIndicator(environment: TrackerEnvironment): CaptureIndicator {
  const { capture } = environment;
  if (!capture.enabled) return { label: 'Paused', tone: 'paused' };
  if (capture.lastError?.startsWith('Membership was unavailable')) return { label: 'Attention', tone: 'error' };
  if (capture.waitingForMatchEnd) return { label: 'Waiting', tone: 'waiting' };
  if (capture.clientAttached) return { label: 'Live', tone: 'live' };
  if (capture.lastError) return { label: 'Attention', tone: 'error' };
  if (environment.clientRunning) return { label: 'Connecting', tone: 'connecting' };
  return { label: 'Ready', tone: 'ready' };
}

export function visibleCaptureError(environment: TrackerEnvironment): string | null {
  if (environment.capture.lastError?.startsWith('Membership was unavailable')) return environment.capture.lastError;
  return environment.capture.clientAttached || environment.capture.waitingForMatchEnd
    ? null
    : environment.capture.lastError;
}

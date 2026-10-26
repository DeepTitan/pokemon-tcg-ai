import type { TrackerEnvironment } from './types.js';

export type CaptureIndicatorTone = 'paused' | 'ready' | 'waiting' | 'connecting' | 'live' | 'error';

export interface CaptureIndicator {
  label: 'Paused' | 'Ready' | 'Waiting' | 'Connecting' | 'Live' | 'Attention';
  tone: CaptureIndicatorTone;
}

function hasLiveCapture(environment: TrackerEnvironment): boolean {
  const { capture } = environment;
  return environment.clientRunning && capture.enabled && capture.observerRunning
    && capture.routeActive && capture.clientAttached;
}

export function captureIndicator(environment: TrackerEnvironment): CaptureIndicator {
  const { capture } = environment;
  if (!capture.enabled) return { label: 'Paused', tone: 'paused' };
  if (capture.waitingForMatchEnd) return { label: 'Waiting', tone: 'waiting' };
  if (hasLiveCapture(environment)) return { label: 'Live', tone: 'live' };
  if (capture.lastError) return { label: 'Attention', tone: 'error' };
  if (environment.clientRunning) return { label: 'Connecting', tone: 'connecting' };
  return { label: 'Ready', tone: 'ready' };
}

export function visibleCaptureError(environment: TrackerEnvironment): string | null {
  return hasLiveCapture(environment) || environment.capture.waitingForMatchEnd
    ? null
    : environment.capture.lastError;
}

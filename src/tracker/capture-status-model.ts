import type { TrackerEnvironment } from './types.js';

export type CaptureIndicatorTone = 'paused' | 'ready' | 'connecting' | 'live' | 'error';

export interface CaptureIndicator {
  label: 'Paused' | 'Ready' | 'Connecting' | 'Live' | 'Attention';
  tone: CaptureIndicatorTone;
}

export function captureIndicator(environment: TrackerEnvironment): CaptureIndicator {
  const { capture } = environment;
  if (!capture.enabled) return { label: 'Paused', tone: 'paused' };
  if (capture.lastError) return { label: 'Attention', tone: 'error' };
  if (capture.clientAttached) return { label: 'Live', tone: 'live' };
  if (environment.clientRunning) return { label: 'Connecting', tone: 'connecting' };
  return { label: 'Ready', tone: 'ready' };
}

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
  if (!capture.observerRunning || !capture.routeActive) return { label: 'Connecting', tone: 'connecting' };
  if (environment.clientRunning) return { label: 'Connecting', tone: 'connecting' };
  return { label: 'Ready', tone: 'ready' };
}

export function visibleCaptureError(environment: TrackerEnvironment): string | null {
  return !environment.capture.permissionReady || hasLiveCapture(environment) || environment.capture.waitingForMatchEnd
    ? null
    : environment.capture.lastError;
}

export function recordingProblemMessage(error: string): string {
  if (/startup|sign-in|login|launchagent|schtasks/i.test(error)) {
    return 'Trace couldn’t turn on automatic startup. Open Settings to try again.';
  }
  if (/before quitting Trace/i.test(error)) {
    return 'Finish your game before quitting Trace. You can close this window and keep recording.';
  }
  return 'Recording needs attention. Open Settings to reconnect Trace.';
}

export function recordingNotice(environment: TrackerEnvironment, setupOpen: boolean, backgroundError: string | null, captureError: string | null): string | null {
  // Setup owns its progress and failures. Do not put a second error over it,
  // or treat missing first-install permission as a recording failure.
  if (setupOpen || !environment.capture.permissionReady) return null;
  const error = backgroundError || captureError;
  return error ? recordingProblemMessage(error) : null;
}

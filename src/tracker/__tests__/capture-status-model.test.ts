import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureIndicator, visibleCaptureError } from '../capture-status-model.js';
import type { TrackerEnvironment } from '../types.js';

function environment(overrides: Partial<TrackerEnvironment['capture']> = {}, clientRunning = true): TrackerEnvironment {
  return {
    clientInstalled: clientRunning,
    clientRunning,
    pid: clientRunning ? 42 : null,
    captureMode: 'existing-client',
    capture: {
      permissionReady: true,
      enabled: true,
      observerRunning: true,
      routeActive: true,
      clientAttached: false,
      waitingForMatchEnd: false,
      matchInProgress: false,
      frameCount: 0,
      operationCount: 0,
      lastError: null,
      observerPort: 8899,
      ...overrides,
    },
  };
}

assert.deepEqual(captureIndicator(environment({ enabled: false })), { label: 'Paused', tone: 'paused' });
assert.deepEqual(captureIndicator(environment({}, false)), { label: 'Ready', tone: 'ready' });
assert.deepEqual(captureIndicator(environment({ waitingForMatchEnd: true, matchInProgress: true, lastError: 'stale route warning' })), { label: 'Waiting', tone: 'waiting' });
assert.equal(visibleCaptureError(environment({ waitingForMatchEnd: true, matchInProgress: true, lastError: 'stale route warning' })), null);
assert.deepEqual(captureIndicator(environment()), { label: 'Connecting', tone: 'connecting' });
assert.deepEqual(captureIndicator(environment({ clientAttached: true })), { label: 'Live', tone: 'live' });
assert.deepEqual(captureIndicator(environment({ lastError: 'route failed' })), { label: 'Attention', tone: 'error' });
const healthyCaptureWithAuxiliaryFailure = environment({
  clientAttached: true,
  lastError: 'TCG Live rejected the local capture certificate: received fatal alert: CertificateUnknown',
});
assert.deepEqual(captureIndicator(healthyCaptureWithAuxiliaryFailure), { label: 'Live', tone: 'live' });
assert.equal(visibleCaptureError(healthyCaptureWithAuxiliaryFailure), null);
assert.equal(visibleCaptureError(environment({ lastError: 'route failed' })), 'route failed');

const trackerAppSource = readFileSync(new URL('../TrackerApp.tsx', import.meta.url), 'utf8');
assert.match(trackerAppSource, /className="capture-safety-backdrop"/);
assert.match(trackerAppSource, /role="alertdialog" aria-modal="true"/);
assert.match(trackerAppSource, /Trace won’t connect, install an update, or restart while this game is active\./);
assert.match(trackerAppSource, /if \(environment\.capture\.waitingForMatchEnd\) setPlaying\(false\)/);
assert.doesNotMatch(trackerAppSource, /capture-safety-banner/);

const updateNoticeSource = readFileSync(new URL('../UpdateNotice.tsx', import.meta.url), 'utf8');
assert.match(updateNoticeSource, /if \(matchInProgressRef\.current\) \{/);
assert.match(updateNoticeSource, /disabled=\{busy \|\| matchInProgress\}/);

console.log('capture-status-model: healthy recordings, modal waiting state, and update deferral verified');

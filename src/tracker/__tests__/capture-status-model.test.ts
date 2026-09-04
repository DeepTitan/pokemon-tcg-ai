import assert from 'node:assert/strict';
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

console.log('capture-status-model: healthy recordings override auxiliary connection errors');

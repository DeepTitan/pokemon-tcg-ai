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
assert.match(trackerAppSource, /Trace can’t safely tell whether a match is active\./);
assert.match(trackerAppSource, /leave Trace open until it says Ready/);
assert.match(trackerAppSource, /if \(environment\.capture\.waitingForMatchEnd\) setPlaying\(false\)/);
assert.doesNotMatch(trackerAppSource, /capture-safety-banner/);

const updateNoticeSource = readFileSync(new URL('../UpdateNotice.tsx', import.meta.url), 'utf8');
assert.match(updateNoticeSource, /if \(matchInProgressRef\.current \|\| \(await getTrackerEnvironment\(\)\)\.clientRunning\) \{/);
assert.match(updateNoticeSource, /disabled=\{busy \|\| checking \|\| matchInProgress\}/);

console.log('capture-status-model: healthy recordings, modal waiting state, and update deferral verified');

// Capture startup and operation storage must stay independent of paid account checks.
assert.doesNotMatch(trackerAppSource, /membershipSessionReady|membershipBlocked/);
const automaticCapture = trackerAppSource.match(/useEffect\(\(\) => \{\s*if \(sharedMode \|\| !isTauri\(\) \|\| !environment\.capture\.permissionReady[\s\S]*?\}, \[[^\]]+\]\);/)?.[0];
const manualCapture = trackerAppSource.match(/const changeTracking = useCallback\([\s\S]*?\}, \[[^\]]+\]\);/)?.[0];
assert.ok(automaticCapture, 'automatic capture startup remains covered');
assert.ok(manualCapture, 'manual capture toggle remains covered');
for (const capturePath of [automaticCapture, manualCapture]) {
  assert.doesNotMatch(capturePath, /membership|traceAccess|fullHistory|showStudyUpgrade/);
  assert.match(capturePath, /startTracking\(\)/);
}
const recorderSource = readFileSync(new URL('../../../src-tauri/src/capture.rs', import.meta.url), 'utf8');
assert.doesNotMatch(recorderSource, /admit_match|require_trace/);
// Entitlements may redact the JS view, but must never gate native recording.
const projectionMarker = '// Full starting inventories stay in native storage.';
assert.ok(recorderSource.includes(projectionMarker));
assert.doesNotMatch(recorderSource.slice(0, recorderSource.indexOf(projectionMarker)), /crate::membership|has_full_history/);
assert.match(recorderSource, /project_operation_for_plan\(operation, pro\)/);

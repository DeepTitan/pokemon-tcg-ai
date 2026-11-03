// Exercises the real TrackerApp and setup modal against an empty, synthetic
// native profile. No OS permissions, game traffic, or account writes occur.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows, mockConvertFileSrc } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import type { CaptureStatus } from '../types.js';

localStorage.removeItem('trace/cloud-backup-disclosure-v1');
localStorage.removeItem('trace/reviews-sqlite-v1');
const capture: CaptureStatus = { permissionReady: false, enabled: false, observerRunning: false, routeActive: false, clientAttached: false, waitingForMatchEnd: false, matchInProgress: false, frameCount: 0, operationCount: 0, lastError: null, observerPort: 8899 };
const background = { launchAtLogin: false, recordingEnabled: true, supported: true, lastError: null as string | null };
let approve: (() => void) | null = null;
let cancel: (() => void) | null = null;
let failStartup = false;
const status = () => ({ ...capture });
const recover = async () => {
  background.lastError = null;
  await emit('background-status', { ...background });
};
mockWindows('main'); mockConvertFileSrc('macos');
mockIPC(async (command) => {
  switch (command) {
    case 'tracker_environment': return { clientInstalled: true, clientRunning: false, pid: null, captureMode: 'existing-client', capture: status() };
    case 'capture_status': return status();
    case 'background_status': return { ...background };
    case 'plugin:app|version': return '0.1.103+first-install-test';
    case 'plugin:updater|check': return null;
    case 'request_capture_permission':
      await new Promise<void>((resolve, reject) => {
        approve = () => { capture.permissionReady = true; approve = cancel = null; resolve(); };
        cancel = () => { approve = cancel = null; reject(new Error('User canceled. (-128)')); };
      });
      return status();
    case 'start_tracking':
      Object.assign(capture, { enabled: true, observerRunning: true, lastError: null });
      await recover();
      return status();
    case 'set_launch_at_login':
      if (failStartup) throw new Error('launchctl failed: resource temporarily unavailable (os error 35)');
      background.launchAtLogin = true;
      await recover(); return { ...background };
    case 'initialize_tracker_storage': return { rawOperations: 0, rawMatches: 0, derivedMatches: 0, pendingMatches: 0, archivedMatches: 0, importedLegacyOperations: 0 };
    case 'list_match_summaries': case 'list_raw_match_ids': case 'recent_match_operations': case 'resolve_card_sources': return [];
    case 'membership_status': return { linked: false, email: null, plan: 'none', traceAccess: false, opponentDecklists: false, admin: false, status: 'unlinked', expiresAt: null, cancelAtPeriodEnd: false };
    case 'import_legacy_reviews': return;
    default: return null;
  }
}, { shouldMockEvents: true });
const { default: TrackerApp } = await import('../TrackerApp.js');
function Controls() {
  return <nav aria-label="Synthetic installer controls" style={{position:'fixed',top:0,left:0,right:0,zIndex:5000,padding:8,background:'#fff',display:'flex',gap:8,fontSize:12}}>
    <span>Test profile · No game or OS changes</span>
    <button onClick={() => approve?.()}>Approve setup</button>
    <button onClick={() => cancel?.()}>Cancel approval</button>
    <button onClick={() => { capture.routeActive = true; }}>Recorder ready</button>
    <button onClick={() => { capture.lastError = 'Resource temporarily unavailable (os error 35)'; }}>Connection failure</button>
    <button onClick={() => { failStartup = !failStartup; }}>Toggle startup failure</button>
    <button onClick={async () => { background.lastError = 'Resource temporarily unavailable (os error 35)'; await emit('background-status', { ...background }); }}>Show recording warning</button>
    <button onClick={() => void recover()}>Recover recording</button>
  </nav>;
}
createRoot(document.getElementById('root')!).render(<><TrackerApp /><Controls /></>);

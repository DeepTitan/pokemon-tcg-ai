import { useEffect, useState } from 'react';
import { getBackgroundStatus, onBackgroundStatus, setLaunchAtLogin, startTracking, stopTracking, type BackgroundStatus } from './tauri.js';
import { captureIndicator, visibleCaptureError } from './capture-status-model.js';
import type { TrackerEnvironment } from './types.js';

export function BackgroundSettings({ environment }: { environment: TrackerEnvironment }) {
  const [status, setStatus] = useState<BackgroundStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let unlisten = () => {};
    void getBackgroundStatus().then(next => { if (active) setStatus(next); }).catch(e => { if (active) setError(String(e)); });
    void onBackgroundStatus(next => { if (active) setStatus(next); }).then(stop => { if (active) unlisten = stop; else stop(); });
    return () => { active = false; unlisten(); };
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); setStatus(await getBackgroundStatus()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <section className="membership-settings background-settings" aria-labelledby="background-recording-title">
    <h3 id="background-recording-title">Background recording</h3>
    <p>Close the Trace window and keep playing. Recording continues in the menu bar or system tray.</p>
    <label className="background-startup-toggle"><input type="checkbox" checked={status?.launchAtLogin ?? false} disabled={busy || !status?.supported}
      onChange={event => { const enabled = event.currentTarget.checked; void run(() => setLaunchAtLogin(enabled)); }} />Start Trace in the background when I sign in</label>
    <p>After setup, Trace starts quietly and gets ready before you open Pokémon. A paused recorder stays paused after restarting.</p>
    <p role="status">{!status ? 'Checking recording settings…' : status.recordingEnabled ? `Recording is on. Connection: ${captureIndicator(environment).label}.` : 'Recording is paused.'}</p>
    {visibleCaptureError(environment) && <div role="alert">
      <p>Trace cannot confirm a complete recording. If you’re in a match, finish playing first. Then quit TCG Live, quit and reopen Trace, wait for Ready, and reopen TCG Live.</p>
      <details><summary>Connection details</summary><p>{visibleCaptureError(environment)}</p></details>
    </div>}
    <div className="membership-actions"><button type="button" disabled={busy || !status} onClick={() => void run(status?.recordingEnabled ? stopTracking : startTracking)}>
      {status?.recordingEnabled ? 'Pause recording' : 'Resume recording'}
    </button></div>
    {(error || status?.lastError) && <p role="alert">{error || status?.lastError}</p>}
  </section>;
}

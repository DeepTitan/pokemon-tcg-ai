import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise, DownloadSimple, X } from '@phosphor-icons/react';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { isTauri } from './tauri.js';

const POLL_MS = 30 * 60 * 1000;
const DISMISSED_KEY = 'trace/dismissed-update-v1';

type UpdatePhase = 'available' | 'downloading' | 'ready' | 'restarting' | 'error';

export function UpdateNotice() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>('available');
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const checkingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!isTauri() || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const next = await check({ timeout: 15_000 });
      const dismissed = localStorage.getItem(DISMISSED_KEY);
      if (next && next.version !== dismissed) {
        setUpdate(next);
        setPhase('available');
        setProgress(null);
        setMessage(null);
      } else {
        await next?.close();
      }
    } catch (error) {
      console.warn('Trace update check failed', error);
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return undefined;
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  if (!update) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, update.version);
    void update.close();
    setUpdate(null);
  };

  const install = async () => {
    setPhase('downloading');
    setMessage(null);
    let downloaded = 0;
    let total: number | undefined;
    const onDownload = (event: DownloadEvent) => {
      if (event.event === 'Started') total = event.data.contentLength;
      if (event.event === 'Progress') downloaded += event.data.chunkLength;
      if (event.event === 'Finished') setProgress(100);
      else if (total) setProgress(Math.min(99, Math.round((downloaded / total) * 100)));
    };
    try {
      await update.downloadAndInstall(onDownload, { timeout: 10 * 60 * 1000 });
      setPhase('ready');
      setMessage('The update is installed. Restart Trace to use it.');
    } catch (error) {
      setPhase('error');
      setMessage(error instanceof Error ? error.message : 'Trace could not install the update.');
    }
  };

  const restart = async () => {
    setPhase('restarting');
    try {
      await relaunch();
    } catch (error) {
      setPhase('error');
      setMessage(error instanceof Error ? error.message : 'Trace could not restart.');
    }
  };

  const busy = phase === 'downloading' || phase === 'restarting';
  const ready = phase === 'ready';
  const action = ready ? restart : install;
  const actionLabel = phase === 'downloading'
    ? progress == null ? 'Downloading…' : `Downloading ${progress}%`
    : phase === 'restarting'
      ? 'Restarting…'
      : ready
        ? 'Restart Trace'
        : phase === 'error'
          ? 'Try again'
          : 'Install update';

  return (
    <aside className={`update-notice phase-${phase}`} aria-live="polite">
      <div className="update-notice-icon">
        {ready ? <ArrowClockwise size={21} weight="bold" /> : <DownloadSimple size={21} weight="bold" />}
      </div>
      <div className="update-notice-copy">
        <small>{ready ? 'Restart required' : phase === 'error' ? 'Update interrupted' : 'Update available'}</small>
        <strong>Trace {update.version}</strong>
        <p>{message || update.body || 'A new signed Trace build is ready.'}</p>
      </div>
      <button className="update-notice-dismiss" type="button" onClick={dismiss} disabled={busy} aria-label="Dismiss update">
        <X size={15} weight="bold" />
      </button>
      <button className="update-notice-action" type="button" onClick={() => void action()} disabled={busy}>
        {actionLabel}
      </button>
      {phase === 'downloading' && progress != null && <span className="update-notice-progress" style={{ width: `${progress}%` }} />}
    </aside>
  );
}

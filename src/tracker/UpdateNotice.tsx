import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';
import { ArrowClockwise } from '@phosphor-icons/react/ArrowClockwise';
import { DownloadSimple } from '@phosphor-icons/react/DownloadSimple';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { getTrackerEnvironment, isTauri } from './tauri.js';

const POLL_MS = 30 * 60 * 1000;
const DISMISSED_KEY = 'trace/dismissed-update-v1';

type UpdatePhase = 'available' | 'downloading' | 'downloaded' | 'installing' | 'ready' | 'restarting' | 'error';

interface UpdateNoticeProps {
  matchInProgress?: boolean;
  settingsOpen?: boolean;
}

function updateErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message).trim();
    if (message) return message;
  }
  return fallback;
}

export function UpdateNotice({ matchInProgress = false, settingsOpen = false }: UpdateNoticeProps) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>('available');
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const checkingRef = useRef(false);
  const operationRef = useRef(false);
  const updateRef = useRef<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState('Check for the latest signed version of Trace.');
  const [dismissed, setDismissed] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<HTMLElement | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    setSettingsTarget(settingsOpen ? document.getElementById('settings-updates') : null);
  }, [settingsOpen]);
  const matchInProgressRef = useRef(matchInProgress);

  useEffect(() => {
    matchInProgressRef.current = matchInProgress;
  }, [matchInProgress]);

  const refresh = useCallback(async (manual = false) => {
    if (!isTauri() || checkingRef.current || operationRef.current || ['downloaded', 'installing', 'ready', 'restarting'].includes(phaseRef.current)) return;
    checkingRef.current = true;
    setChecking(true);
    if (manual) setMessage(null);
    try {
      const next = await check({ timeout: 15_000 });
      const previous = updateRef.current;
      updateRef.current = next;
      setUpdate(next);
      if (previous) await previous.close().catch(() => undefined);
      if (next) {
        setDismissed(!manual && next.version === localStorage.getItem(DISMISSED_KEY));
        setPhase('available');
        setProgress(null);
        setMessage(null);
        setCheckMessage(`Trace ${next.version} is available.`);
      } else {
        setPhase('available');
        setMessage(null);
        setCheckMessage('You’re up to date.');
      }
    } catch (error) {
      console.warn('Trace update check failed', error);
      if (manual) setCheckMessage(updateErrorMessage(error, 'Could not check for updates. Try again.'));
    } finally {
      checkingRef.current = false;
      setChecking(false);
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

  const applyDownloaded = useCallback(async () => {
    if (!update) return;
    try {
      if (matchInProgressRef.current || (await getTrackerEnvironment()).clientRunning) {
        setPhase('downloaded');
        setMessage('Downloaded. Quit TCG Live to safely install the update.');
        return;
      }
      setPhase('installing');
      setMessage('Installing the signed update…');
      await update.install();
      setPhase('ready');
      setMessage('The update is installed. Restart Trace to use it.');
    } catch (error) {
      setPhase('error');
      setMessage(updateErrorMessage(error, 'Trace could not install the update.'));
    }
  }, [update]);

  const dismiss = () => {
    if (!update) return;
    localStorage.setItem(DISMISSED_KEY, update.version);
    setDismissed(true);
  };

  const install = async () => {
    if (!update || matchInProgressRef.current || operationRef.current || checkingRef.current) return;
    operationRef.current = true;
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
      await update.download(onDownload, { timeout: 10 * 60 * 1000 });
      setProgress(100);
      await applyDownloaded();
    } catch (error) {
      setPhase('error');
      setMessage(updateErrorMessage(error, 'Trace could not install the update.'));
    } finally {
      operationRef.current = false;
    }
  };

  const restart = async () => {
    if (matchInProgressRef.current) return;
    try {
      if ((await getTrackerEnvironment()).clientRunning) {
        setMessage('Quit TCG Live before restarting Trace.');
        return;
      }
      setPhase('restarting');
      await relaunch();
    } catch (error) {
      setPhase('ready');
      setMessage(updateErrorMessage(error, 'Trace could not restart. Try restarting again.'));
    }
  };

  const busy = phase === 'downloading' || phase === 'installing' || phase === 'restarting';
  const ready = phase === 'ready';
  const action = ready ? restart : phase === 'downloaded' ? applyDownloaded : install;
  const actionLabel = phase === 'downloading'
    ? progress == null ? 'Downloading…' : `Downloading ${progress}%`
    : phase === 'restarting'
      ? 'Restarting…'
      : phase === 'installing'
        ? 'Installing…'
        : matchInProgress
          ? 'Close TCG Live to install'
          : ready
            ? 'Restart Trace'
            : phase === 'error'
              ? 'Try again'
              : 'Install update';

  const settings = settingsTarget && createPortal(<section className="settings-updates"><strong>App updates</strong><p role="status">{!isTauri() ? 'Updates are available in the installed Trace app.' : message || checkMessage}</p>{matchInProgress && <p>Quit TCG Live before installing or restarting Trace. Checking for updates is safe while playing.</p>}<button type="button" disabled={!isTauri() || checking || busy || phase === 'ready' || phase === 'downloaded'} onClick={() => void refresh(true)}>{checking ? 'Checking…' : 'Check for updates'}</button>{update && <button type="button" disabled={busy || checking || matchInProgress} onClick={() => void action()}>{actionLabel} · {update.version}</button>}</section>, settingsTarget);
  return <>{settings}{update && !dismissed && !settingsOpen && (
    <aside className={`update-notice phase-${phase}`} aria-live="polite">
      <div className="update-notice-icon">
        {ready ? <ArrowClockwise size={21} weight="bold" /> : <DownloadSimple size={21} weight="bold" />}
      </div>
      <div className="update-notice-copy">
        <small>{matchInProgress ? 'Close TCG Live to update' : ready ? 'Restart required' : phase === 'error' ? 'Update failed' : 'Update available'}</small>
        <strong>Trace {update.version}</strong>
        <p>{matchInProgress ? 'Finish any active game, then quit TCG Live. You can also manage updates in Settings.' : message || update.body || 'A new signed Trace build is ready.'}</p>
      </div>
      <button className="update-notice-dismiss" type="button" onClick={dismiss} disabled={busy || checking} aria-label="Dismiss update">
        <X size={15} weight="bold" />
      </button>
      <button className="update-notice-action" type="button" onClick={() => void action()} disabled={busy || checking || matchInProgress}>
        {actionLabel}
      </button>
      {phase === 'downloading' && progress != null && <span className="update-notice-progress" style={{ width: `${progress}%` }} />}
    </aside>
  )}</>;
}

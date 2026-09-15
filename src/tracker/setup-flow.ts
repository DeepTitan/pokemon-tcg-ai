import type { CaptureStatus, TrackerEnvironment } from './types.js';

export type SetupPhase = 'initial' | 'checking' | 'update' | 'updating' | 'restart' | 'restarting' | 'close-live' | 'approval' | 'connecting' | 'failed' | 'ready';
export interface SetupState { phase: SetupPhase; message: string; }
export const initialSetup: SetupState = { phase: 'initial', message: 'Connect Trace to Pokémon TCG Live to automatically record your matches.' };
export const setupBusy = (phase: SetupPhase) => ['checking', 'updating', 'restarting', 'approval', 'connecting'].includes(phase);
export const setupLabel = (phase: SetupPhase) => ({
  initial: 'Set up Trace', checking: 'Checking…', update: 'Update Trace', updating: 'Updating…',
  restart: 'Restart Trace', restarting: 'Restarting…', 'close-live': 'Check again',
  approval: 'Waiting for approval…', connecting: 'Connecting…', failed: 'Try again', ready: 'Done',
})[phase];

interface SetupUpdate { download(): Promise<void>; install(): Promise<void>; close(): Promise<void>; }
interface Dependencies {
  environment(): Promise<TrackerEnvironment>;
  check(): Promise<SetupUpdate | null>;
  permission(): Promise<CaptureStatus>;
  start(): Promise<CaptureStatus>;
  restart(): Promise<void>;
  capture(status: CaptureStatus): void;
}

// Own the operation guard independently of React renders (including double clicks).
export function createSetupFlow(deps: Dependencies, notify: (state: SetupState) => void) {
  let state = initialSetup;
  let running = false;
  let disposed = false;
  let update: SetupUpdate | null = null;
  let downloaded = false;
  let installed = false;
  const set = (phase: SetupPhase, message: string) => {
    state = { phase, message };
    if (!disposed) notify(state);
  };
  const blocked = async () => {
    const environment = await deps.environment();
    if (environment.clientRunning) {
      set('close-live', 'Finish your match, then quit Pokémon TCG Live to continue.');
      return true;
    }
    return false;
  };
  return {
    async run() {
      if (running || disposed || state.phase === 'ready') return;
      running = true;
      const applyUpdate = state.phase === 'update' || update !== null;
      try {
        set('checking', 'Checking your setup…');
        if (await blocked()) return;
        if (installed) {
          set('restarting', 'Restarting Trace…');
          await deps.restart();
          return;
        }
        if (!update) update = await deps.check();
        if (update) {
          if (!applyUpdate) { set('update', 'Update Trace to continue.'); return; }
          set('updating', 'Downloading the signed update…');
          if (!downloaded) { await update.download(); downloaded = true; }
          // Live may have opened while the download was in flight.
          if (await blocked()) return;
          set('updating', 'Installing the signed update…');
          await update.install();
          installed = true;
          set('restart', 'Restart Trace to finish the update, then continue setup.');
          return;
        }
        if (await blocked()) return;
        const environment = await deps.environment();
        if (!environment.capture.permissionReady) {
          set('approval', 'Approve any macOS setup prompt to continue.');
          const permission = await deps.permission();
          if (!permission.permissionReady) throw new Error('Capture permission was not approved. Try again and approve the macOS prompt.');
        }
        if (await blocked()) return;
        set('connecting', 'Connecting capture…');
        const capture = await deps.start();
        deps.capture(capture);
        if (capture.waitingForMatchEnd) {
          set('close-live', 'Finish your match, then quit Pokémon TCG Live to continue.');
        } else if (capture.lastError || !capture.enabled || !capture.observerRunning) {
          throw new Error(capture.lastError || 'Capture did not start. Try again.');
        } else {
          set('ready', 'Trace is ready. Open Pokémon TCG Live to start recording.');
        }
      } catch (error) {
        set('failed', error instanceof Error ? error.message : String(error));
      } finally {
        running = false;
        if (disposed) await update?.close().catch(() => undefined);
      }
    },
    dispose() { disposed = true; if (!running) void update?.close().catch(() => undefined); },
  };
}

import type { CaptureStatus, TrackerEnvironment } from './types.js';

export type SetupPhase = 'initial' | 'checking' | 'update' | 'updating' | 'restart' | 'restarting' | 'close-live' | 'approval' | 'connecting' | 'startup' | 'failed' | 'ready';
export interface SetupState { phase: SetupPhase; message: string; }
export const initialSetup: SetupState = { phase: 'initial', message: 'Connect Trace to Pokémon TCG Live to automatically record your matches.' };
export const setupBusy = (phase: SetupPhase) => ['checking', 'updating', 'restarting', 'approval', 'connecting', 'startup'].includes(phase);
export const setupLabel = (phase: SetupPhase) => ({
  initial: 'Set up Trace', checking: 'Checking…', update: 'Update Trace', updating: 'Updating…',
  restart: 'Restart Trace', restarting: 'Restarting…', 'close-live': 'Check again',
  approval: 'Waiting for approval…', connecting: 'Connecting…', startup: 'Finishing setup…', failed: 'Try again', ready: 'Done',
})[phase];

interface SetupUpdate { download(): Promise<void>; install(): Promise<void>; close(): Promise<void>; }
interface Dependencies {
  environment(): Promise<TrackerEnvironment>;
  check(): Promise<SetupUpdate | null>;
  permission(): Promise<CaptureStatus>;
  start(): Promise<CaptureStatus>;
  background(): Promise<unknown>;
  restart(): Promise<void>;
  capture(status: CaptureStatus): void;
  waitForRetry?(): Promise<void>;
}

export function setupFailureMessage(error: unknown, phase: SetupPhase): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (/cancel|denied|not approved|not authorized|\(-128\)/i.test(detail)) {
    return 'Setup wasn’t approved. Choose Try again when you’re ready, then approve the system prompt.';
  }
  if (phase === 'startup') return 'Recording is ready, but automatic startup couldn’t be turned on. Choose Try again to finish.';
  if (phase === 'approval') return 'Your computer couldn’t finish setup. Choose Try again and approve the system prompt.';
  if (phase === 'updating' || phase === 'restarting') return 'Trace couldn’t finish the update. Check your internet connection, then try again.';
  if (phase === 'checking') return 'Trace couldn’t check your setup. Check your internet connection, then try again.';
  return 'Trace couldn’t connect yet. Keep Pokémon closed and choose Try again.';
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
          set('approval', 'Approve the system setup prompt to continue.');
          const permission = await deps.permission();
          if (!permission.permissionReady) throw new Error('Capture permission was not approved. Try again and approve the system prompt.');
          set('checking', 'Approval received. Checking the game before connecting…');
        }
        if (await blocked()) return;
        if (disposed) return;
        set('connecting', 'Getting recording ready…');
        let capture = await deps.start();
        for (let attempt = 0; ; attempt++) {
          if (disposed) return;
          deps.capture(capture);
          if (capture.waitingForMatchEnd) {
            set('close-live', 'Finish your match, then quit Pokémon TCG Live to continue.');
            return;
          }
          if (capture.lastError || !capture.enabled || !capture.observerRunning) {
            throw new Error(capture.lastError || 'Capture did not start.');
          }
          // The listener can start before routing is ready. Do not tell a new
          // user to launch Pokémon until the native manager has armed capture.
          if (capture.routeActive) break;
          if (attempt >= 59) throw new Error('Capture connection timed out.');
          await (deps.waitForRetry?.() ?? new Promise(resolve => setTimeout(resolve, 500)));
          if (disposed) return;
          const next = await deps.environment();
          capture = next.capture;
          if (next.clientRunning && !capture.routeActive) {
            set('close-live', 'Finish your match, then quit Pokémon TCG Live to continue.');
            return;
          }
        }
        set('startup', 'Turning on automatic recording…');
        await deps.background();
        set('ready', 'You’re all set. Open Pokémon TCG Live and play. Trace will record in the background, even with this window closed.');
      } catch (error) {
        console.warn(`Trace setup (${state.phase}):`, error);
        set('failed', setupFailureMessage(error, state.phase));
      } finally {
        running = false;
        if (disposed) await update?.close().catch(() => undefined);
      }
    },
    dispose() { disposed = true; if (!running) void update?.close().catch(() => undefined); },
  };
}

/** Native window dimensions are physical pixels, independent of page zoom. */
export interface NativeInterfaceViewport {
  width: number;
  height: number;
  scaleFactor: number;
}

export interface InterfaceScaleState { scale: number; error: string | null }

export function automaticInterfaceScaleForViewport(viewport: NativeInterfaceViewport): number | null {
  if (![viewport.width, viewport.height, viewport.scaleFactor].every((value) => Number.isFinite(value) && value > 0)) return null;
  const width = viewport.width / viewport.scaleFactor;
  const height = viewport.height / viewport.scaleFactor;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const requested = Math.max(1, Math.min(width / 1440, height / 900));
  // Keep every control reachable even at the native window's minimum size.
  const scale = Math.floor(Math.min(requested, 2, width / 1200, height / 720) * 20) / 20;
  return scale > 0 ? scale : null;
}

interface InterfaceScaleHost {
  readViewport(): Promise<NativeInterfaceViewport>;
  setZoom(scale: number): Promise<void>;
}

/** Coalesce resize/DPI changes without concurrent native reads or zoom writes. */
export function createAutomaticInterfaceScaler(host: InterfaceScaleHost,
  onChange: (state: InterfaceScaleState) => void): {
    refresh(viewport?: NativeInterfaceViewport): void;
    dispose(): void;
  } {
  let revision = 0;
  let pending: { revision: number; viewport?: NativeInterfaceViewport } | null = null;
  let running = false;
  let disposed = false;
  // Unknown initially: a native webview may retain zoom across frontend loads.
  let applied: number | null = null;
  let reportedScale = 1;

  const run = async () => {
    if (running || disposed) return;
    running = true;
    try {
      while (pending && !disposed) {
        const request = pending;
        pending = null;
        try {
          const viewport = request.viewport ?? await host.readViewport();
          if (disposed) return;
          if (request.revision !== revision) continue;
          const scale = automaticInterfaceScaleForViewport(viewport);
          if (scale == null) continue; // Minimized or not yet measurable.
          if (scale !== applied) {
            // A rejected native write may still have changed the webview; retry
            // the next requested scale instead of trusting the previous value.
            applied = null;
            await host.setZoom(scale);
            if (disposed) return;
            applied = scale;
          }
          if (request.revision !== revision) continue;
          reportedScale = scale;
          onChange({ scale, error: null });
        } catch (error) {
          if (!disposed && request.revision === revision) {
            onChange({ scale: reportedScale, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
    } finally {
      running = false;
    }
  };

  const refresh = (viewport?: NativeInterfaceViewport) => {
    if (disposed) return;
    pending = { revision: ++revision, viewport: viewport ? { ...viewport } : undefined };
    void run();
  };

  return {
    refresh,
    dispose() {
      disposed = true;
      pending = null;
    },
  };
}

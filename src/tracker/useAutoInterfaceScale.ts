import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { isTauri } from './tauri.js';
import { createAutomaticInterfaceScaler } from './interface-scale.js';

/** Fit the complete desktop interface automatically; board zoom stays separate. */
export function useAutoInterfaceScale(): void {
  useEffect(() => {
    if (!isTauri()) return;
    const nativeWindow = getCurrentWindow();
    const webview = getCurrentWebview();
    const scaler = createAutomaticInterfaceScaler({
      async readViewport() {
        // Native dimensions do not shrink when page zoom changes. Measuring the
        // DOM here would make Auto repeatedly undo its own zoom.
        const [size, scaleFactor] = await Promise.all([nativeWindow.innerSize(), nativeWindow.scaleFactor()]);
        return { width: size.width, height: size.height, scaleFactor };
      },
      setZoom: (scale) => webview.setZoom(scale),
    }, ({ error }) => { if (error) console.warn('Trace automatic interface sizing failed:', error); });
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const register = (registration: Promise<() => void>) => {
      void registration.then((unlisten) => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      }).catch((error: unknown) => {
        if (!disposed) console.warn('Trace automatic interface sizing could not follow window changes:', error);
      });
    };
    register(nativeWindow.onResized(() => scaler.refresh()));
    register(nativeWindow.onScaleChanged(({ payload }: { payload: { size: { width: number; height: number }; scaleFactor: number } }) => scaler.refresh({
      width: payload.size.width, height: payload.size.height, scaleFactor: payload.scaleFactor,
    })));
    scaler.refresh();
    return () => {
      disposed = true;
      scaler.dispose();
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);
}

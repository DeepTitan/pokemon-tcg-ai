import { useEffect, useRef, type ReactNode } from 'react';
import { X } from '@phosphor-icons/react';

export function UpdateSettingsModal({ onClose, version, children }: { onClose: () => void; version: string | null; children?: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!;
    // A native modal keeps keyboard focus inside and makes the replay behind it inert.
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={dialog} className="update-settings-modal" aria-labelledby="update-settings-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className="update-settings-heading">
      <img src="/tracker-assets/trace-mascot.png" alt="" />
      <div><h2 id="update-settings-title">{children ? 'Trace settings' : 'Trace updates'}</h2>{version && <p>Version {version}</p>}</div>
      <button type="button" onClick={onClose} aria-label="Close settings"><X size={20} weight="bold" /></button>
    </header>
    {children}
    <div id="settings-updates" />
  </dialog>;
}

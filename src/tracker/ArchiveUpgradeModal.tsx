import { useEffect, useRef, useState } from 'react';
import { LockSimple, X } from '@phosphor-icons/react';
import { openMembershipAccount } from './tauri.js';

export function ArchiveUpgradeModal({ onClose, onLink }: { onClose: () => void; onLink: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="archive-upgrade-modal" aria-labelledby="archive-upgrade-title" aria-describedby="archive-upgrade-description"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <button className="archive-upgrade-close" onClick={onClose} aria-label="Close upgrade prompt"><X size={20} /></button>
    <span className="archive-upgrade-icon"><LockSimple size={24} weight="duotone" /></span>
    <h2 id="archive-upgrade-title">Your match is saved.</h2>
    <p id="archive-upgrade-description">Replay games older than 7 days with Trace Pro.</p>
    <button className="archive-upgrade-primary" disabled={busy} onClick={() => {
      setBusy(true); setError('');
      void openMembershipAccount().catch(() => setError('Couldn’t open your browser. Visit victoryroad.app/trace.')).finally(() => setBusy(false));
    }}>{busy ? 'Opening…' : 'Get Trace Pro'}</button>
    <button className="archive-upgrade-link" onClick={onLink}>Already have Pro? Link your account</button>
    {error && <p role="alert">{error}</p>}
  </dialog>;
}

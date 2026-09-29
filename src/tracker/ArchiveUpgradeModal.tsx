import { useEffect, useRef, useState } from 'react';
import { LockSimple } from '@phosphor-icons/react/LockSimple';
import { X } from '@phosphor-icons/react/X';
import { openMembershipAccount } from './tauri.js';

export function ArchiveUpgradeModal({ onClose, onLink, feature = 'archive', studyZone = 'decklist' }: { onClose: () => void; onLink: () => void; feature?: 'archive' | 'study'; studyZone?: 'decklist' | 'deck' | 'prizes' }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const studyTitle = studyZone === 'prizes' ? 'Prize cards' : studyZone === 'deck' ? 'Deck contents' : 'Your decklist';
  return <dialog ref={dialog} className={`archive-upgrade-modal${feature === 'study' ? ' study-upgrade-modal' : ''}`} aria-labelledby="archive-upgrade-title" aria-describedby="archive-upgrade-description"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onPointerDown={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <button className="archive-upgrade-close" onClick={onClose} aria-label="Close upgrade prompt"><X size={20} /></button>
    {feature === 'study' && <><div className={`study-locked-cards ${studyZone === 'prizes' ? 'is-prizes' : ''}`} aria-hidden="true">{Array.from({ length: studyZone === 'prizes' ? 6 : 12 }, (_, index) => <div className="study-card-placeholder" key={index}><i /><b /><em /><em /></div>)}</div></>}
    <section className={feature === 'study' ? 'study-locked-message' : undefined}>
    <span className="archive-upgrade-icon"><LockSimple size={24} weight="duotone" /></span>
    <h2 id="archive-upgrade-title">{feature === 'study' ? studyZone === 'decklist' ? 'Your decklist is locked' : `${studyTitle} are locked` : 'Your match is saved.'}</h2>
    <p id="archive-upgrade-description">{feature === 'study' ? studyZone === 'prizes' ? 'See your prize cards with Trace Pro.' : studyZone === 'deck' ? 'See the cards in your deck with Trace Pro.' : 'See your full decklist with Trace Pro.' : 'Replay games older than 7 days with Trace Pro.'}</p>
    <button className="archive-upgrade-primary" disabled={busy} onClick={() => {
      setBusy(true); setError('');
      void openMembershipAccount().catch(() => setError('Couldn’t open your browser. Visit victoryroad.app/trace.')).finally(() => setBusy(false));
    }}>{busy ? 'Opening…' : feature === 'study' ? 'Unlock with Pro' : 'Get Trace Pro'}</button>
    <button className="archive-upgrade-link" onClick={onLink}>Already have Pro? Link your account</button>
    {error && <p role="alert">{error}</p>}
    </section>
  </dialog>;
}

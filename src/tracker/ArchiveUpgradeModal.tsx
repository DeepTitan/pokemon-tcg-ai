import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from '@phosphor-icons/react/ArrowUpRight';
import { ClockCounterClockwise } from '@phosphor-icons/react/ClockCounterClockwise';
import { ShareNetwork } from '@phosphor-icons/react/ShareNetwork';
import { X } from '@phosphor-icons/react/X';
import { openMembershipAccount } from './tauri.js';

export function ArchiveUpgradeModal({ onClose, onLink, feature = 'archive' }: { onClose: () => void; onLink: () => void; feature?: 'archive' | 'pro' }) {
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
    onPointerDown={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <button className="archive-upgrade-close" onClick={onClose} aria-label="Close upgrade prompt"><X size={20} /></button>
    <header className="pro-intro">
      <div className="pro-intro-copy">
        <span className="pro-wordmark">Trace <b>PRO</b></span>
        <h2 id="archive-upgrade-title">{feature === 'archive' ? 'There’s more to learn from this match.' : <>Good games end.<br />The lessons stay.</>}</h2>
        <p id="archive-upgrade-description">{feature === 'archive' ? 'This replay is over 30 days old and still safely saved. Open it again with Pro.' : 'Build a match library you can keep coming back to, and learn together with your practice group.'}</p>
      </div>
      <img className="pro-mascot" src="/tracker-assets/trace-mascot.png" alt="" />
    </header>
    <div className="pro-benefits">
      <div><span><ClockCounterClockwise size={23} weight="duotone" aria-hidden="true" /></span><section><h3>Every match, whenever you need it</h3><p>Revisit your full archive, from last week’s misplay to last season’s best line.</p></section></div>
      <div><span><ShareNetwork size={23} weight="duotone" aria-hidden="true" /></span><section><h3>More games. More second opinions.</h3><p>Share unlimited replays with friends, teammates, or your coach.</p></section></div>
    </div>
    <footer className="pro-decision">
      <div className="pro-decision-actions">
        <button className="archive-upgrade-primary" disabled={busy} onClick={() => {
          setBusy(true); setError('');
          void openMembershipAccount('plans').catch(() => setError('Couldn’t open your browser. Visit victoryroad.app/trace.')).finally(() => setBusy(false));
        }}>{busy ? 'Opening…' : 'Explore Trace Pro'}<ArrowUpRight size={17} weight="bold" aria-hidden="true" /></button>
        <button className="pro-keep-free" onClick={onClose}>Keep using Free</button>
      </div>
      <p className="pro-price-note">$5 monthly or $50 yearly. Cancel anytime.</p>
      <div className="pro-free-footer"><p>Your first 30 days of each replay, deck study, and prize inspection stay free.</p><button className="archive-upgrade-link" onClick={onLink}>Already a member?</button></div>
      {error && <p className="pro-error" role="alert">{error}</p>}
    </footer>
  </dialog>;
}

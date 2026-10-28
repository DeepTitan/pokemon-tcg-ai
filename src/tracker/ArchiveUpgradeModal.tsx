import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight } from '@phosphor-icons/react/ArrowRight';
import { X } from '@phosphor-icons/react/X';
import { openMembershipAccount } from './tauri.js';

export interface UpgradePreview { board: ReactNode; title: string; caption: string; }

export function ArchiveUpgradeModal({ onClose, onLink, feature = 'archive', preview }: {
  onClose: () => void; onLink: () => void;
  feature?: 'archive' | 'pro' | 'share'; preview?: UpgradePreview;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const boardSlot = useRef<HTMLDivElement>(null);
  const opening = useRef(false);
  const [width, setWidth] = useState(525);
  const [plan, setPlan] = useState<'month' | 'year'>('month');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const hasPreview = Boolean(preview);
  useEffect(() => {
    const slot = boardSlot.current;
    if (!slot || !hasPreview) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(slot);
    return () => observer.disconnect();
  }, [hasPreview]);

  const headline = feature === 'archive' ? 'Pick up where you left off.'
    : feature === 'share' ? 'Good games deserve a second look.' : 'Keep every game in reach.';
  const cta = feature === 'archive' ? 'Unlock & replay' : feature === 'share' ? 'Upgrade & share' : 'Get Trace Pro';
  const checkout = async () => {
    if (opening.current) return;
    opening.current = true;
    setBusy(true); setError('');
    try {
      await openMembershipAccount(plan === 'year' ? 'checkout-year' : 'checkout-month');
      setOpened(true);
    } catch {
      setError('Couldn’t open checkout. Try again, or visit victoryroad.app/trace.');
    } finally { opening.current = false; setBusy(false); }
  };

  return <dialog ref={dialog} className="archive-upgrade-modal" aria-labelledby="archive-upgrade-title" aria-describedby="archive-upgrade-description"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <div className="archive-upgrade-layout">
      <section className="archive-upgrade-visual" aria-label={preview ? 'Replay preview' : 'Example replay'}>
        <div className="archive-upgrade-image" ref={boardSlot}>
          {preview ? <div className="archive-upgrade-board-slot" aria-hidden="true" {...{ inert: '' } as { inert: string }}>
            <div className="archive-upgrade-board-scale" style={{ transform: `scale(${width / 900})` }}>{preview.board}</div>
          </div> : <img src="/tracker-assets/upgrade-example-board.jpg" alt="Trace replay board with Dragapult ex and Alakazam" />}
        </div>
        <div className="archive-upgrade-caption"><span>{preview?.caption || 'Example replay'}</span><h3>{preview?.title || 'Dragapult ex vs. Alakazam'}</h3></div>
      </section>
      <section className="archive-upgrade-offer">
        <button className="archive-upgrade-close" onClick={onClose} aria-label="Close upgrade prompt"><X size={23} /></button>
        <div className="archive-upgrade-wordmark">Trace <span>PRO</span></div>
        <h2 id="archive-upgrade-title">{headline}</h2>
        <div id="archive-upgrade-description" className="archive-upgrade-benefits"><p>Revisit any saved match, even after 30 days.</p><p>Share unlimited replays with teammates or your coach.</p></div>
        <fieldset className="archive-upgrade-plans" disabled={busy}><legend className="sr-only">Subscription plan</legend>
          {(['month', 'year'] as const).map(interval => <label key={interval} className={plan === interval ? 'selected' : ''}>
            <input type="radio" name="trace-upgrade-plan" value={interval} checked={plan === interval} onChange={() => { setPlan(interval); setOpened(false); }} />
            <span><strong>{interval === 'month' ? '$4.99' : '$49.99'}</strong> / {interval}</span>
          </label>)}
        </fieldset>
        <button className="archive-upgrade-primary" disabled={busy} onClick={() => void checkout()}>{busy ? 'Opening checkout…' : opened ? 'Continue checkout' : cta}<ArrowRight size={21} aria-hidden="true" /></button>
        <p className="archive-upgrade-renewal" aria-live="polite">Renews {plan === 'year' ? 'annually' : 'monthly'}. Cancel anytime.</p>
        {opened && <p className="archive-upgrade-status" role="status">Finish in your browser, then return to Trace. <button className="archive-upgrade-link" onClick={onLink}>Already upgraded? Link your account.</button></p>}
        {error && <p className="archive-upgrade-error" role="alert">{error}</p>}
        <div className="archive-upgrade-footer"><button className="archive-upgrade-dismiss" onClick={onClose}>{feature === 'archive' ? 'Back to replays' : 'Keep using Free'}</button><p>Recording, recent replays, deck and prize study stay free.</p><button className="archive-upgrade-link" onClick={onLink}>Already a member?</button></div>
      </section>
    </div>
  </dialog>;
}

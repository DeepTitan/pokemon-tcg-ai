import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CardsThree } from '@phosphor-icons/react/CardsThree';
import { Check } from '@phosphor-icons/react/Check';
import { CopySimple } from '@phosphor-icons/react/CopySimple';
import { LockSimple } from '@phosphor-icons/react/LockSimple';
import { X } from '@phosphor-icons/react/X';
import type { CapturedDecklist, CardInfo } from './types.js';
import { cardArtUsesAlternate, resolvedCardArt, showCardBackOnError } from './card-art.js';
import { exportDecklist } from './decklist-export.js';

function DecklistCard({ cardId, count, card }: { cardId: string; count: number; card?: CardInfo }) {
  const [unavailable, setUnavailable] = useState(false);
  const [localFailed, setLocalFailed] = useState(false);
  const label = card?.name || cardId;
  useEffect(() => { setUnavailable(false); setLocalFailed(false); }, [cardId, card?.imageDataUrl]);
  return <figure title={`${count} × ${label} · ${cardId}`}>
    <div className="decklist-card-art">
    {unavailable ? <div className="decklist-art-unavailable" role="img" aria-label={`${label}: artwork unavailable`}>
      <strong>{label}</strong><small>{card?.setCode || cardId.split('_')[0]} · {card?.number || cardId.split('_')[1]}</small>
      {card?.hp && <span>{card.hp} HP</span>}<small>Artwork unavailable</small>
    </div> : <img key={`${cardId}:${card?.imageDataUrl || ''}`} data-card-id={cardId}
      src={resolvedCardArt(cardId, card?.imageDataUrl)} alt={label} loading="eager"
      onError={event => { setLocalFailed(true); showCardBackOnError(event); if (event.currentTarget.src.endsWith('/tracker-assets/pokemon-card-back.jpg')) setUnavailable(true); }} />}
    <b aria-label={`${count} copies`}>×{count}</b></div><figcaption>{label}</figcaption>
      {!unavailable && (!card?.imageDataUrl || localFailed) && cardArtUsesAlternate(cardId)
        && <small className="decklist-art-note" title="The captured printing is preserved; artwork shows a version with the same gameplay text.">Alternate artwork</small>}
  </figure>;
}

export function PlayerDecklist({ name, deck: suppliedDeck, catalog, loadDeck, unavailableReason, accessKey, onUpgrade, upgradeLabel }: {
  name: string; deck?: CapturedDecklist; catalog: ReadonlyMap<string, CardInfo>;
  loadDeck?: () => Promise<CapturedDecklist>; unavailableReason?: string; accessKey?: string; onUpgrade?: () => void; upgradeLabel?: string;
}) {
  const [privateDeck, setPrivateDeck] = useState<CapturedDecklist>();
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [loadError, setLoadError] = useState('');
  const fetchGeneration = useRef(0);
  const isOpen = useRef(false);
  const deck = suppliedDeck || privateDeck;
  const available = Boolean(suppliedDeck || loadDeck);
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const copyAttempt = useRef(0);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();
  const suppressFocus = useRef(false);
  const id = useId();
  const cancelClose = () => clearTimeout(timer.current);
  const close = () => { clearTimeout(hoverTimer.current); cancelClose(); isOpen.current = false; fetchGeneration.current++; setPrivateDeck(undefined); setLoadState('idle'); setCopyState('idle'); copyAttempt.current++; setOpen(false); };
  const show = () => {
    clearTimeout(hoverTimer.current);
    cancelClose();
    if ((!available && !onUpgrade) || isOpen.current) return;
    isOpen.current = true;
    cancelClose(); const rect = button.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 612)),
      top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - Math.min(570, window.innerHeight - 24))) });
    setOpen(true);
    if (loadDeck) {
      const generation = ++fetchGeneration.current;
      setPrivateDeck(undefined); setLoadState('loading'); setLoadError('');
      void loadDeck().then(value => {
        if (generation === fetchGeneration.current) { setPrivateDeck(value); setLoadState('idle'); }
      }).catch(caught => {
        if (generation === fetchGeneration.current) { setLoadState('failed'); setLoadError(caught instanceof Error ? caught.message : String(caught)); }
      });
    }
  };
  const leave = () => { clearTimeout(hoverTimer.current); cancelClose(); timer.current = setTimeout(() => {
    if (!panel.current?.contains(document.activeElement) && document.activeElement !== button.current) close();
  }, 180); };
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(hoverTimer.current); }, []);
  useLayoutEffect(() => {
    if (!open || !panel.current || !button.current) return;
    const anchor = button.current.getBoundingClientRect();
    const height = panel.current.offsetHeight, width = panel.current.offsetWidth;
    const below = anchor.bottom + 8;
    const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - height - 8);
    setPosition({ left: Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12)), top });
  }, [open, loadState, deck]);
  useEffect(() => { close(); setCopyState('idle'); copyAttempt.current++; }, [name, suppliedDeck, accessKey]);
  useEffect(() => () => { copyAttempt.current++; fetchGeneration.current++; }, []);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { suppressFocus.current = true; button.current?.focus(); suppressFocus.current = false; close(); } };
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) close();
    };
    const resize = close;
    document.addEventListener('keydown', escape); document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize); };
  }, [open]);
  const entries = [...(deck?.cards || [])].sort((a, b) => {
    const first = catalog.get(a.cardId), second = catalog.get(b.cardId);
    return (first?.category || 4) - (second?.category || 4)
      || (first?.name || a.cardId).localeCompare(second?.name || b.cardId);
  });
  const exported = exportDecklist(deck, catalog);
  const copy = async () => {
    if (!exported.text || copyState === 'copying') return;
    cancelClose();
    const attempt = ++copyAttempt.current;
    setCopyState('copying');
    try {
      await navigator.clipboard.writeText(exported.text);
      if (attempt === copyAttempt.current) setCopyState('copied');
    } catch {
      if (attempt === copyAttempt.current) setCopyState('failed');
    }
  };
  return <>
    <span className="player-decklist-control">
    <button ref={button} type="button" className="player-decklist-trigger" aria-label={`${name} decklist`}
      aria-disabled={!available && !onUpgrade} aria-describedby={!available && !onUpgrade ? `${id}-unavailable` : undefined}
      aria-expanded={available || onUpgrade ? open : undefined} aria-controls={open ? id : undefined} aria-haspopup={available || onUpgrade ? 'dialog' : undefined}
      onMouseEnter={() => { cancelClose(); clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(show, 100); }} onMouseLeave={leave} onFocus={() => { if (!suppressFocus.current) show(); }} onBlur={leave}
      onClick={show} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(); setTimeout(() => panel.current?.focus(), 0); } }}>
      <CardsThree size={18} />
    </button>
    {!available && !onUpgrade && !open && <span id={`${id}-unavailable`} role="tooltip" className="player-decklist-unavailable">{unavailableReason || 'Decklist not available'}</span>}
    </span>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={`${name} captured decklist`}
      tabIndex={-1} className={`player-decklist-panel${!available && onUpgrade ? ' decklist-locked-preview' : ''}`} style={position} onMouseEnter={cancelClose} onMouseLeave={leave}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) leave(); }}>
      <header><div className="decklist-heading"><strong>{name === 'You' ? 'Your decklist' : `${name}’s decklist`}</strong>
        {deck && <span className="decklist-total" title="Captured starting deck">{deck.total} cards</span>}</div>
        <div className="decklist-actions">{deck && <button type="button" className="decklist-copy"
          disabled={!exported.text} aria-disabled={copyState === 'copying'} title={exported.error || 'Copy decklist for Pokémon TCG Live'} onClick={copy}>
          {copyState === 'copied' ? <Check size={15} /> : <CopySimple size={15} />}
          {copyState === 'copied' ? 'Copied' : copyState === 'copying' ? 'Copying…' : 'Copy'}
        </button>}
        <button type="button" aria-label="Close decklist" onClick={close}><X size={18} /></button></div></header>
      <span className="decklist-copy-status" role="status">{copyState === 'copied' ? 'Decklist copied for Pokémon TCG Live.' : ''}</span>
      {copyState === 'failed' && <p className="decklist-copy-error" role="alert">Couldn’t access the clipboard. Please try Copy again.</p>}
      {loadState === 'loading' && <p role="status" className="decklist-empty">Checking membership and match result…</p>}
      {loadState === 'failed' && <p role="alert" className="decklist-empty">{loadError}</p>}
      {!available && (onUpgrade ? <div className="decklist-locked-body">
        <div className="decklist-locked-grid" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <div className="study-card-placeholder" key={index}><i /><b /><em /></div>)}</div>
        <div className="decklist-locked-unlock"><span className="decklist-plan-label"><LockSimple size={13} />{upgradeLabel?.includes('Supporters') ? 'SUPPORTERS CLUB' : 'PRO'}</span><p>{upgradeLabel?.includes('Supporters') ? 'Post-match deck study' : 'See the full decklist'}</p>{upgradeLabel?.includes('Supporters') && <small>Available after the match</small>}<button type="button" onClick={onUpgrade}>{upgradeLabel?.includes('Supporters') ? 'Unlock with Supporters' : 'Unlock with Pro'}<span aria-hidden="true"> →</span></button></div>
      </div> : <div className="decklist-empty"><p>{unavailableReason || 'No decklist was saved for this match.'}</p></div>)}
      {deck ? <>{exported.error && <p className="decklist-copy-error">{exported.error}</p>}
        <div className="player-decklist-grid">{entries.map(entry => {
          return <DecklistCard key={entry.cardId} cardId={entry.cardId} count={entry.count} card={catalog.get(entry.cardId)} />;
        })}</div></> : available && loadState === 'idle' ? <p className="decklist-empty">This match has no complete starting list saved.</p> : null}
    </div>, document.body)}
  </>;
}

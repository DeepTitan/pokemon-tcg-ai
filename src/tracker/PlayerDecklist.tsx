import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { List } from '@phosphor-icons/react/List';
import { X } from '@phosphor-icons/react';
import type { CapturedDecklist, CardInfo } from './types.js';
import { cardArtUsesAlternate, resolvedCardArt, showCardBackOnError } from './card-art.js';

function DecklistCard({ cardId, count, card }: { cardId: string; count: number; card?: CardInfo }) {
  const [unavailable, setUnavailable] = useState(false);
  const [localFailed, setLocalFailed] = useState(false);
  const label = card?.name || cardId;
  useEffect(() => { setUnavailable(false); setLocalFailed(false); }, [cardId, card?.imageDataUrl]);
  return <figure title={`${count} × ${label} · ${cardId}`}>
    {unavailable ? <div className="decklist-art-unavailable" role="img" aria-label={`${label}: artwork unavailable`}>
      <strong>{label}</strong><small>{card?.setCode || cardId.split('_')[0]} · {card?.number || cardId.split('_')[1]}</small>
      {card?.hp && <span>{card.hp} HP</span>}<small>Artwork unavailable</small>
    </div> : <img key={`${cardId}:${card?.imageDataUrl || ''}`} data-card-id={cardId}
      src={resolvedCardArt(cardId, card?.imageDataUrl)} alt={label} loading="eager"
      onError={event => { setLocalFailed(true); showCardBackOnError(event); if (event.currentTarget.src.endsWith('/tracker-assets/pokemon-card-back.jpg')) setUnavailable(true); }} />}
    <b aria-label={`${count} copies`}>×{count}</b><figcaption>{label}
      {!unavailable && (!card?.imageDataUrl || localFailed) && cardArtUsesAlternate(cardId)
        && <small title="The captured printing is preserved; artwork shows a version with the same gameplay text.">Alternate artwork</small>}
    </figcaption>
  </figure>;
}

export function PlayerDecklist({ name, deck, catalog }: {
  name: string; deck?: CapturedDecklist; catalog: ReadonlyMap<string, CardInfo>;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const suppressFocus = useRef(false);
  const id = useId();
  const cancelClose = () => clearTimeout(timer.current);
  const close = () => { cancelClose(); setOpen(false); };
  const show = () => {
    cancelClose(); const rect = button.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 612)),
      top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - Math.min(570, window.innerHeight - 24))) });
    setOpen(true);
  };
  const leave = () => { cancelClose(); timer.current = setTimeout(() => {
    if (!panel.current?.contains(document.activeElement) && document.activeElement !== button.current) setOpen(false);
  }, 180); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { setOpen(false); }, [name, deck]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { suppressFocus.current = true; button.current?.focus(); suppressFocus.current = false; setOpen(false); } };
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener('keydown', escape); document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize); };
  }, [open]);
  const entries = [...(deck?.cards || [])].sort((a, b) => {
    const first = catalog.get(a.cardId), second = catalog.get(b.cardId);
    return (first?.category || 4) - (second?.category || 4)
      || (first?.name || a.cardId).localeCompare(second?.name || b.cardId);
  });
  return <>
    <button ref={button} type="button" className="player-decklist-trigger" aria-label={`${name} decklist`}
      aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
      onMouseEnter={show} onMouseLeave={leave} onFocus={() => { if (!suppressFocus.current) show(); }} onBlur={leave}
      onClick={show} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(); setTimeout(() => panel.current?.focus(), 0); } }}>
      <List size={17} weight="bold" />
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={`${name} captured decklist`}
      tabIndex={-1} className="player-decklist-panel" style={position} onMouseEnter={cancelClose} onMouseLeave={leave}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) leave(); }}>
      <header><div><strong>{name}’s decklist</strong><p>{deck ? `${deck.total} cards · Captured at match start` : 'Decklist not captured'}</p></div>
        <button type="button" aria-label="Close decklist" onClick={close}><X size={18} /></button></header>
      {deck ? <><p className="decklist-disclaimer">Starting list, not current hand, prizes, or deck order.</p>
        <div className="player-decklist-grid">{entries.map(entry => {
          return <DecklistCard key={entry.cardId} cardId={entry.cardId} count={entry.count} card={catalog.get(entry.cardId)} />;
        })}</div></> : <p className="decklist-empty">This match has no complete starting list saved. Cards revealed during play are not treated as a full decklist.</p>}
    </div>, document.body)}
  </>;
}

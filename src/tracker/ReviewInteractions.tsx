import { createContext, useContext, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CardsThree } from '@phosphor-icons/react/CardsThree';
import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { LockKey } from '@phosphor-icons/react/LockKey';
import { MagnifyingGlass } from '@phosphor-icons/react/MagnifyingGlass';
import { X } from '@phosphor-icons/react/X';
import type { Card, PokemonInPlay } from '../engine/types.js';
import { cardSourceIdFromReviewCard } from './card-adapter.js';
import { sortCardsForDisplay } from './card-order-model.js';
import { publicCardArtUrl, resolvedCardArt, showCardBackOnError } from './card-art.js';
import type { CardInfo, ReviewAppliedEffect, ReviewCardVisibility, ReviewSelection } from './types.js';

export type ReviewInspector =
  | { kind: 'card'; card: Card; pokemon?: PokemonInPlay; effects?: ReviewAppliedEffect[]; title?: string }
  | { kind: 'zone'; title: string; subtitle: string; cards: Card[]; visibility: Record<string, ReviewCardVisibility> }
  | { kind: 'selection'; selection: ReviewSelection; sourceName?: string };

const CardCatalogContext = createContext<ReadonlyMap<string, CardInfo>>(new Map());

function catalogCardFor(card: Card, catalog: ReadonlyMap<string, CardInfo>): CardInfo | undefined {
  const sourceId = cardSourceIdFromReviewCard(card);
  return sourceId ? catalog.get(sourceId) || catalog.get(sourceId.toLowerCase()) : undefined;
}

function CardName({ card }: { card: Card }) {
  const catalog = useContext(CardCatalogContext);
  return <>{catalogCardFor(card, catalog)?.name || card.name}</>;
}

function CardImage({ card, hidden = false }: { card: Card; hidden?: boolean }) {
  const catalog = useContext(CardCatalogContext);
  if (hidden) return <span className="review-card-back"><CardsThree size={28} weight="duotone" /><small>Hidden</small></span>;
  const sourceId = cardSourceIdFromReviewCard(card);
  const resolved = catalogCardFor(card, catalog);
  return <img src={resolvedCardArt(sourceId, card.imageUrl || resolved?.imageDataUrl)} data-card-id={sourceId} alt={resolved?.name || card.name} onError={showCardBackOnError} />;
}

function CardInspector({ card }: { card: Card }) {
  const catalog = useContext(CardCatalogContext);
  const sourceId = cardSourceIdFromReviewCard(card);
  const resolved = catalogCardFor(card, catalog);
  const fallback = resolvedCardArt(sourceId, card.imageUrl || resolved?.imageDataUrl);
  const publicArt = publicCardArtUrl(sourceId);
  // The public Pokémon catalog provides a full-resolution printing alongside
  // its small grid image. Limitless LG assets are already full size.
  const artwork = publicArt?.includes('images.pokemontcg.io/')
    ? publicArt.replace(/\.png$/, '_hires.png') : publicArt || fallback;
  return <img className="card-lightbox-art" src={artwork} alt={resolved?.name || card.name}
    data-card-id={sourceId} onError={(event) => {
      const image = event.currentTarget;
      if (!image.dataset.localFallbackTried) {
        image.dataset.localFallbackTried = 'true';
        image.src = fallback;
      } else showCardBackOnError(event);
    }} />;
}

function ZoneInspector({ inspector, onInspectCard }: { inspector: Extract<ReviewInspector, { kind: 'zone' }>; onInspectCard: (card: Card) => void }) {
  const catalog = useContext(CardCatalogContext);
  const orderedCards = sortCardsForDisplay(inspector.cards, (card) => catalogCardFor(card, catalog)?.name || card.name);
  const knownCount = orderedCards.filter((card) => inspector.visibility[card.id] !== 'hidden').length;
  const groups: { card: Card; count: number; hidden: boolean }[] = [];
  const byPrinting = new Map<string, typeof groups[number]>();
  for (const card of orderedCards) {
    const hidden = inspector.visibility[card.id] === 'hidden';
    const printing = !hidden && cardSourceIdFromReviewCard(card);
    const existing = printing ? byPrinting.get(printing) : undefined;
    if (existing) existing.count++;
    else {
      const group = { card, count: 1, hidden };
      groups.push(group);
      if (printing) byPrinting.set(printing, group);
    }
  }
  return <>
    <div className="zone-summary"><span>{orderedCards.length} cards{knownCount < orderedCards.length && <small> · {orderedCards.length - knownCount} hidden</small>}</span><p>{inspector.subtitle}</p></div>
    <div className="review-card-grid">{groups.map(({ card, count, hidden }, index) => {
      const label = hidden ? 'Unknown card' : catalogCardFor(card, catalog)?.name || card.name;
      return <button type="button" className={hidden ? 'hidden' : ''} key={`${card.id}-${index}`} disabled={hidden} title={label} aria-label={count > 1 ? `${label}, ${count} copies` : label} onClick={() => onInspectCard(card)}><CardImage card={card} hidden={hidden} />{count > 1 && <b className="zone-card-count" aria-hidden="true">×{count}</b>}</button>;
    })}{!orderedCards.length && <div className="empty-zone"><CardsThree size={42} weight="duotone" /><strong>This zone is empty</strong><span>There were no cards here at this point in the match.</span></div>}</div>
  </>;
}

function SelectionInspector({ selection, sourceName, onInspectCard }: { selection: ReviewSelection; sourceName?: string; onInspectCard: (card: Card) => void }) {
  const selected = new Set(selection.selectedOptionIds);
  const eligible = new Set(selection.eligibleOptionIds);
  const resultOnly = selection.candidateVisibility === 'private';
  const hasCardOptions = selection.allOptionIds.length > 0 || selection.optionCards.length > 0;
  const choiceTitle = hasCardOptions ? (sourceName ? `${sourceName} searched` : 'Card selection') : selection.kind === 'damage' ? 'Damage placement' : 'Captured decision';
  const choiceDetail = resultOnly
    ? `${selection.selectedOptionIds.length} selected · the opponent's candidate list remained private, but the resulting card movement was captured exactly`
    : hasCardOptions
    ? `${selection.allOptionIds.length} cards viewed · ${selection.eligibleOptionIds.length} eligible · choose ${selection.minimum === selection.maximum ? selection.maximum : `${selection.minimum}–${selection.maximum}`}`
    : selection.completed ? 'This decision was resolved in the captured action.' : 'This decision was still pending when captured.';
  return <>
    <div className="selection-summary"><span className="selection-search-icon"><MagnifyingGlass size={22} weight="bold" /></span><div><small>Historical choice</small><strong>{choiceTitle}</strong><p>{choiceDetail}</p></div><span className={selection.completed ? 'complete' : ''}>{selection.completed ? <><CheckCircle size={15} weight="fill" /> Resolved</> : 'Pending'}</span></div>
    {hasCardOptions && <div className="selection-legend">{!resultOnly && <span><i className="eligible" />Eligible</span>}<span><i className="selected" />Selected</span>{!resultOnly && <span><LockKey size={13} />Not a valid option</span>}</div>}
    <div className="review-card-grid selection-grid">{selection.optionCards.map((card, index) => {
      const id = resultOnly ? card.id : selection.allOptionIds[index] || card.id;
      const isEligible = resultOnly || eligible.has(id);
      const isSelected = selected.has(id);
      const hidden = card.name === 'Hidden card';
      return <button type="button" key={`${id}-${index}`} className={`${isEligible ? 'eligible' : 'ineligible'} ${isSelected ? 'selected' : ''} ${hidden ? 'hidden' : ''}`} disabled={hidden} onClick={() => onInspectCard(card)}><CardImage card={card} hidden={hidden} />{isSelected && <b><CheckCircle size={15} weight="fill" /> Chosen</b>}<span>{hidden ? 'Private card' : <CardName card={card} />}</span></button>;
    })}{!hasCardOptions && <div className="empty-zone"><MagnifyingGlass size={42} weight="duotone" /><strong>No card list for this decision</strong><span>The captured choice changed the reconstructed board directly.</span></div>}</div>
  </>;
}

export function ReviewOverlay({ inspector, catalog, onClose, onInspectCard }: { inspector: ReviewInspector | null; catalog: ReadonlyMap<string, CardInfo>; onClose: () => void; onInspectCard: (card: Card, pokemon?: PokemonInPlay) => void }) {
  useEffect(() => {
    if (!inspector) return undefined;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [inspector, onClose]);
  if (!inspector) return null;
  if (inspector.kind === 'card') return createPortal(
    <CardCatalogContext.Provider value={catalog}>
      <div className="card-lightbox-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="card-lightbox" role="dialog" aria-modal="true" aria-label={catalogCardFor(inspector.card, catalog)?.name || inspector.card.name}>
          <CardInspector key={inspector.card.id} card={inspector.card} />
          <button className="card-lightbox-close" type="button" onClick={onClose} aria-label="Close card" autoFocus><X size={20} weight="bold" /></button>
        </div>
      </div>
    </CardCatalogContext.Provider>, document.body);
  const title = inspector.kind === 'zone' ? inspector.title : 'Search replay';
  return <CardCatalogContext.Provider value={catalog}><div className="review-overlay-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><article className={`review-overlay review-${inspector.kind}`} role="dialog" aria-modal="true" aria-label={title}><header><div>{inspector.kind !== 'zone' && <span>{inspector.kind === 'selection' ? 'Exact captured choice' : 'Match card'}</span>}<h2>{title}</h2></div><button type="button" onClick={onClose} aria-label="Close inspector"><X size={21} weight="bold" /></button></header><div className="review-overlay-body">{inspector.kind === 'zone' && <ZoneInspector inspector={inspector} onInspectCard={onInspectCard} />}{inspector.kind === 'selection' && <SelectionInspector selection={inspector.selection} sourceName={inspector.sourceName} onInspectCard={onInspectCard} />}</div></article></div></CardCatalogContext.Provider>;
}

import { createContext, useContext, useEffect } from 'react';
import { CardsThree, CheckCircle, Eye, LockKey, MagnifyingGlass, X } from '@phosphor-icons/react';
import {
  CardType,
  type EnergyType,
  type Card,
  type EnergyCard,
  type PokemonCard,
  type PokemonInPlay,
  type TrainerCard,
} from '../engine/types.js';
import { cardInfoToEngineCard, cardRulesText, cardSourceIdFromReviewCard } from './card-adapter.js';
import { countEnergyTypes, EnergyBadge, energyTypeLabel } from './EnergyBadge.js';
import { resolvedCardArt, showCardBackOnError } from './card-art.js';
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
  return <img src={resolvedCardArt(sourceId, card.imageUrl || resolved?.imageDataUrl)} alt={resolved?.name || card.name} onError={showCardBackOnError} />;
}

function EnergyPips({ types }: { types: EnergyType[] }) {
  if (!types.length) return <span className="free-cost">Free</span>;
  return <span className="energy-pips">{countEnergyTypes(types).map(({ type, count }) => <EnergyBadge key={type} type={type} count={count} />)}</span>;
}

function EnergyDetails({ card, rules }: { card: EnergyCard; rules: string }) {
  const provided = countEnergyTypes(card.provides.length ? card.provides : [card.energyType]);
  const description = provided.map(({ type, count }) => `${count > 1 ? `${count} ` : ''}${energyTypeLabel(type)}`).join(' + ');
  return <>
    <section className="energy-card-summary">
      <div className="energy-card-types">{provided.map(({ type, count }) => <EnergyBadge key={type} type={type} count={count} />)}</div>
      <div><small>{card.energySubtype} Energy</small><strong>Provides {description} Energy</strong></div>
    </section>
    {rules && <section className="rules-copy"><span>Card text</span><p>{rules}</p></section>}
  </>;
}

function PokemonDetails({ pokemon, onInspectCard }: { pokemon: PokemonInPlay; onInspectCard: (card: Card, pokemon?: PokemonInPlay) => void }) {
  const card = pokemon.card;
  const previousStages: PokemonInPlay[] = [];
  let previous = pokemon.previousStage;
  while (previous) { previousStages.unshift(previous); previous = previous.previousStage; }
  const attachments = [
    ...previousStages.map((stage) => ({ label: 'Evolution', card: stage.card })),
    ...pokemon.attachedEnergy.map((energy) => ({ label: 'Energy', card: energy })),
    ...pokemon.attachedTools.map((tool) => ({ label: 'Tool', card: tool })),
  ];
  return <>
    <div className="pokemon-vitals"><span><b>{pokemon.currentHp}</b> / {card.hp} HP</span><span>{pokemon.damageCounters * 10} damage</span><span>{card.stage}</span></div>
    {card.ability && <section className="card-action ability-action"><span>Ability</span><div><strong>{card.ability.name}</strong><p>{card.ability.description || 'No additional rules text.'}</p></div></section>}
    {card.attacks.map((attack) => <section className="card-action" key={attack.name}><EnergyPips types={attack.cost} /><div><strong>{attack.name}<b>{attack.damage || ''}</b></strong><p>{attack.description || 'No additional effect.'}</p></div></section>)}
    <div className="card-stats"><span><small>Weakness</small><b>{card.weakness || '—'}</b></span><span><small>Resistance</small><b>{card.resistance ? `${card.resistance} ${card.resistanceValue || ''}` : '—'}</b></span><span><small>Retreat</small><b>{card.retreatCost}</b></span></div>
    {(attachments.length > 0 || pokemon.statusConditions.length > 0) && <section className="attachment-section"><div><span>Attached & underneath</span><small>{attachments.length} cards</small></div><div className="attachment-list">{attachments.map(({ label, card: attachedCard }) => <button type="button" key={`${label}-${attachedCard.id}`} onClick={() => onInspectCard(attachedCard)}><CardImage card={attachedCard} /><span><small>{label}</small><strong>{attachedCard.name}</strong></span></button>)}</div>{pokemon.statusConditions.length > 0 && <div className="status-list">{pokemon.statusConditions.map((status) => <span key={status}>{status}</span>)}</div>}</section>}
  </>;
}

function CardInspector({ card, pokemon, effects = [], catalog, onInspectCard }: { card: Card; pokemon?: PokemonInPlay; effects?: ReviewAppliedEffect[]; catalog: ReadonlyMap<string, CardInfo>; onInspectCard: (card: Card, pokemon?: PokemonInPlay) => void }) {
  const sourceId = cardSourceIdFromReviewCard(card);
  const catalogCard = catalogCardFor(card, catalog) || [...catalog.values()].find((candidate) => candidate.name === card.name);
  const detailCard = !pokemon && catalogCard ? cardInfoToEngineCard(catalogCard, card.id, card.name, sourceId) : card;
  const rules = cardRulesText(detailCard, catalogCard);
  return <div className="card-inspector-layout">
    <div className="inspector-art"><CardImage card={card} /><span>{detailCard.cardNumber || 'Captured card'}</span></div>
    <div className="inspector-card-copy">
      <div className="inspector-eyebrow">{detailCard.cardType === CardType.Pokemon ? (detailCard as PokemonCard).stage : detailCard.cardType === CardType.Trainer ? (detailCard as TrainerCard).trainerType : (detailCard as EnergyCard).energySubtype}</div>
      <h2>{catalogCard?.name || detailCard.name}</h2>
      {detailCard.cardType === CardType.Pokemon && pokemon
        ? <PokemonDetails pokemon={pokemon} onInspectCard={onInspectCard} />
        : detailCard.cardType === CardType.Pokemon
          ? <><div className="pokemon-vitals"><span><b>{(detailCard as PokemonCard).hp}</b> HP</span><span>{(detailCard as PokemonCard).stage}</span></div>{(detailCard as PokemonCard).ability && <section className="card-action ability-action"><span>Ability</span><div><strong>{(detailCard as PokemonCard).ability!.name}</strong><p>{(detailCard as PokemonCard).ability!.description}</p></div></section>}{(detailCard as PokemonCard).attacks.map((attack) => <section className="card-action" key={attack.name}><EnergyPips types={attack.cost} /><div><strong>{attack.name}<b>{attack.damage || ''}</b></strong><p>{attack.description}</p></div></section>)}</>
          : detailCard.cardType === CardType.Energy
            ? <EnergyDetails card={detailCard as EnergyCard} rules={rules} />
            : <section className="rules-copy"><span>Card text</span><p>{rules || 'The local card database did not include additional rules text for this printing.'}</p></section>}
      {effects.length > 0 && <section className="captured-effects"><div><span>Effects on this card</span><small>at this action</small></div>{effects.map((effect) => <article key={effect.id} className={effect.enabled ? '' : 'disabled'}><i /><span><strong>{effect.name}</strong><small>{effect.effectType || 'Rule effect'}{effect.remainingDuration != null && effect.remainingDuration >= 0 ? ` · ${effect.remainingDuration} remaining` : ''}</small></span></article>)}</section>}
    </div>
  </div>;
}

function ZoneInspector({ inspector, onInspectCard }: { inspector: Extract<ReviewInspector, { kind: 'zone' }>; onInspectCard: (card: Card) => void }) {
  const knownCount = inspector.cards.filter((card) => inspector.visibility[card.id] !== 'hidden').length;
  return <>
    <div className="zone-summary"><div><Eye size={18} weight="duotone" /><span><strong>{knownCount} visible</strong><small>{inspector.cards.length - knownCount} hidden</small></span></div><p>{inspector.subtitle}</p></div>
    <div className="review-card-grid">{inspector.cards.map((card, index) => {
      const hidden = inspector.visibility[card.id] === 'hidden';
      return <button type="button" className={hidden ? 'hidden' : ''} key={`${card.id}-${index}`} disabled={hidden} onClick={() => onInspectCard(card)}><CardImage card={card} hidden={hidden} /><span>{hidden ? 'Unknown card' : <CardName card={card} />}</span></button>;
    })}{!inspector.cards.length && <div className="empty-zone"><CardsThree size={42} weight="duotone" /><strong>This zone is empty</strong><span>There were no cards here at this point in the match.</span></div>}</div>
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
  const title = inspector.kind === 'card' ? inspector.title || 'Card details' : inspector.kind === 'zone' ? inspector.title : 'Search replay';
  return <CardCatalogContext.Provider value={catalog}><div className="review-overlay-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><article className={`review-overlay review-${inspector.kind}`} role="dialog" aria-modal="true" aria-label={title}><header><div><span>{inspector.kind === 'selection' ? 'Exact captured choice' : inspector.kind === 'zone' ? 'Board zone' : 'Match card'}</span><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label="Close inspector"><X size={21} weight="bold" /></button></header><div className="review-overlay-body">{inspector.kind === 'card' && <CardInspector card={inspector.card} pokemon={inspector.pokemon} effects={inspector.effects} catalog={catalog} onInspectCard={onInspectCard} />}{inspector.kind === 'zone' && <ZoneInspector inspector={inspector} onInspectCard={onInspectCard} />}{inspector.kind === 'selection' && <SelectionInspector selection={inspector.selection} sourceName={inspector.sourceName} onInspectCard={onInspectCard} />}</div></article></div></CardCatalogContext.Provider>;
}

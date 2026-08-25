import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  BookOpenText, CardsThree, CaretLeft, CaretRight, CheckCircle,
  Drop, Eye, FunnelSimple, GearSix, Hand, Leaf, List, MagnifyingGlass, Pause, Play,
  ShieldCheck, SkipBack, SkipForward, Sparkle, Sword, Trophy, WifiHigh, Wrench, X,
} from '@phosphor-icons/react';
import { Coin } from '@phosphor-icons/react/Coin';
import { Prohibit } from '@phosphor-icons/react/Prohibit';
import { ArrowDown } from '@phosphor-icons/react/ArrowDown';
import { ArrowUp } from '@phosphor-icons/react/ArrowUp';
import type { Card, PlayerState, PokemonInPlay } from '../engine/types.js';
import { parseBattleLog } from './battle-log-parser.js';
import { DEMO_BATTLE_LOG } from './demo-log.js';
import {
  getCloudSyncStatus, getRecentMatchOperations, getTrackerEnvironment, initializeTrackerStorage, isTauri, listMatchSummaries,
  listRawMatchIds, loadMatchOperations, loadMatchReview, onMatchOperation, persistMatchReview,
  requestCapturePermission, resolveCardSources, setCloudSyncEnabled, startTracking, stopTracking,
  type CloudSyncStatus,
} from './tauri.js';
import { LiveReviewAssembler } from './live-operation-reducer.js';
import { ReviewOverlay, type ReviewInspector } from './ReviewInteractions.js';
import { trackedTurnToCanonical } from './review-state-adapter.js';
import { cardInfoToEngineCard, cardSourceIdFromReviewCard } from './card-adapter.js';
import { countEnergyTypes, EnergyBadge, findEnergyType } from './EnergyBadge.js';
import { buildTimeline, eventKeyForReviewIndex } from './timeline-model.js';
import { cardEffectSummary } from './card-effect-model.js';
import { attackResolutionForTurn, type AttackResolution } from './attack-resolution-model.js';
import { damageChangesForTurn, type PokemonDamageChange } from './damage-change-model.js';
import { positionChangesForTurn, type PokemonPositionChange } from './position-change-model.js';
import { buildAttackStops, stepAttack } from './turn-navigation-model.js';
import { deriveReviewTurnStatus, type PlayerTurnStatus } from './turn-status-model.js';
import { capturedAtIso, collectCardSourceIds, finalizeReviewForClientExit, matchSummaryFromReview, operationKey, recordingSummaryFromOperation, REDUCER_VERSION } from './match-storage.js';
import { initialClientLifecycleState, observeClientLifecycle } from './client-lifecycle-model.js';
import { UpdateNotice } from './UpdateNotice.js';
import type {
  CapturedOperation, CardInfo, CanonicalReviewState, MatchReview, MatchSummary, ReviewCardVisibility, ReviewSelection, TrackedCard, TrackedChoiceCard, TrackedPlayerBoard,
  TrackedPokemon, TrackedTurn, TrackerEnvironment, TrackerEventKind,
} from './types.js';
import './tracker.css';

// Keep the legacy key so the rebrand never strands a user's saved match archive.
const STORAGE_KEY = 'match-lens/reviews-v1';
const STORAGE_MIGRATED_KEY = 'trace/reviews-sqlite-v1';
const MAX_REVIEWS = 24;

function beginWindowDrag(event: ReactMouseEvent<HTMLElement>): void {
  if (event.button !== 0 || !isTauri()) return;
  const target = event.target as HTMLElement;
  if (target.closest('button, input, textarea, select, a, [role="button"]')) return;
  event.preventDefault();
  void getCurrentWindow().startDragging().catch((error) => {
    console.error('Could not start window drag', error);
  });
}

const EVENT_LABELS: Record<TrackerEventKind, string> = {
  setup: 'Setup', draw: 'Draw', pokemon: 'Pokémon', trainer: 'Trainer', tool: 'Tool', energy: 'Energy',
  ability: 'Ability', attack: 'Attack', damage: 'Damage', coin: 'Coin flip', knockout: 'KO', prize: 'Prize',
  stadium: 'Stadium', system: 'Game',
};

const TRAINER_ART = [
  '/tracker-assets/trainer-riley.png', '/tracker-assets/trainer-jordan.png',
  '/tracker-assets/trainer-casey.png',
];

function loadReviews(): MatchReview[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((review) => review?.source !== 'live-network') : [];
  } catch {
    return [];
  }
}

function saveReviews(reviews: MatchReview[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews.filter((review) => review.source !== 'live-network').slice(0, MAX_REVIEWS)));
}

function initialReviews(): MatchReview[] {
  return isTauri() ? [] : loadReviews();
}

function formatMatchDate(iso: string): string {
  const date = new Date(capturedAtIso(iso));
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  if (sameDay) return `Today, ${time}`;
  return `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)}, ${time}`;
}

function prizesRemaining(board: TrackedPlayerBoard): number {
  return Math.max(0, 6 - board.prizesTaken);
}

function approximateDeckCount(board: TrackedPlayerBoard): number {
  const fielded = board.bench.length + (board.active ? 1 : 0);
  return Math.max(0, 60 - board.handCount - board.discard.length - prizesRemaining(board) - fielded);
}

function fallbackCardArt(name: string): string {
  return '/tracker-assets/pokemon-card-back.jpg';
}

function selectedCardNames(selection: ReviewSelection | undefined): string[] {
  if (!selection) return [];
  const selected = new Set(selection.selectedOptionIds);
  return selection.optionCards.filter((card) => selected.has(card.id)).map((card) => card.name);
}

function resolvedCardInfo(card: TrackedCard, catalog: ReadonlyMap<string, CardInfo>): CardInfo | undefined {
  return card.cardId ? catalog.get(card.cardId) || catalog.get(card.cardId.toLowerCase()) : undefined;
}

function resolvedCardImage(card: TrackedCard, catalog: ReadonlyMap<string, CardInfo>): string {
  return card.imageDataUrl
    || resolvedCardInfo(card, catalog)?.imageDataUrl
    || fallbackCardArt(card.name);
}

function EventIcon({ kind, size = 17 }: { kind: TrackerEventKind; size?: number }) {
  const props = { size, weight: 'fill' as const };
  switch (kind) {
    case 'attack': return <Sword {...props} />;
    case 'ability': return <Sparkle {...props} />;
    case 'energy': return <Drop {...props} />;
    case 'tool': return <Wrench {...props} />;
    case 'coin': return <Coin {...props} />;
    case 'stadium': return <ShieldCheck {...props} />;
    case 'pokemon': return <Eye {...props} />;
    case 'knockout': return <Trophy {...props} />;
    case 'trainer': return <Hand {...props} />;
    case 'draw': return <CardsThree {...props} />;
    default: return <BookOpenText {...props} />;
  }
}

function StadiumMarker({
  card,
  name,
  owner,
  localPlayer,
  opponent,
  onOpen,
}: {
  card: Card | null;
  name?: string;
  owner?: string;
  localPlayer: string;
  opponent: string;
  onOpen: (card: Card) => void;
}) {
  if (!name) return null;
  const ownerClass = owner === localPlayer ? 'owned-local' : owner === opponent ? 'owned-opponent' : '';
  const context = `${name} is in play${owner ? ` · Played by ${owner}` : ''}`;
  const content = <>
    <span className={`stadium-card-peek ${card ? '' : 'fallback'}`} aria-hidden="true">
      {card ? <img src={card.imageUrl || fallbackCardArt(name)} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = fallbackCardArt(name); }} /> : <ShieldCheck size={14} weight="fill" />}
    </span>
    <span className="stadium-copy"><small>Stadium</small><strong>{name}</strong></span>
  </>;
  return card
    ? <button type="button" className={`stadium-marker ${ownerClass}`} onClick={() => onOpen(card)} aria-label={`${context}. Open card details.`} title={`${context} · Click to inspect`}>{content}</button>
    : <div className={`stadium-marker ${ownerClass}`} aria-label={context} title={context}>{content}</div>;
}

function PokemonSlot({ pokemon, catalog, active = false, defeated = false, attacking = false, damageChange, positionChange, onOpen }: { pokemon: TrackedPokemon | null; catalog: ReadonlyMap<string, CardInfo>; active?: boolean; defeated?: boolean; attacking?: boolean; damageChange?: PokemonDamageChange; positionChange?: PokemonPositionChange; onOpen?: (id: string) => void }) {
  if (!pokemon) {
    return <div className={`pokemon-slot empty ${active ? 'active' : ''}`}><CardsThree size={active ? 30 : 22} weight="duotone" /><span>{active ? 'Active' : 'Bench'}</span></div>;
  }
  const image = resolvedCardImage(pokemon, catalog);
  const displayName = resolvedCardInfo(pokemon, catalog)?.name || pokemon.name;
  const displayedDamage = damageChange?.after ?? pokemon.damage;
  const energyAttachments = pokemon.energies.map((name, index) => {
    const card = pokemon.energyCards?.[index];
    const info = card?.cardId ? catalog.get(card.cardId) || catalog.get(card.cardId.toLowerCase()) : undefined;
    const displayName = info?.name || card?.name || name;
    return {
      card,
      displayName,
      special: Boolean(card) && !/^Basic\b/i.test(displayName),
      type: findEnergyType(info?.cardType, card?.cardType, card?.name, name),
    };
  });
  const basicEnergyTypes = energyAttachments
    .filter((attachment) => !attachment.special)
    .map((attachment) => attachment.type)
    .filter((type): type is NonNullable<typeof type> => Boolean(type));
  const specialEnergies = energyAttachments.filter((attachment) => attachment.special && attachment.card);
  const tools = pokemon.toolCards || [];
  return (
    <button type="button" className={`pokemon-slot ${active ? 'active' : ''} ${defeated ? 'defeated' : ''} ${attacking ? 'attacking' : ''} ${damageChange ? damageChange.delta > 0 ? 'damage-increased' : 'damage-decreased' : ''} ${positionChange ? `position-changed moved-to-${positionChange.to}` : ''}`} data-pokemon-id={pokemon.id} data-pokemon-name={displayName} title={`Inspect ${displayName}${pokemon.cardId ? ` · ${pokemon.cardId}` : ''}`} onClick={() => onOpen?.(pokemon.id)}>
      <img className="card-art" src={image} alt={displayName} />
      {displayedDamage > 0 && <b className="damage-token">{displayedDamage}</b>}
      {damageChange && <span className={`damage-change-badge ${damageChange.delta > 0 ? 'added' : 'removed'}`} aria-label={damageChange.delta > 0 ? `${damageChange.delta} damage added; ${damageChange.after} total damage` : `${Math.abs(damageChange.delta)} damage removed; ${damageChange.after} total damage`}><b>{damageChange.delta > 0 ? '+' : '−'}{Math.abs(damageChange.delta)}</b><small>damage</small></span>}
      {positionChange && <span className={`position-change-badge to-${positionChange.to}`} aria-label={`${displayName} moved from ${positionChange.from} to ${positionChange.to} by ${positionChange.cause}`} title={`${positionChange.from === 'active' ? 'Active' : 'Bench'} → ${positionChange.to === 'active' ? 'Active' : 'Bench'} · ${positionChange.cause}`}>
        {positionChange.to === 'active' ? <ArrowUp size={10} weight="bold" /> : <ArrowDown size={10} weight="bold" />}
        <b>{positionChange.to === 'active' ? 'Active' : 'Bench'}</b>
      </span>}
      {energyAttachments.length > 0 && <span className="attached-energy-preview" aria-label={`${pokemon.energies.join(', ')} attached`}>
        {specialEnergies.slice(-2).map(({ card, displayName }) => <span className="special-energy-card" title={`${displayName} · Special Energy`} key={card!.id}><img src={resolvedCardImage(card!, catalog)} alt="" /></span>)}
        {specialEnergies.length > 2 && <b className="special-energy-overflow" aria-label={`${specialEnergies.length - 2} more Special Energy cards`}>+{specialEnergies.length - 2}</b>}
        {countEnergyTypes(basicEnergyTypes).map(({ type, count }) => <EnergyBadge key={type} type={type} count={count} compact />)}
      </span>}
      {tools.length > 0 && <span className="attached-tool-preview" aria-label={`${tools.map((tool) => `${resolvedCardInfo(tool, catalog)?.name || tool.name} Tool`).join(', ')} attached`}>{tools.slice(-2).map((tool) => { const name = resolvedCardInfo(tool, catalog)?.name || tool.name; return <span className="attached-tool-card" title={`${name} · Pokémon Tool`} key={tool.id}><img src={resolvedCardImage(tool, catalog)} alt="" /><small>Tool</small></span>; })}</span>}
      {defeated && <span className="knockout-stamp" aria-label="Knocked out"><b>KO</b><small>Knocked out</small></span>}
    </button>
  );
}

interface TurnChoiceFrame {
  reviewIndex: number;
  actor: string;
  label: string;
  cards: TrackedChoiceCard[];
  events: Array<{ id: string; kind: TrackerEventKind; text: string }>;
}

function withoutActorPrefix(text: string, actor: string): string {
  return text.replace(new RegExp(`^${actor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`, 'i'), '');
}

function actionCardsForTurn(turn: TrackedTurn, catalog: ReadonlyMap<string, CardInfo>): TrackedChoiceCard[] {
  const cards = [...(turn.choiceCards || [])];
  const promotionOnly = cards.some((card) => card.choiceRole === 'promoted')
    && !cards.some((card) => card.choiceRole === 'action');
  if (promotionOnly) return cards;
  const actionCardIds = new Set(cards
    .filter((card) => card.choiceRole === 'action' && card.cardId)
    .map((card) => card.cardId!.toLowerCase()));

  turn.events.forEach((event) => {
    if (!event.cardId || actionCardIds.has(event.cardId.toLowerCase())) return;
    const info = catalog.get(event.cardId) || catalog.get(event.cardId.toLowerCase());
    if (!info) return;
    cards.unshift({
      id: `${turn.index}:action:${info.id}`,
      cardId: info.id,
      name: info.name,
      imageDataUrl: info.imageDataUrl,
      cardType: info.cardType,
      choiceRole: 'action',
    });
    actionCardIds.add(event.cardId.toLowerCase());
  });

  return cards;
}

function actionEventsForTurn(turn: TrackedTurn): TurnChoiceFrame['events'] {
  const actor = turn.player || '';
  const grouped = new Map<string, { id: string; kind: TrackerEventKind; text: string; count: number; targetIds: Set<string> }>();
  turn.events
    .filter((event) => !event.detail)
    .map((event) => ({ ...event, text: actor ? withoutActorPrefix(event.text, actor) : event.text }))
    .forEach((event) => {
      const key = event.text.trim().toLowerCase();
      if (!key) return;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { id: event.id, kind: event.kind, text: event.text, count: 1, targetIds: new Set(event.targetEntityId ? [event.targetEntityId] : []) });
        return;
      }
      if (event.targetEntityId && existing.targetIds.has(event.targetEntityId)) return;
      if (event.targetEntityId) existing.targetIds.add(event.targetEntityId);
      existing.count += 1;
    });
  const events = [...grouped.values()].map(({ id, kind, text, count }) => ({ id, kind, text: count > 1 ? `${text} ×${count}` : text }));
  if (events.length) return events;
  return [{ id: `${turn.index}:summary`, kind: 'system', text: turn.choiceLabel || (actor ? `${actor}'s action` : turn.label) }];
}

function isSupportingActionEvent(event: TurnChoiceFrame['events'][number]): boolean {
  return !/^made (?:a|an) (?:damage|entity) selection\b/i.test(event.text);
}

function ChoiceStage({ boardName, frames, currentReviewIndex, catalog, onOpen }: { boardName: string; frames: TurnChoiceFrame[]; currentReviewIndex: number; catalog: ReadonlyMap<string, CardInfo>; onOpen: (card: TrackedCard) => void }) {
  const [showTurn, setShowTurn] = useState(false);
  const currentFrame = frames.find((frame) => frame.reviewIndex === currentReviewIndex);
  useEffect(() => setShowTurn(false), [currentReviewIndex]);
  if (!currentFrame) return null;

  const currentActionIsAttack = currentFrame.events.some((event) => event.kind === 'attack');
  const choices = (showTurn ? frames : [currentFrame])
    .flatMap((frame) => frame.cards.map((card) => ({ card, frame })))
    .filter(({ card, frame }) => showTurn || frame.reviewIndex !== currentReviewIndex || !currentActionIsAttack || card.choiceRole !== 'action');
  const focusedEvents = (showTurn ? currentFrame.events : currentFrame.events.filter(isSupportingActionEvent));
  const primaryEvent = focusedEvents[0] || currentFrame.events[0];
  const supportingCopy = focusedEvents.slice(1).map((event) => event.text).join(' · ');
  const canSeeTurn = frames.some((frame) => frame.reviewIndex !== currentReviewIndex && frame.cards.length > 0);
  return <aside className={`choice-stage has-current ${showTurn ? 'show-turn' : 'show-action'} ${choices.length ? '' : 'story-only'}`} aria-label={`${boardName} ${showTurn ? 'cards this turn' : 'current action'}`}>
    <div className="choice-stage-heading">
      <span>{showTurn ? 'This turn' : 'This action'}</span>
      {canSeeTurn && <button type="button" className="see-turn-button" aria-pressed={showTurn} onClick={() => setShowTurn((value) => !value)}>{showTurn ? 'See action' : 'See turn'}</button>}
    </div>
    <div className="choice-stage-story">
      {primaryEvent && <span className="primary"><EventIcon kind={primaryEvent.kind} size={14} /><strong>{primaryEvent.text}</strong></span>}
      {supportingCopy && <span className="supporting-summary"><strong>{supportingCopy}</strong></span>}
    </div>
    <div className="choice-stage-cards">
      {choices.map(({ card, frame }, index) => {
        const info = resolvedCardInfo(card, catalog);
        const name = info?.name || card.name;
        const current = frame.reviewIndex === currentReviewIndex;
        const roleCopy = card.choiceRole === 'discarded' ? 'Discarded card' : card.choiceRole === 'chosen' ? 'Chosen card' : card.choiceRole === 'promoted' ? 'Promoted to Active' : 'Action card';
        return <button type="button" className={`choice-card role-${card.choiceRole} ${current ? 'current' : ''}`} aria-current={current ? 'step' : undefined} aria-label={`${roleCopy}: ${name}`} title={`${frame.label} · ${roleCopy}: ${name}`} onClick={() => onOpen(card)} key={`${frame.reviewIndex}-${card.id}-${index}`}><img src={resolvedCardImage(card, catalog)} alt={name} /></button>;
      })}
    </div>
  </aside>;
}

function AttackRoute({ resolution }: { resolution: AttackResolution }) {
  const outcome = resolution.hits.length
    ? `${resolution.source} used ${resolution.attack}. ${resolution.hits.map((hit) => `${hit.damage || 'Effect'} to ${hit.target}${hit.knockedOut ? ', knocked out' : ''}`).join('. ')}`
    : `${resolution.source} used ${resolution.attack} with no direct-damage target captured`;
  return <span className="sr-only" role="img" aria-label={outcome} />;
}

function ZoneStack({ label, count, tone, onOpen }: { label: string; count: number; tone: 'coral' | 'blue'; onOpen?: () => void }) {
  return <button type="button" className={`zone-stack ${tone}`} onClick={onOpen} title={`Open ${label}`}><span>{label}</span><span className="zone-stack-cards"><CardsThree size={36} weight="duotone" /></span><b>{count}</b></button>;
}

function ZoneCards({ label, cards, catalog, onOpen }: { label: string; cards: TrackedCard[]; catalog: ReadonlyMap<string, CardInfo>; onOpen?: () => void }) {
  const visible = cards.slice(-2).reverse();
  return (
    <button type="button" className="zone-card-group" onClick={onOpen} title={`Open ${label}`}><span>{label}</span><span className="zone-card-stack">{(visible.length ? visible : [{ id: `fallback-${label}`, name: label }]).map((card) => { const name = resolvedCardInfo(card, catalog)?.name || card.name; return <img key={card.id} src={resolvedCardImage(card, catalog)} title={name} alt={name} />; })}</span><b>{cards.length}</b></button>
  );
}

function reviewCardImage(card: Card, catalog: ReadonlyMap<string, CardInfo>): string {
  const sourceId = cardSourceIdFromReviewCard(card);
  const info = sourceId ? catalog.get(sourceId) || catalog.get(sourceId.toLowerCase()) : undefined;
  return card.imageUrl || info?.imageDataUrl || fallbackCardArt(card.name);
}

function HandFan({ boardName, cards, count, visibility, catalog, opponent, onOpen }: { boardName: string; cards: Card[]; count: number; visibility: Record<string, ReviewCardVisibility>; catalog: ReadonlyMap<string, CardInfo>; opponent: boolean; onOpen: () => void }) {
  const total = Math.max(cards.length, count);
  const displayed = Math.min(total, 12);
  return (
    <button type="button" className={`hand-fan ${opponent ? 'opponent-hand' : 'local-hand'}`} onClick={onOpen} title={`Open ${boardName}'s hand`} aria-label={`${boardName} hand, ${total} card${total === 1 ? '' : 's'}`}>
      <span className="hand-fan-cards" aria-hidden="true">
        {Array.from({ length: displayed }, (_, index) => {
          const card = cards[index];
          const hidden = opponent || !card;
          return hidden
            ? <span className="hand-fan-card hidden" key={card?.id || `hidden-${index}`}><img src="/tracker-assets/pokemon-card-back.jpg" alt="" /></span>
            : <span className="hand-fan-card known" key={card.id} title={card.name}><img src={reviewCardImage(card, catalog)} alt="" /></span>;
        })}
        {total > displayed && <em>+{total - displayed}</em>}
      </span>
      <span className="hand-fan-label"><Hand size={14} weight="duotone" /><span>{opponent ? 'Opponent hand' : 'Your hand'}</span><b>{total}</b></span>
    </button>
  );
}

function PlayerField({ board, canonical, visibility, catalog, choiceFrames, currentReviewIndex, turnNumber, status, defeatedIds, defeatedNames, damageChanges, positionChanges, attackerId, opponent = false, avatar, onOpenPokemon, onOpenChoice, onOpenZone }: { board: TrackedPlayerBoard; canonical: PlayerState; visibility: Record<string, ReviewCardVisibility>; catalog: ReadonlyMap<string, CardInfo>; choiceFrames: TurnChoiceFrame[]; currentReviewIndex: number; turnNumber: number; status: PlayerTurnStatus; defeatedIds: ReadonlySet<string>; defeatedNames: ReadonlySet<string>; damageChanges: ReadonlyMap<string, PokemonDamageChange>; positionChanges: ReadonlyMap<string, PokemonPositionChange>; attackerId?: string; opponent?: boolean; avatar: string; onOpenPokemon: (id: string) => void; onOpenChoice: (card: TrackedCard) => void; onOpenZone: (title: string, subtitle: string, cards: Card[], visibility: Record<string, ReviewCardVisibility>) => void }) {
  const benches = [...board.bench, ...Array.from({ length: Math.max(0, 5 - board.bench.length) }, () => null)].slice(0, 5);
  const tone = opponent ? 'coral' : 'blue';
  const isDefeated = (pokemon: TrackedPokemon | null) => Boolean(pokemon && (defeatedIds.has(pokemon.id) || defeatedNames.has(pokemon.name)));
  const bench = <div className="bench-row" aria-label={`${board.name} bench`}>{benches.map((pokemon, index) => <PokemonSlot key={pokemon?.id || `empty-${index}`} pokemon={pokemon} catalog={catalog} defeated={isDefeated(pokemon)} attacking={pokemon?.id === attackerId} damageChange={pokemon ? damageChanges.get(pokemon.id) : undefined} positionChange={pokemon ? positionChanges.get(pokemon.id) : undefined} onOpen={onOpenPokemon} />)}</div>;
  const active = <div className="active-lane"><span>Active</span><PokemonSlot pokemon={board.active} catalog={catalog} active defeated={isDefeated(board.active)} attacking={board.active?.id === attackerId} damageChange={board.active ? damageChanges.get(board.active.id) : undefined} positionChange={board.active ? positionChanges.get(board.active.id) : undefined} onOpen={onOpenPokemon} /><ChoiceStage boardName={board.name} frames={choiceFrames} currentReviewIndex={currentReviewIndex} catalog={catalog} onOpen={onOpenChoice} /></div>;
  const openZone = (label: string, cards: Card[], note: string) => onOpenZone(`${board.name} · ${label}`, note, cards, visibility);
  const handCount = Math.max(canonical.hand.length, board.handCount);
  const openHand = () => onOpenZone(`${board.name} · Hand`, opponent
    ? 'Only publicly revealed cards are identified; every other opponent card stays masked.'
    : 'Your exact private hand is shown because it is visible to you in Pokémon TCG Live.', canonical.hand, opponent
      ? visibility
      : Object.fromEntries(canonical.hand.map((card) => [card.id, 'known' as const])));
  return (
    <section className={`player-field ${opponent ? 'opponent' : 'local'} ${status.isCurrentTurn ? 'current-turn' : ''} ${status.itemLocked ? 'item-locked' : ''}`}>
      <div className="player-strip">
        <div className="player-identity"><img src={avatar} alt="" /><div><span>{opponent ? 'Opponent' : 'You'}</span><strong>{board.name}</strong></div>{opponent && <button type="button" className="opponent-hand-summary" onClick={openHand} title={`Open ${board.name}'s hand`} aria-label={`${board.name} hand, ${handCount} card${handCount === 1 ? '' : 's'}`}><Hand size={12} weight="fill" /><span>Hand</span><b>{handCount}</b></button>}</div>
        <div className="turn-statuses" aria-label={`${board.name} turn status`}>
          <span className="status-slot turn-slot">{status.isCurrentTurn && <span className="status-pill current turn-number-pill" aria-label={`Current turn, turn ${turnNumber}`}><Play size={10} weight="fill" /><span>Turn</span><b>{turnNumber}</b><i>Current</i></span>}</span>
          <span className="status-slot supporter-slot"><span className={`status-pill supporter ${status.supporterUsed ? 'active' : 'inactive'}`} aria-label={status.supporterUsed ? 'Supporter used' : 'Supporter not used'} title={status.supporterUsed ? 'A Supporter has already been played this turn' : 'No Supporter has been played this turn'}><Hand size={11} weight="fill" />Supporter <CheckCircle className="status-check" size={9} weight="fill" /></span></span>
          <span className="status-slot stadium-slot"><span className={`status-pill stadium ${status.stadiumUsed ? 'active' : 'inactive'}`} aria-label={status.stadiumUsed ? 'Stadium used' : 'Stadium not used'} title={status.stadiumUsed ? 'A Stadium has already been played this turn' : 'No Stadium has been played this turn'}><ShieldCheck size={11} weight="fill" />Stadium <CheckCircle className="status-check" size={9} weight="fill" /></span></span>
          <span className="status-slot item-lock-slot"><span className={`status-pill item-lock ${status.itemLocked ? 'active' : 'inactive'}`} aria-label={status.itemLocked ? 'Items locked by Itchy Pollen' : 'Items not locked'} title={status.itemLocked ? 'This player cannot play Item cards because of Itchy Pollen' : 'This player can play Item cards'}><Prohibit size={11} weight="bold" />Item lock</span></span>
        </div>
        <div className="strip-zones"><div className="prize-summary"><span>Prize</span><b>{canonical.prizes.length || prizesRemaining(board)}</b>{Array.from({ length: 6 }, (_, index) => <i key={index} className={index < (canonical.prizes.length || prizesRemaining(board)) ? 'remaining' : 'taken'} />)}</div></div>
      </div>
      <div className="field-layout"><ZoneStack label="Prize" count={canonical.prizes.length || prizesRemaining(board)} tone={tone} onOpen={() => openZone('Prize cards', canonical.prizes, 'Prize identities stay private until the game reveals them.')} /><div className="battle-lanes">{opponent ? <>{bench}{active}</> : <>{active}{bench}</>}</div><div className="side-piles"><ZoneStack label="Deck" count={canonical.deck.length || board.deckCount || approximateDeckCount(board)} tone={tone} onOpen={() => openZone('Deck', canonical.deck, 'The deck remains face-down outside captured search effects.')} /><ZoneCards label="Discard" cards={board.discardCards || []} catalog={catalog} onOpen={() => openZone('Discard pile', canonical.discard, 'Public discarded cards at this exact action.')} />{canonical.lostZone.length > 0 && <button type="button" className="lost-zone-button" onClick={() => openZone('Lost Zone', canonical.lostZone, 'Cards sent to the Lost Zone are public and cannot be recovered.')}><Sparkle size={13} weight="fill" />Lost Zone <b>{canonical.lostZone.length}</b></button>}</div></div>
      {!opponent && <div className="hand-dock"><HandFan boardName={board.name} cards={canonical.hand} count={handCount} visibility={visibility} catalog={catalog} opponent={false} onOpen={openHand} /></div>}
    </section>
  );
}

function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: () => void }) {
  return <button className={`tracking-toggle ${on ? 'on' : ''}`} type="button" disabled={disabled} onClick={onChange} aria-pressed={on} aria-label="Toggle automatic capture"><span>Auto capture</span><b>{on ? 'On' : 'Off'}</b><i><span /></i></button>;
}

function resultLabel(review: Pick<MatchSummary, 'winner' | 'localPlayer' | 'recording'>): 'Victory' | 'Defeat' | 'Incomplete' | 'Recording' {
  if (review.recording) return 'Recording';
  if (!review.winner) return 'Incomplete';
  return review.winner === review.localPlayer ? 'Victory' : 'Defeat';
}

function findPokemonById(canonical: CanonicalReviewState, id: string): PokemonInPlay | undefined {
  const visit = (pokemon: PokemonInPlay | null | undefined): PokemonInPlay | undefined => {
    if (!pokemon) return undefined;
    if (pokemon.card.id === id) return pokemon;
    return visit(pokemon.previousStage);
  };
  for (const player of canonical.state.players) {
    const active = visit(player.active);
    if (active) return active;
    for (const pokemon of player.bench) {
      const found = visit(pokemon);
      if (found) return found;
    }
  }
  return undefined;
}

function ArchiveBoardSide({ board, catalog, tone }: { board: TrackedPlayerBoard | undefined; catalog: ReadonlyMap<string, CardInfo>; tone: 'opponent' | 'local' }) {
  const slots = [board?.bench[0], board?.bench[1], board?.active, board?.bench[2], board?.bench[3]];
  return <span className={`session-board-side ${tone}`} aria-hidden="true">{slots.map((card, slot) => card
    ? <img className={slot === 2 ? 'active' : ''} key={`${slot}-${card.id}`} src={resolvedCardImage(card, catalog)} alt="" />
    : <i key={slot} />)}</span>;
}

function ArchiveBoardThumbnail({ summary, catalog }: { summary: MatchSummary; catalog: ReadonlyMap<string, CardInfo> }) {
  return <span className="session-board" role="img" aria-label={`Final board state against ${summary.opponent}`}>
    <ArchiveBoardSide board={summary.finalSnapshot?.players[summary.opponent]} catalog={catalog} tone="opponent" />
    <span className="session-board-midline" aria-hidden="true" />
    <ArchiveBoardSide board={summary.finalSnapshot?.players[summary.localPlayer]} catalog={catalog} tone="local" />
  </span>;
}

function ArchiveRow({ summary, index, selected, catalog, onSelect }: { summary: MatchSummary; index: number; selected: boolean; catalog: ReadonlyMap<string, CardInfo>; onSelect: () => void }) {
  const result = resultLabel(summary);
  return (
    <button type="button" className={`session-card ${selected ? 'selected' : ''} ${summary.recording ? 'recording' : ''}`} onClick={onSelect}>
      <ArchiveBoardThumbnail summary={summary} catalog={catalog} />
      <img className="session-avatar" src={TRAINER_ART[index % TRAINER_ART.length]} alt="" />
      <span className="session-copy"><strong>vs. {summary.opponent}</strong><span className="type-icons" aria-hidden="true"><Drop size={13} weight="fill" /><Eye size={13} weight="fill" /><Leaf size={13} weight="fill" /></span><small>{formatMatchDate(summary.importedAt)}</small><em className={result.toLowerCase()}>{result}</em></span>
    </button>
  );
}

export default function TrackerApp() {
  const initial = useMemo(initialReviews, []);
  const [summaries, setSummaries] = useState<MatchSummary[]>(() => initial.map((review) => matchSummaryFromReview(review)));
  const [selectedReview, setSelectedReview] = useState<MatchReview | null>(initial[0] || null);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id || null);
  const [turnIndex, setTurnIndex] = useState(() => Math.max(0, (initial[0]?.turns.length || 1) - 1));
  const [archiveTotal, setArchiveTotal] = useState(initial.length);
  const [restoringReview, setRestoringReview] = useState(isTauri());
  const [tracking, setTracking] = useState(() => !isTauri());
  const [playing, setPlaying] = useState(false);
  const [environment, setEnvironment] = useState<TrackerEnvironment>({
    clientInstalled: false, clientRunning: false, pid: null, captureMode: 'existing-client',
    capture: { permissionReady: false, enabled: false, observerRunning: false, routeActive: false, clientAttached: false, frameCount: 0, operationCount: 0, lastError: null, observerPort: 8899 },
  });
  const [showSetup, setShowSetup] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cloudSync, setCloudSync] = useState<CloudSyncStatus>({ configured: false, enabled: false, deviceId: 'pending', lastError: null });
  const [liveOperations, setLiveOperations] = useState<CapturedOperation[]>([]);
  const [cardCatalog, setCardCatalog] = useState<ReadonlyMap<string, CardInfo>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspector, setInspector] = useState<ReviewInspector | null>(null);
  const [selectedEventKey, setSelectedEventKey] = useState<string | null>(null);
  const liveAssembler = useRef(new LiveReviewAssembler());
  const selectedIdRef = useRef<string | null>(initial[0]?.id || null);
  const catalogRef = useRef(new Map<string, CardInfo>());
  const activeOperationsRef = useRef<CapturedOperation[]>([]);
  const activeOperationKeysRef = useRef(new Set<string>());
  const activeMatchIdRef = useRef<string | null>(null);
  const activeReviewRef = useRef<MatchReview | null>(null);
  const clientLifecycleRef = useRef(initialClientLifecycleState());
  const clientExitFinalizedIdsRef = useRef(new Set<string>());
  const queuedLiveOperationsRef = useRef<CapturedOperation[]>([]);
  const runtimeReadyRef = useRef(false);
  const requestedCardIdsRef = useRef(new Set<string>());
  const pendingCardIdsRef = useRef(new Set<string>());
  const cardBatchTimerRef = useRef<number | null>(null);
  const persistTimersRef = useRef(new Map<string, number>());
  const lastPersistedAtRef = useRef(new Map<string, number>());
  const browserReviewsRef = useRef(initial);
  const knownSummaryIdsRef = useRef(new Set(initial.map((review) => review.id)));
  const setupPrompted = useRef(false);
  const autoStartAttempted = useRef(false);
  const selectedTimelineEventRef = useRef<HTMLButtonElement | null>(null);

  const selectedTurn = selectedReview?.turns[Math.min(turnIndex, Math.max(0, selectedReview.turns.length - 1))] || null;
  const selectedCanonical = useMemo(() => selectedReview && selectedTurn
    ? selectedTurn.canonical || trackedTurnToCanonical(selectedReview, selectedTurn)
    : null, [selectedReview, selectedTurn]);
  const currentSelection = useMemo(() => {
    if (!selectedCanonical || !selectedTurn) return undefined;
    const selectionEvent = selectedTurn.events.find((event) => event.id.includes(':selection:'));
    if (!selectionEvent) return undefined;
    const selectionId = selectionEvent.id.split(':selection:').at(-1);
    return selectedCanonical.selections.find((selection) => selection.id === selectionId) || selectedCanonical.selection;
  }, [selectedCanonical, selectedTurn]);
  const selectedChoiceNames = useMemo(() => selectedCardNames(currentSelection), [currentSelection]);
  const localBoard = selectedReview && selectedTurn ? selectedTurn.snapshot.players[selectedReview.localPlayer] : null;
  const opponentBoard = selectedReview && selectedTurn ? selectedTurn.snapshot.players[selectedReview.opponent] : null;
  const localCanonicalPlayer = selectedCanonical ? selectedCanonical.state.players[selectedCanonical.localPlayerIndex] : null;
  const opponentCanonicalPlayer = selectedCanonical ? selectedCanonical.state.players[selectedCanonical.localPlayerIndex === 0 ? 1 : 0] : null;
  const turnStatus = useMemo(() => selectedReview && selectedTurn && selectedCanonical
    ? deriveReviewTurnStatus(selectedReview, selectedTurn.index, selectedCanonical)
    : null, [selectedCanonical, selectedReview, selectedTurn]);
  const currentActionEvents = useMemo(() => selectedTurn ? actionEventsForTurn(selectedTurn) : [], [selectedTurn]);
  const attackResolution = useMemo(() => selectedTurn ? attackResolutionForTurn(selectedTurn) : null, [selectedTurn]);
  const damageChanges = useMemo(() => new Map(damageChangesForTurn(turnIndex > 0 ? selectedReview?.turns[turnIndex - 1] : undefined, selectedTurn || undefined).map((change) => [change.pokemonId, change])), [selectedReview, selectedTurn, turnIndex]);
  const positionChanges = useMemo(() => new Map(positionChangesForTurn(turnIndex > 0 ? selectedReview?.turns[turnIndex - 1] : undefined, selectedTurn || undefined).map((change) => [change.pokemonId, change])), [selectedReview, selectedTurn, turnIndex]);
  const defeatedIds = useMemo(() => new Set(attackResolution?.hits.flatMap((hit) => hit.knockedOut && hit.targetId ? [hit.targetId] : []) || []), [attackResolution]);
  const defeatedNames = useMemo(() => new Set(attackResolution?.hits.flatMap((hit) => hit.knockedOut && !hit.targetId ? [hit.target] : []) || []), [attackResolution]);

  const timeline = useMemo(() => buildTimeline(selectedReview?.turns || []), [selectedReview]);
  const attackStops = useMemo(() => buildAttackStops(selectedReview), [selectedReview]);
  const selectedSummary = useMemo(() => summaries.find((summary) => summary.id === selectedId), [selectedId, summaries]);
  const turnChoiceFrames = useMemo<TurnChoiceFrame[]>(() => {
    if (!selectedReview || !selectedTurn) return [];
    const selectedGroup = selectedTurn.label.split(/\s+·\s+/)[0]?.trim();
    return selectedReview.turns.slice(0, turnIndex + 1).flatMap((turn, reviewIndex) => {
      const group = turn.label.split(/\s+·\s+/)[0]?.trim();
      if (group !== selectedGroup || !turn.player) return [];
      return [{
        reviewIndex,
        actor: turn.player,
        label: turn.choiceLabel || actionEventsForTurn(turn)[0]?.text || 'Made an action',
        cards: actionCardsForTurn(turn, cardCatalog),
        events: actionEventsForTurn(turn),
      }];
    });
  }, [cardCatalog, selectedReview, selectedTurn, turnIndex]);

  const upsertSummary = useCallback((summary: MatchSummary) => {
    if (!knownSummaryIdsRef.current.has(summary.id)) {
      knownSummaryIdsRef.current.add(summary.id);
      setArchiveTotal((current) => current + 1);
    }
    setSummaries((current) => [summary, ...current.filter((item) => item.id !== summary.id)]
      .sort((left, right) => right.importedAt.localeCompare(left.importedAt)));
  }, []);

  const mergeCatalog = useCallback((cards: CardInfo[]) => {
    if (!cards.length) return catalogRef.current;
    const next = new Map(catalogRef.current);
    cards.forEach((card) => next.set(card.id.toLowerCase(), card));
    catalogRef.current = next;
    setCardCatalog(next);
    return next;
  }, []);

  const resolveCardsForPayload = useCallback(async (payload: unknown) => {
    const ids = [...collectCardSourceIds(payload)];
    const missing = ids.filter((id) => !catalogRef.current.has(id));
    if (missing.length) {
      try {
        mergeCatalog(await resolveCardSources(missing));
      } catch (caught) {
        // Card metadata and art make the replay richer, but the exact captured
        // board remains useful without them. Never let optional enrichment hide
        // a match that is already safely stored.
        console.warn('Card enrichment is temporarily unavailable.', caught);
      }
    }
    return catalogRef.current;
  }, [mergeCatalog]);

  const resolveCardsForOperations = useCallback(async (operations: CapturedOperation[]) => {
    return resolveCardsForPayload(operations.map((operation) => operation.operation));
  }, [resolveCardsForPayload]);

  const rebuildOperations = useCallback(async (operations: CapturedOperation[]) => {
    const catalog = await resolveCardsForOperations(operations);
    const assembler = new LiveReviewAssembler(catalog);
    let review: MatchReview | null = null;
    for (const operation of operations) {
      review = assembler.ingest(operation) || review;
    }
    if (review && operations[0]) review.importedAt = capturedAtIso(operations[0].receivedAt);
    return { assembler, review: review as MatchReview | null };
  }, [resolveCardsForOperations]);

  const commitReview = useCallback(async (review: MatchReview, operationCount = 0) => {
    if (!isTauri()) {
      const next = [review, ...browserReviewsRef.current.filter((item) => item.id !== review.id)].slice(0, MAX_REVIEWS);
      browserReviewsRef.current = next;
      saveReviews(next);
      upsertSummary(matchSummaryFromReview(review, operationCount));
      return;
    }
    const summary = await persistMatchReview(review, REDUCER_VERSION);
    upsertSummary(summary);
  }, [upsertSummary]);

  const displayReview = useCallback((review: MatchReview, followLatest = false) => {
    const follows = followLatest || selectedIdRef.current == null || selectedIdRef.current === review.id;
    if (selectedIdRef.current == null || followLatest) {
      selectedIdRef.current = review.id;
      setSelectedId(review.id);
    }
    if (follows) {
      setSelectedReview(review);
      setTurnIndex((current) => current >= review.turns.length - 2 || followLatest ? Math.max(0, review.turns.length - 1) : current);
    }
  }, []);

  const rebuildStoredMatch = useCallback(async (matchId: string, display = false, seedLive = false) => {
    const operations = await loadMatchOperations(matchId);
    if (!operations.length) return null;
    const rebuilt = await rebuildOperations(operations);
    if (!rebuilt.review) return null;
    await commitReview(rebuilt.review, operations.length);
    if (display) displayReview(rebuilt.review, true);
    if (seedLive) {
      activeMatchIdRef.current = rebuilt.review.id;
      activeReviewRef.current = rebuilt.review;
      activeOperationsRef.current = operations;
      activeOperationKeysRef.current = new Set(operations.map(operationKey));
      liveAssembler.current = rebuilt.assembler;
    }
    return rebuilt.review;
  }, [commitReview, displayReview, rebuildOperations]);

  const importLog = useCallback((text: string) => {
    try {
      const review = parseBattleLog(text);
      selectedIdRef.current = review.id;
      setSelectedId(review.id);
      setSelectedReview(review);
      setTurnIndex(Math.max(0, review.turns.length - 1));
      setError(null);
      setNotice(`Loaded ${review.turns.length - 1} sample turns.`);
      void commitReview(review).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [commitReview]);

  const finalizeActiveMatchForClientExit = useCallback(() => {
    const current = activeReviewRef.current;
    if (!current || current.source !== 'live-network' || current.winner || clientExitFinalizedIdsRef.current.has(current.id)) return;
    const finalized = finalizeReviewForClientExit(current);
    if (finalized === current) return;
    clientExitFinalizedIdsRef.current.add(finalized.id);
    activeReviewRef.current = finalized;
    const pendingTimer = persistTimersRef.current.get(finalized.id);
    if (pendingTimer != null) window.clearTimeout(pendingTimer);
    persistTimersRef.current.delete(finalized.id);
    upsertSummary(matchSummaryFromReview(finalized, activeOperationsRef.current.length));
    displayReview(finalized);
    setNotice(`TCG Live closed during the match. Trace recorded a defeat against ${finalized.opponent}.`);
    void commitReview(finalized, activeOperationsRef.current.length)
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [commitReview, displayReview, upsertSummary]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await getTrackerEnvironment();
        if (active) {
          const observation = observeClientLifecycle(clientLifecycleRef.current, next.clientRunning, next.pid);
          clientLifecycleRef.current = observation.state;
          if (observation.clientExited) finalizeActiveMatchForClientExit();
          setEnvironment(next);
          if (isTauri() && !next.capture.permissionReady && !setupPrompted.current) {
            setupPrompted.current = true;
            setShowSetup(true);
          }
        }
      } catch { /* Browser preview has no native process access. */ }
    };
    void refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [finalizeActiveMatchForClientExit]);

  useEffect(() => {
    if (isTauri()) setTracking(environment.capture.enabled);
    if (environment.capture.lastError) setError(environment.capture.lastError);
  }, [environment.capture.enabled, environment.capture.lastError]);

  useEffect(() => {
    if (!showSetup || !isTauri()) return;
    void getCloudSyncStatus()
      .then(setCloudSync)
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [showSetup]);

  useEffect(() => {
    if (!isTauri() || !environment.capture.permissionReady || autoStartAttempted.current || busy || showSetup) return;
    autoStartAttempted.current = true;
    if (environment.capture.enabled) return;
    void startTracking().then((capture) => { setEnvironment((current) => ({ ...current, capture })); setError(null); }).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [environment.capture.permissionReady, environment.capture.enabled, busy, showSetup]);

  useEffect(() => {
    let unlisten: () => void = () => undefined;
    let active = true;
    const schedulePersistence = (review: MatchReview) => {
      const previous = persistTimersRef.current.get(review.id);
      if (previous != null) window.clearTimeout(previous);
      const operationCount = activeOperationsRef.current.length;
      const commit = () => {
        persistTimersRef.current.delete(review.id);
        lastPersistedAtRef.current.set(review.id, Date.now());
        void commitReview(review, operationCount)
          .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); });
      };
      if (review.winner) commit();
      else {
        const elapsed = Date.now() - (lastPersistedAtRef.current.get(review.id) || 0);
        persistTimersRef.current.set(review.id, window.setTimeout(commit, Math.max(500, 15_000 - elapsed)));
      }
    };

    const publishLive = (review: MatchReview | null) => {
      if (!active || !review) return;
      if (review.winner) clientExitFinalizedIdsRef.current.delete(review.id);
      const published = !review.winner && clientExitFinalizedIdsRef.current.has(review.id)
        ? finalizeReviewForClientExit(review)
        : review;
      activeReviewRef.current = published;
      upsertSummary(matchSummaryFromReview(published, activeOperationsRef.current.length));
      displayReview(published);
      schedulePersistence(published);
    };

    const rebuildActiveMatch = async () => {
      const rebuilt = await rebuildOperations(activeOperationsRef.current);
      if (!active || !rebuilt.review) return;
      liveAssembler.current = rebuilt.assembler;
      publishLive(rebuilt.review);
    };

    const flushCardBatch = async () => {
      cardBatchTimerRef.current = null;
      const ids = [...pendingCardIdsRef.current].filter((id) => !catalogRef.current.has(id));
      pendingCardIdsRef.current.clear();
      if (!ids.length) return;
      ids.forEach((id) => requestedCardIdsRef.current.add(id));
      try {
        mergeCatalog(await resolveCardSources(ids));
        if (active) await rebuildActiveMatch();
      } catch (caught) {
        ids.forEach((id) => requestedCardIdsRef.current.delete(id));
        if (active) setError(caught instanceof Error ? caught.message : String(caught));
      }
    };

    const queueCardResolution = (operation: CapturedOperation) => {
      for (const id of collectCardSourceIds(operation.operation)) {
        if (!catalogRef.current.has(id) && !requestedCardIdsRef.current.has(id)) pendingCardIdsRef.current.add(id);
      }
      if (pendingCardIdsRef.current.size && cardBatchTimerRef.current == null) {
        cardBatchTimerRef.current = window.setTimeout(() => { void flushCardBatch(); }, 100);
      }
    };

    const ingestLive = (operation: CapturedOperation) => {
      if (!active) return;
      const matchId = `live-${operation.matchId || operation.gameId}`;
      if (activeMatchIdRef.current !== matchId) {
        activeMatchIdRef.current = matchId;
        activeReviewRef.current = null;
        activeOperationsRef.current = [];
        activeOperationKeysRef.current = new Set();
        liveAssembler.current = new LiveReviewAssembler(catalogRef.current);
      }
      const key = operationKey(operation);
      if (activeOperationKeysRef.current.has(key)) return;
      activeOperationKeysRef.current.add(key);
      activeOperationsRef.current.push(operation);
      const recording = recordingSummaryFromOperation(operation, activeOperationsRef.current.length);
      if (knownSummaryIdsRef.current.has(recording.id)) {
        setSummaries((current) => current.map((summary) => summary.id === recording.id
          ? { ...summary, operationCount: recording.operationCount }
          : summary));
      } else upsertSummary(recording);
      if (selectedIdRef.current == null) {
        selectedIdRef.current = recording.id;
        setSelectedId(recording.id);
      }
      setLiveOperations((current) => [operation, ...current].slice(0, 80));
      publishLive(liveAssembler.current.ingest(operation));
      queueCardResolution(operation);
    };

    const receiveLive = (operation: CapturedOperation) => {
      if (runtimeReadyRef.current) ingestLive(operation);
      else queuedLiveOperationsRef.current.push(operation);
    };

    const bootstrap = async () => {
      try {
        if (isTauri()) {
          let status = await initializeTrackerStorage();
          if (!active) return;
          const legacyReviews = localStorage.getItem(STORAGE_MIGRATED_KEY) === '1' ? [] : loadReviews();
          for (const review of legacyReviews) await commitReview(review);
          if (legacyReviews.length) {
            localStorage.setItem(STORAGE_MIGRATED_KEY, '1');
            status = await initializeTrackerStorage();
          }
          const stored = await listMatchSummaries(0, 50);
          stored.forEach((summary) => knownSummaryIdsRef.current.add(summary.id));
          setSummaries(stored);
          setArchiveTotal(status.archivedMatches);

          const rawIds = await listRawMatchIds(false, 1);
          const preferredId = rawIds[0] || stored[0]?.id;
          const cached = preferredId ? await loadMatchReview(preferredId) : null;
          if (!active) return;
          await resolveCardsForPayload([stored, cached]);
          if (!active) return;
          if (cached) displayReview(cached, true);
          else if (preferredId) {
            selectedIdRef.current = preferredId;
            setSelectedId(preferredId);
          }
          setRestoringReview(false);

          const preferredSummary = stored.find((summary) => summary.id === rawIds[0]);
          const needsLiveSeed = Boolean(rawIds[0]) && (!cached?.winner || preferredSummary?.reducerVersion !== REDUCER_VERSION);
          if (rawIds[0] && needsLiveSeed) {
            const rebuilt = await rebuildStoredMatch(rawIds[0], !cached, true);
            if (rebuilt && cached) displayReview(rebuilt);
          }

          runtimeReadyRef.current = true;
          queuedLiveOperationsRef.current.splice(0).forEach(ingestLive);

          const pendingIds = await listRawMatchIds(true, 5_000, REDUCER_VERSION);
          for (const matchId of pendingIds) {
            if (!active || matchId === rawIds[0]) continue;
            await rebuildStoredMatch(matchId);
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          }
          if (active) {
            const refreshed = await initializeTrackerStorage();
            setArchiveTotal(refreshed.archivedMatches);
          }
          return;
        }

        const recent = await getRecentMatchOperations();
        if (recent.length) {
          const latest = recent.at(-1);
          const latestMatchId = latest ? latest.matchId || latest.gameId : null;
          const latestOperations = latestMatchId
            ? recent.filter((operation) => (operation.matchId || operation.gameId) === latestMatchId)
            : [];
          const rebuilt = await rebuildOperations(latestOperations);
          if (active && rebuilt.review) {
            activeMatchIdRef.current = rebuilt.review.id;
            activeOperationsRef.current = latestOperations;
            activeOperationKeysRef.current = new Set(latestOperations.map(operationKey));
            liveAssembler.current = rebuilt.assembler;
            upsertSummary(matchSummaryFromReview(rebuilt.review, latestOperations.length));
            displayReview(rebuilt.review, true);
          }
        }
        setRestoringReview(false);
        runtimeReadyRef.current = true;
        queuedLiveOperationsRef.current.splice(0).forEach(ingestLive);
      } catch (caught) {
        if (active) {
          setRestoringReview(false);
          setError(caught instanceof Error ? caught.message : String(caught));
          runtimeReadyRef.current = true;
          queuedLiveOperationsRef.current.splice(0).forEach(ingestLive);
        }
      }
    };

    void onMatchOperation(receiveLive).then((next) => { unlisten = next; });
    void bootstrap();
    return () => {
      active = false;
      activeReviewRef.current = null;
      unlisten();
      if (cardBatchTimerRef.current != null) window.clearTimeout(cardBatchTimerRef.current);
      persistTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      persistTimersRef.current.clear();
    };
  }, [commitReview, displayReview, mergeCatalog, rebuildOperations, rebuildStoredMatch, resolveCardsForPayload, upsertSummary]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  useEffect(() => { setTurnIndex((current) => Math.min(current, Math.max(0, (selectedReview?.turns.length || 1) - 1))); }, [selectedReview]);

  useEffect(() => {
    const selectedEntry = timeline.entries.find((entry) => entry.key === selectedEventKey);
    if (selectedEntry?.reviewIndex === turnIndex) return;
    setSelectedEventKey(eventKeyForReviewIndex(timeline.entries, turnIndex));
  }, [selectedEventKey, selectedReview?.id, timeline.entries, turnIndex]);

  useEffect(() => {
    if (!selectedEventKey) return undefined;
    const frame = window.requestAnimationFrame(() => selectedTimelineEventRef.current?.scrollIntoView({ block: 'center' }));
    return () => window.cancelAnimationFrame(frame);
  }, [selectedEventKey, selectedReview?.id, timeline.entries.length]);

  useEffect(() => {
    if (!selectedReview || showSetup || inspector) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      const key = event.key.toLowerCase();
      const firstFrame = event.shiftKey && key === 'a';
      const latestFrame = event.shiftKey && key === 'd';
      const previousFrame = key === 'arrowleft' || key === 'a';
      const nextFrame = key === 'arrowright' || key === 'd';
      const previousAttack = key === 'arrowup' || key === 'w';
      const nextAttack = key === 'arrowdown' || key === 's';
      if (!previousFrame && !nextFrame && !previousAttack && !nextAttack) return;

      event.preventDefault();
      setPlaying(false);
      setInspector(null);
      setTurnIndex((current) => {
        if (firstFrame) return 0;
        if (latestFrame) return selectedReview.turns.length - 1;
        if (previousFrame) return Math.max(0, current - 1);
        if (nextFrame) return Math.min(selectedReview.turns.length - 1, current + 1);
        return stepAttack(attackStops, current, previousAttack ? -1 : 1);
      });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [attackStops, inspector, selectedReview, showSetup]);

  useEffect(() => {
    if (!playing || !selectedReview) return undefined;
    const selectedFrame = selectedReview.turns[turnIndex];
    const isAttackFrame = selectedFrame?.events.some((event) => event.kind === 'attack' || event.kind === 'damage');
    const timer = window.setTimeout(() => {
      setTurnIndex((current) => {
        if (current >= selectedReview.turns.length - 1) { setPlaying(false); return current; }
        return current + 1;
      });
    }, isAttackFrame ? 2600 : 1200);
    return () => window.clearTimeout(timer);
  }, [playing, selectedReview, turnIndex]);

  const changeTracking = useCallback(async () => {
    setError(null);
    if (!isTauri()) { setTracking((value) => !value); return; }
    if (!environment.capture.permissionReady && !environment.capture.enabled) { setShowSetup(true); return; }
    setBusy(true);
    try {
      const capture = environment.capture.enabled ? await stopTracking() : await startTracking();
      setEnvironment((current) => ({ ...current, capture }));
      setNotice(capture.enabled ? 'Automatic capture is on. Your next match will appear in the archive.' : 'Automatic capture is paused. No new operations will be retained.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }, [environment.capture.permissionReady, environment.capture.enabled]);

  const finishSetup = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const permission = await requestCapturePermission();
      setEnvironment((current) => ({ ...current, capture: permission }));
      if (permission.permissionReady) {
        const capture = await startTracking();
        setEnvironment((current) => ({ ...current, capture }));
        setShowSetup(false);
        setNotice('Setup complete. Your next game will be recorded automatically.');
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }, []);

  const toggleCloudSync = useCallback(async () => {
    if (!isTauri() || !cloudSync.configured) return;
    setBusy(true);
    setError(null);
    try {
      const next = await setCloudSyncEnabled(!cloudSync.enabled);
      setCloudSync(next);
      if (next.enabled && selectedReview) {
        await persistMatchReview(selectedReview, REDUCER_VERSION);
      }
      setNotice(next.enabled
        ? 'Private AWS cloud backup is on. This match and future matches will be backed up.'
        : 'Cloud backup is off. Your local match archive is unchanged.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [cloudSync.configured, cloudSync.enabled, selectedReview]);

  const openCard = useCallback((card: Card, pokemon?: PokemonInPlay) => {
    setInspector({ kind: 'card', card, pokemon, effects: selectedCanonical?.appliedEffects[card.id], title: pokemon ? 'Pokémon in play' : 'Card details' });
  }, [selectedCanonical]);

  const openPokemon = useCallback((id: string) => {
    if (!selectedCanonical) return;
    const pokemon = findPokemonById(selectedCanonical, id);
    if (pokemon) openCard(pokemon.card, pokemon);
  }, [openCard, selectedCanonical]);

  const openChoiceCard = useCallback((tracked: TrackedCard) => {
    const info = resolvedCardInfo(tracked, cardCatalog);
    openCard(cardInfoToEngineCard(info, tracked.id, info?.name || tracked.name));
  }, [cardCatalog, openCard]);

  const openZone = useCallback((title: string, subtitle: string, cards: Card[], visibility: Record<string, ReviewCardVisibility>) => {
    setInspector({ kind: 'zone', title, subtitle, cards, visibility });
  }, []);

  const openSelection = useCallback((selection = selectedCanonical?.selection) => {
    if (!selection) return;
    const source = selection.sourceCardId
      ? cardCatalog.get(selection.sourceCardId) || cardCatalog.get(selection.sourceCardId.toLowerCase())
      : undefined;
    setInspector({ kind: 'selection', selection, sourceName: source?.name });
  }, [cardCatalog, selectedCanonical]);

  const selectSummary = useCallback(async (summary: MatchSummary) => {
    selectedIdRef.current = summary.id;
    setSelectedId(summary.id);
    setSelectedEventKey(null);
    setPlaying(false);
    setInspector(null);
    if (selectedReview?.id === summary.id) {
      setTurnIndex(Math.max(0, selectedReview.turns.length - 1));
      return;
    }
    setRestoringReview(true);
    try {
      const stored = isTauri()
        ? await loadMatchReview(summary.id)
        : browserReviewsRef.current.find((review) => review.id === summary.id) || null;
      const review = stored || (isTauri() ? await rebuildStoredMatch(summary.id) : null);
      if (!review || selectedIdRef.current !== summary.id) return;
      await resolveCardsForPayload([summary, review]);
      if (selectedIdRef.current !== summary.id) return;
      setSelectedReview(review);
      setTurnIndex(Math.max(0, review.turns.length - 1));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRestoringReview(false);
    }
  }, [rebuildStoredMatch, resolveCardsForPayload, selectedReview]);

  const loadOlderMatches = useCallback(async () => {
    if (!isTauri() || summaries.length >= archiveTotal) return;
    try {
      const older = await listMatchSummaries(summaries.length, 50);
      await resolveCardsForPayload(older);
      older.forEach((summary) => knownSummaryIdsRef.current.add(summary.id));
      setSummaries((current) => [...current, ...older.filter((summary) => !current.some((item) => item.id === summary.id))]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [archiveTotal, resolveCardsForPayload, summaries.length]);

  return (
    <div className="app-shell">
      <div className="window-drag-region" onMouseDown={beginWindowDrag} aria-hidden="true" />

      <main className={`workspace ${archiveOpen ? 'archive-open' : 'archive-collapsed'} ${timelineOpen ? 'timeline-open' : 'timeline-collapsed'}`}>
        {archiveOpen && <aside className="session-rail">
          <div className="archive-heading" onMouseDown={beginWindowDrag}>
            <div className="archive-brand"><span><img src="/tracker-assets/trace-mascot.png" alt="" /></span><div><strong>Trace</strong><small>Every turn, in view</small></div><div className={`header-status ${tracking ? 'live' : ''}`}><i /><b>{tracking ? 'Live' : 'Paused'}</b></div></div>
            <div className="archive-title"><div><h2>Match archive</h2><p>{archiveTotal} matches recorded</p></div><button className="panel-collapse-button" type="button" aria-label="Collapse match archive" aria-expanded="true" title="Collapse match archive" onClick={() => setArchiveOpen(false)}><CaretLeft size={17} weight="bold" /></button></div>
          </div>
          <div className="sessions">
            {summaries.map((summary, index) => <ArchiveRow key={summary.id} summary={summary} index={index} selected={summary.id === selectedId} catalog={cardCatalog} onSelect={() => void selectSummary(summary)} />)}
            {!summaries.length && !restoringReview && <div className="empty-library"><BookOpenText size={38} weight="duotone" /><strong>No matches yet</strong><p>Turn on automatic capture and play normally. Your games will collect here.</p><button type="button" onClick={() => importLog(DEMO_BATTLE_LOG)}>Explore a sample</button></div>}
            {!summaries.length && restoringReview && <div className="empty-library archive-loading"><BookOpenText size={38} weight="duotone" /><strong>Restoring your archive…</strong><p>Loading the latest saved match.</p></div>}
          </div>
          <button className="all-matches" type="button" disabled={summaries.length >= archiveTotal} onClick={() => void loadOlderMatches()}><BookOpenText size={19} weight="duotone" /><span>{summaries.length < archiveTotal ? 'Load older matches' : 'All matches loaded'}</span><CaretRight size={17} weight="bold" /></button>
        </aside>}

        <section className="review-stage">
          {restoringReview && !selectedReview ? <div className="welcome-state loading-review"><BookOpenText size={54} weight="duotone" /><span>Restoring match</span><h2>Loading the reconstructed board…</h2><p>The archive index is ready; only this selected match is being read.</p></div> : selectedReview && selectedTurn && localBoard && opponentBoard && selectedCanonical && localCanonicalPlayer && opponentCanonicalPlayer && turnStatus ? <>
            <div className="board-frame">
              <div className="reconstructed-chip"><CheckCircle size={18} weight="fill" />Board reconstructed</div>
              <PlayerField board={opponentBoard} canonical={opponentCanonicalPlayer} visibility={selectedCanonical.visibility} catalog={cardCatalog} choiceFrames={turnChoiceFrames.filter((frame) => frame.actor === opponentBoard.name)} currentReviewIndex={turnIndex} turnNumber={selectedCanonical.state.turnNumber} status={turnStatus.players[opponentBoard.name]} defeatedIds={defeatedIds} defeatedNames={defeatedNames} damageChanges={damageChanges} positionChanges={positionChanges} attackerId={attackResolution?.sourceId} opponent avatar={TRAINER_ART[0]} onOpenPokemon={openPokemon} onOpenChoice={openChoiceCard} onOpenZone={openZone} />
              <div className={`midline ${turnStatus.stadiumName ? 'has-stadium' : ''}`}><span /><StadiumMarker card={selectedCanonical.state.stadium} name={turnStatus.stadiumName} owner={turnStatus.stadiumOwner} localPlayer={localBoard.name} opponent={opponentBoard.name} onOpen={openCard} /><span /></div>
              <PlayerField board={localBoard} canonical={localCanonicalPlayer} visibility={selectedCanonical.visibility} catalog={cardCatalog} choiceFrames={turnChoiceFrames.filter((frame) => frame.actor === localBoard.name)} currentReviewIndex={turnIndex} turnNumber={selectedCanonical.state.turnNumber} status={turnStatus.players[localBoard.name]} defeatedIds={defeatedIds} defeatedNames={defeatedNames} damageChanges={damageChanges} positionChanges={positionChanges} attackerId={attackResolution?.sourceId} avatar={TRAINER_ART[2]} onOpenPokemon={openPokemon} onOpenChoice={openChoiceCard} onOpenZone={openZone} />
              {attackResolution && <AttackRoute resolution={attackResolution} />}
            </div>
            <div className="turn-controls">
              <div className="turn-caption">
                <span className="turn-caption-meta"><small>{selectedTurn.label}</small><b>{turnIndex} / {Math.max(1, selectedReview.turns.length - 1)}</b></span>
                <strong>{currentActionEvents[0]?.text || (selectedTurn.player ? `${selectedTurn.player}'s action` : selectedTurn.label)}</strong>
                <small>{currentActionEvents.slice(1).filter(isSupportingActionEvent).map((event) => event.text).join(' · ') || (selectedTurn.player ? `Action by ${selectedTurn.player}` : selectedTurn.label === 'Capture baseline' ? 'First complete board received' : selectedTurn.label === 'Partial capture' ? 'Capture began before a complete board was available' : 'Opening setup')}</small>
              </div>
              <label className="turn-scrubber"><span className="sr-only">Replay position</span><span className="turn-scrubber-rail" aria-hidden="true"><i style={{ width: `${selectedReview.turns.length > 1 ? (turnIndex / (selectedReview.turns.length - 1)) * 100 : 0}%` }} /></span><input type="range" min="0" max={Math.max(0, selectedReview.turns.length - 1)} value={turnIndex} onChange={(event) => { setTurnIndex(Number(event.target.value)); setPlaying(false); }} /></label>
              <div className="transport-buttons">
                <button type="button" onClick={() => setTurnIndex(0)} disabled={turnIndex === 0} aria-label="First frame" aria-keyshortcuts="Shift+A" title="First frame · Shift+A"><SkipBack size={19} weight="fill" /></button>
                <button type="button" onClick={() => setTurnIndex((value) => Math.max(0, value - 1))} disabled={turnIndex === 0} aria-label="Previous frame" aria-keyshortcuts="ArrowLeft A" title="Previous frame · A or ←"><CaretLeft size={20} weight="bold" /></button>
                <button className="play-button" type="button" onClick={() => { if (!playing && turnIndex >= selectedReview.turns.length - 1) setTurnIndex(0); setPlaying((value) => !value); }} aria-label={playing ? 'Pause replay' : 'Play replay'}>{playing ? <Pause size={23} weight="fill" /> : <Play size={23} weight="fill" />}</button>
                <button type="button" onClick={() => setTurnIndex((value) => Math.min(selectedReview.turns.length - 1, value + 1))} disabled={turnIndex >= selectedReview.turns.length - 1} aria-label="Next frame" aria-keyshortcuts="ArrowRight D" title="Next frame · D or →"><CaretRight size={20} weight="bold" /></button>
                <button type="button" onClick={() => setTurnIndex(selectedReview.turns.length - 1)} disabled={turnIndex >= selectedReview.turns.length - 1} aria-label="Latest frame" aria-keyshortcuts="Shift+D" title="Latest frame · Shift+D"><SkipForward size={19} weight="fill" /></button>
              </div>
            </div>
          </> : selectedSummary?.recording ? <div className="welcome-state live-capture-state"><WifiHigh size={58} weight="duotone" /><span>Game detected</span><h2>Capturing this match.</h2><p>Trace registered the game immediately. The reconstructed board will appear as soon as the opening state arrives.</p><small>{Math.max(selectedSummary.operationCount, liveOperations.length)} exact operation{Math.max(selectedSummary.operationCount, liveOperations.length) === 1 ? '' : 's'} safely stored</small></div> : <div className="welcome-state"><img src="/tracker-assets/trace-mascot.png" alt="Trace's furry archivist reading a field guide" /><span>Ready when you are</span><h2>See the whole match.</h2><p>Trace captures exact live operations and rebuilds every turn automatically—no OCR, screenshots, or manual imports.</p><div><button className="primary" type="button" disabled={busy} onClick={() => void changeTracking()}>{tracking ? 'Automatic capture is on' : 'Start automatic capture'}</button><button type="button" onClick={() => importLog(DEMO_BATTLE_LOG)}>Explore a sample</button></div>{liveOperations.length > 0 && <small>{liveOperations.length} exact operations decoded</small>}</div>}
        </section>

        {timelineOpen && <aside className="timeline-panel">
          <div className="timeline-heading" onMouseDown={beginWindowDrag}><div><span id="match-timeline-heading">Game log</span><small>{timeline.entries.length ? `${timeline.entries.length} events · ${selectedTurn?.label || 'Replay'}` : 'Waiting for a match'}</small></div><div className="timeline-heading-actions"><button type="button" aria-label="Jump to the selected event" title="Jump to selected event" disabled={!selectedEventKey} onClick={() => selectedTimelineEventRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })}><SkipForward size={19} weight="fill" /></button><button className="panel-collapse-button" type="button" aria-label="Collapse game log" aria-expanded="true" title="Collapse game log" onClick={() => setTimelineOpen(false)}><CaretRight size={17} weight="bold" /></button></div></div>
          <div className="timeline-tools"><Toggle on={tracking} disabled={busy} onChange={() => void changeTracking()} /><button className="icon-button" type="button" aria-label="Settings" onClick={() => setShowSetup(true)}><GearSix size={21} weight="bold" /></button></div>
          <div className="timeline-list" role="list" aria-labelledby="match-timeline-heading">
            {timeline.groups.map((group) => {
              const current = group.entries.some((entry) => entry.reviewIndex === turnIndex);
              const future = group.entries.every((entry) => entry.reviewIndex > turnIndex);
              const actor = group.actors.length === 1 ? group.actors[0] : group.actors.length > 1 ? 'Both players' : 'Match setup';
              return <section className={`timeline-turn ${current ? 'current' : ''} ${future ? 'future' : ''}`} key={group.key} aria-label={`${group.label}, ${group.entries.length} events`}>
                <header className="timeline-turn-heading"><span>{group.label}</span><small>{actor}</small><b>{group.entries.length}</b></header>
                <div className="timeline-turn-events">
                  {group.entries.map((entry) => {
                    const { event, turn } = entry;
                    const selected = entry.key === selectedEventKey;
                    const selectionId = event.id.includes(':selection:') ? event.id.split(':selection:').at(-1) : undefined;
                    const selection = selectionId ? turn.canonical?.selections.find((candidate) => candidate.id === selectionId) : undefined;
                    const eventCard = event.cardId
                      ? cardCatalog.get(event.cardId) || cardCatalog.get(event.cardId.toLowerCase())
                      : undefined;
                    const effect = cardEffectSummary(event, eventCard);
                    return <article className={`timeline-event-wrap kind-${event.kind} ${event.coinResult ? `coin-${event.coinResult}` : ''} ${selected ? 'selected' : ''}`} key={entry.key} role="listitem" aria-setsize={timeline.entries.length} aria-posinset={entry.position}>
                      <button ref={selected ? selectedTimelineEventRef : undefined} className="timeline-event" type="button" aria-current={selected ? 'step' : undefined} aria-label={`Event ${entry.position} of ${timeline.entries.length}. ${event.id.includes(':selection:') ? 'Captured choice' : EVENT_LABELS[event.kind]}. ${event.text}`} onClick={() => { setSelectedEventKey(entry.key); setTurnIndex(Math.min(entry.reviewIndex, (selectedReview?.turns.length || 1) - 1)); setPlaying(false); setInspector(null); }}>
                        <span className="event-icon"><EventIcon kind={event.kind} /></span>
                        <span className="event-copy"><span className="event-meta"><small>{event.id.includes(':selection:') ? 'Captured choice' : EVENT_LABELS[event.kind]}</small><span>Event {entry.position}</span></span><strong>{event.text}</strong></span>
                        <span className="event-trailing">{event.coinResult ? <b className={`coin-outcome ${event.coinResult}`}><Coin size={10} weight="fill" />{event.coinResult === 'heads' ? 'Heads' : event.coinResult === 'tails' ? 'Tails' : 'Mixed'}</b> : selected ? <b>Viewing</b> : event.id.includes(':selection:') ? <MagnifyingGlass size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}</span>
                      </button>
                      {selected && effect && eventCard && <button className="event-effect-detail" type="button" onClick={() => openChoiceCard({ id: `${event.id}:card`, cardId: eventCard.id, name: eventCard.name })} aria-label={`${effect.label}: ${effect.title}. ${effect.text}. Open card details`}>
                        <img src={eventCard.imageDataUrl || fallbackCardArt(eventCard.name)} alt="" />
                        <span><small>{effect.label}</small><strong>{effect.title}</strong><p>{effect.text}</p></span>
                        <CaretRight size={14} weight="bold" />
                      </button>}
                      {selected && Boolean(event.facts?.length) && <details className="event-data-detail">
                        <summary><CaretRight size={12} weight="bold" /><span><b>Captured action data</b><small>Readable facts from the exact game payload</small></span><strong>{event.facts!.length}</strong></summary>
                        <dl>
                          {event.facts!.map((fact) => <div className={`fact-${fact.kind} tone-${fact.tone || 'neutral'}`} key={fact.id}><dt><i />{fact.label}</dt><dd>{fact.value}</dd></div>)}
                        </dl>
                        {Boolean(event.protocolGroups?.length) && <details className="event-protocol-detail"><summary><span>Protocol trace</span><small>{event.protocolGroups!.length} data categor{event.protocolGroups!.length === 1 ? 'y' : 'ies'}</small></summary><div>{event.protocolGroups!.map((group) => <span key={group.id}><b>{group.label}</b><small>×{group.count}</small><em>{group.readableCount === group.count ? 'shown above' : group.readableCount ? `${group.readableCount} shown` : 'engine-only'}</em></span>)}</div></details>}
                        <footer><span>{event.protocolChanges || 0} protocol change{event.protocolChanges === 1 ? '' : 's'} captured</span>{Boolean(event.internalChanges) && <span>{event.internalChanges} engine-only transition{event.internalChanges === 1 ? '' : 's'} condensed in the trace</span>}</footer>
                      </details>}
                      {selected && selection && <div className="timeline-event-detail"><span>{selection.candidateVisibility === 'private' ? <><b>{selectedChoiceNames.length ? selectedChoiceNames.join(' + ') : 'Private selection'}</b><small>{selection.selectedOptionIds.length} chosen · candidate list stayed private in the payload</small></> : selection.allOptionIds.length > 0 ? <><b>{selectedChoiceNames.length ? selectedChoiceNames.join(' + ') : `${selection.allOptionIds.length} viewed`}</b><small>{selection.allOptionIds.length} viewed · {selection.eligibleOptionIds.length} eligible · {selection.selectedOptionIds.length} chosen</small></> : <><b>{selection.kind === 'damage' ? 'Damage placement' : 'Captured decision'}</b><small>{selection.completed ? 'Resolved in this action' : 'Pending at capture'}</small></>}</span><button type="button" onClick={() => openSelection(selection)}>{selection.candidateVisibility === 'private' ? 'View result' : selection.allOptionIds.length > 0 ? 'Review cards' : 'Review choice'}</button></div>}
                    </article>;
                  })}
                </div>
              </section>;
            })}
            {!timeline.entries.length && liveOperations.map((operation) => <div className="timeline-event live-operation" key={`${operation.gameId}-${operation.messageIndex}-${operation.receivedAt}`}><span className="event-icon"><WifiHigh size={17} weight="bold" /></span><span className="event-copy"><span className="event-meta"><small>Live operation</small></span><strong>{operation.operationId || `Message ${operation.messageIndex ?? '—'}`}</strong></span></div>)}
            {!timeline.entries.length && !liveOperations.length && <div className="empty-timeline"><BookOpenText size={34} weight="duotone" /><p>Match events appear here as the board is rebuilt.</p></div>}
          </div>
        </aside>}
      </main>

      {!archiveOpen && <button className="panel-restore-button archive-restore-button" type="button" aria-label="Open match archive" aria-expanded="false" title="Open match archive" onClick={() => setArchiveOpen(true)}><CardsThree size={22} weight="duotone" /></button>}
      {!timelineOpen && <button className="panel-restore-button timeline-restore-button" type="button" aria-label="Open game log" aria-expanded="false" title="Open game log" onClick={() => setTimelineOpen(true)}><List size={22} weight="bold" /></button>}

      {showSetup && <div className="modal-backdrop"><div className="setup-modal"><div className="modal-title"><div><span>Trace settings</span><h2>Capture and backup</h2></div><button type="button" disabled={busy} onClick={() => setShowSetup(false)} aria-label="Close settings"><X size={21} weight="bold" /></button></div><p>Give Trace permission to connect to TCG Live and record your matches automatically.</p><div className="cloud-backup-setting"><div><ShieldCheck size={22} weight="duotone" /><span><strong>Private cloud backup</strong><small>{cloudSync.configured ? 'Store reconstructed matches in your encrypted AWS-backed archive.' : 'Available after installing the next network-enabled Trace release.'}</small>{cloudSync.lastError && <em>{cloudSync.lastError}</em>}</span></div><button type="button" role="switch" aria-checked={cloudSync.enabled} className={cloudSync.enabled ? 'enabled' : ''} disabled={busy || !cloudSync.configured} onClick={() => void toggleCloudSync()}><span />{cloudSync.enabled ? 'On' : 'Off'}</button></div><div className="modal-actions"><button type="button" disabled={busy} onClick={() => setShowSetup(false)}>Close</button><button className="primary" type="button" disabled={busy} onClick={() => void finishSetup()}>{busy ? 'Working…' : environment.capture.permissionReady ? 'Reconnect capture' : 'Connect capture'}</button></div></div></div>}
      <ReviewOverlay inspector={inspector} catalog={cardCatalog} onClose={() => setInspector(null)} onInspectCard={openCard} />
      <UpdateNotice />
      {(notice || error) && <div className={`toast ${error ? 'error' : ''}`}><span>{error ? <X size={18} weight="bold" /> : <CheckCircle size={18} weight="fill" />}</span><p>{error || notice}</p><button type="button" onClick={() => { setError(null); setNotice(null); }} aria-label="Dismiss notification"><X size={16} weight="bold" /></button></div>}
    </div>
  );
}

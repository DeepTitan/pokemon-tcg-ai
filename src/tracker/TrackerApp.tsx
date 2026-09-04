import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  BookOpenText, CardsThree, CaretLeft, CaretRight, CheckCircle,
  Drop, Eye, FunnelSimple, GearSix, Hand, MagnifyingGlass, Pause, Play,
  ShieldCheck, SkipBack, SkipForward, Sparkle, Sword, Trophy, WifiHigh, Wrench, X,
} from '@phosphor-icons/react';
import { ArrowsClockwise } from '@phosphor-icons/react/ArrowsClockwise';
import { CalendarBlank } from '@phosphor-icons/react/CalendarBlank';
import { Clock } from '@phosphor-icons/react/Clock';
import { Fire } from '@phosphor-icons/react/Fire';
import { Lightning } from '@phosphor-icons/react/Lightning';
import { List } from '@phosphor-icons/react/List';
import { MoonStars } from '@phosphor-icons/react/MoonStars';
import { Skull } from '@phosphor-icons/react/Skull';
import { Coin } from '@phosphor-icons/react/Coin';
import { Prohibit } from '@phosphor-icons/react/Prohibit';
import { ArrowDown } from '@phosphor-icons/react/ArrowDown';
import { ArrowUp } from '@phosphor-icons/react/ArrowUp';
import type { Card, PlayerState, PokemonInPlay } from '../engine/types.js';
import { parseBattleLog } from './battle-log-parser.js';
import { DEMO_BATTLE_LOG } from './demo-log.js';
import {
  getRecentMatchOperations, getTrackerEnvironment, initializeTrackerStorage, isTauri, listMatchSummaries,
  listRawMatchIds, loadMatchOperations, loadMatchReview, onMatchOperation, persistMatchReview,
  requestCapturePermission, resolveCardSources, startTracking, stopTracking,
} from './tauri.js';
import { LiveReviewAssembler } from './live-operation-reducer.js';
import { ReviewOverlay, type ReviewInspector } from './ReviewInteractions.js';
import { displayedDeckCount, trackedTurnToCanonical } from './review-state-adapter.js';
import { cardInfoToEngineCard, cardSourceIdFromReviewCard } from './card-adapter.js';
import { sortCardsForDisplay } from './card-order-model.js';
import { findEnergyType } from './EnergyBadge.js';
import { buildTimeline, eventKeyForReviewIndex } from './timeline-model.js';
import { presentTurnEvents, selectionForEvent } from './game-log-copy.js';
import { cardEffectSummary } from './card-effect-model.js';
import { attackResolutionForTurn, type AttackResolution } from './attack-resolution-model.js';
import { damageChangesForTurn, type PokemonDamageChange } from './damage-change-model.js';
import { positionChangesForTurn, type PokemonPositionChange } from './position-change-model.js';
import { buildKeyMoments, stepKeyMoment } from './key-moment-navigation.js';
import { deriveReviewTurnStatus, type PlayerTurnStatus } from './turn-status-model.js';
import { capturedAtIso, collectCardSourceIds, finalizeReviewForClientExit, matchSummaryFromReview, operationKey, recordingSummaryFromOperation, REDUCER_VERSION } from './match-storage.js';
import { initialClientLifecycleState, observeClientLifecycle } from './client-lifecycle-model.js';
import { captureIndicator } from './capture-status-model.js';
import { archiveMatchup, formatMatchDuration, formatPrizeScore } from './archive-summary-model.js';
import { handFanCardCount, opponentHandFanSlots } from './hand-layout-model.js';
import { prizeSlotStates } from './prize-layout-model.js';
import {
  FRAME_ANIMATIONS_STORAGE_KEY,
  frameAnimationsFromStoredPreference,
  frameCardTransitionName,
  frameNavigationMode,
  resolveFrameNavigationTarget,
  type FrameNavigationRequest,
} from './frame-animation-model.js';
import { UpdateNotice } from './UpdateNotice.js';
import { CARD_BACK_ART, cardCatalogEntryNeedsRefresh, findCatalogCard, publicCardArtUrl, resolvedCardArt, showCardBackOnError } from './card-art.js';
import type {
  CapturedOperation, CardInfo, CanonicalReviewState, MatchReview, MatchSummary, ReviewCardVisibility, ReviewSelection, TrackedCard, TrackedChoiceCard, TrackedPlayerBoard,
  TrackedPokemon, TrackedTurn, TrackerEnvironment, TrackerEventKind,
} from './types.js';
import './tracker.css';

// Keep the legacy key so the rebrand never strands a user's saved match archive.
const STORAGE_KEY = 'match-lens/reviews-v1';
const STORAGE_MIGRATED_KEY = 'trace/reviews-sqlite-v1';
const CAPTURE_DISCLOSURE_KEY = 'trace/cloud-backup-disclosure-v1';
const MAX_REVIEWS = 24;
const CARD_ART_RETRY_DELAY_MS = 10_000;

interface TraceViewTransition {
  finished: Promise<unknown>;
  skipTransition?: () => void;
}

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => TraceViewTransition;
};

function initialFrameAnimations(): boolean {
  try {
    return frameAnimationsFromStoredPreference(localStorage.getItem(FRAME_ANIMATIONS_STORAGE_KEY));
  } catch {
    return true;
  }
}

function cardTransitionStyle(id: string | undefined): CSSProperties | undefined {
  return id ? { viewTransitionName: frameCardTransitionName(id) } as CSSProperties : undefined;
}

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
  stadium: 'Stadium', condition: 'Special condition', system: 'Game',
};

function eventDisplayLabel(event: { id: string; kind: TrackerEventKind; text: string }): string {
  if (/\bended their turn$/i.test(event.text)) return 'Turn end';
  if (/^Game over\b/i.test(event.text)) return 'Result';
  if (/\bbenched\s+/i.test(event.text)) return 'Bench';
  if (/\bevolved\s+/i.test(event.text)) return 'Evolution';
  if (!event.id.includes(':selection:')) return EVENT_LABELS[event.kind];
  if (/searched their deck|from their deck/i.test(event.text)) return 'Deck search';
  if (/discarded /i.test(event.text)) return 'Cards discarded';
  if (/(?:returned|recovered|from the discard pile)/i.test(event.text)) return 'Discard recovery';
  if (/switched |promoted |to the Active Spot/i.test(event.text)) return 'Switch';
  if (/attached /i.test(event.text)) return 'Attachment';
  return 'Choice';
}

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

function fallbackCardArt(name: string): string {
  return CARD_BACK_ART;
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
  return resolvedCardArt(card.cardId, card.imageDataUrl || resolvedCardInfo(card, catalog)?.imageDataUrl);
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
    case 'condition': return <Skull {...props} />;
    default: return <BookOpenText {...props} />;
  }
}

const CONDITION_ABBREVIATIONS: Record<string, string> = {
  Poisoned: 'PSN',
  Burned: 'BRN',
  Asleep: 'SLP',
  Confused: 'CNF',
  Paralyzed: 'PAR',
};

function SpecialConditionIcon({ condition }: { condition: string }) {
  const props = { size: 11, weight: 'fill' as const };
  switch (condition) {
    case 'Poisoned': return <Skull {...props} />;
    case 'Burned': return <Fire {...props} />;
    case 'Asleep': return <MoonStars {...props} />;
    case 'Confused': return <ArrowsClockwise {...props} />;
    case 'Paralyzed': return <Lightning {...props} />;
    default: return <Sparkle {...props} />;
  }
}

function SpecialConditionMarkers({ conditions }: { conditions: string[] }) {
  if (!conditions.length) return null;
  return <span className="special-condition-preview" aria-label={`Special conditions: ${conditions.join(', ')}`}>
    {conditions.map((condition) => <span className={`special-condition-badge condition-${condition.toLowerCase()}`} title={condition} key={condition}>
      <SpecialConditionIcon condition={condition} />
      <b>{CONDITION_ABBREVIATIONS[condition] || condition.slice(0, 3).toUpperCase()}</b>
    </span>)}
  </span>;
}

function StadiumMarker({
  card,
  name,
  owner,
  catalog,
  localPlayer,
  opponent,
  onOpen,
}: {
  card: Card | null;
  name?: string;
  owner?: string;
  catalog: ReadonlyMap<string, CardInfo>;
  localPlayer: string;
  opponent: string;
  onOpen: (card: Card) => void;
}) {
  if (!name) return null;
  const sourceId = card ? cardSourceIdFromReviewCard(card) : undefined;
  const info = findCatalogCard(sourceId, name, catalog);
  const resolvedSourceId = info?.id || sourceId;
  const resolvedName = info?.name || card?.name || name;
  const resolvedCard = info
    ? cardInfoToEngineCard(info, card?.id || `stadium:${info.id}`, resolvedName, info.id)
    : card;
  const artwork = resolvedCardArt(resolvedSourceId, card?.imageUrl || info?.imageDataUrl);
  const ownerClass = owner === localPlayer ? 'owned-local' : owner === opponent ? 'owned-opponent' : '';
  const context = `${resolvedName} is in play${owner ? ` · Played by ${owner}` : ''}`;
  const content = <span className={`stadium-card-peek ${resolvedCard || info ? '' : 'fallback'}`} aria-hidden="true">
    {resolvedCard || info ? <img src={artwork} data-card-id={resolvedSourceId} alt="" onError={showCardBackOnError} /> : <ShieldCheck size={24} weight="fill" />}
  </span>;
  return resolvedCard
    ? <button type="button" className={`stadium-marker ${ownerClass}`} style={cardTransitionStyle(resolvedCard.id)} onClick={() => onOpen(resolvedCard)} aria-label={`${context}. Open card details.`} title={`${context} · Click to inspect`}>{content}</button>
    : <div className={`stadium-marker ${ownerClass}`} aria-label={context} title={context}>{content}</div>;
}

function PokemonSlot({ pokemon, catalog, active = false, defeated = false, attacking = false, damageChange, positionChange, onOpen }: { pokemon: TrackedPokemon | null; catalog: ReadonlyMap<string, CardInfo>; active?: boolean; defeated?: boolean; attacking?: boolean; damageChange?: PokemonDamageChange; positionChange?: PokemonPositionChange; onOpen?: (id: string) => void }) {
  if (!pokemon) {
    return <div className={`pokemon-slot empty ${active ? 'active' : ''}`}><CardsThree size={active ? 30 : 22} weight="duotone" /><span>{active ? 'Active' : 'Bench'}</span></div>;
  }
  const image = resolvedCardImage(pokemon, catalog);
  const displayName = resolvedCardInfo(pokemon, catalog)?.name || pokemon.name;
  const displayedDamage = damageChange?.after ?? pokemon.damage;
  const energyAttachmentCount = Math.max(pokemon.energies.length, pokemon.energyCards?.length || 0);
  const energyAttachments = Array.from({ length: energyAttachmentCount }, (_, index) => {
    const card = pokemon.energyCards?.[index];
    const name = pokemon.energies[index] || card?.name || 'Energy';
    const info = card?.cardId ? catalog.get(card.cardId) || catalog.get(card.cardId.toLowerCase()) : undefined;
    const displayName = info?.name || card?.name || name;
    return {
      card,
      displayName,
      id: card?.id || `${pokemon.id}:energy:${index}`,
      type: findEnergyType(info?.cardType, card?.cardType, card?.name, name),
    };
  });
  const tools = pokemon.toolCards || [];
  const specialConditions = pokemon.statusConditions || [];
  const inspectionLabel = `Inspect ${displayName}${pokemon.cardId ? ` · ${pokemon.cardId}` : ''}${specialConditions.length ? ` · ${specialConditions.join(', ')}` : ''}`;
  return (
    <button type="button" className={`pokemon-slot ${active ? 'active' : ''} ${defeated ? 'defeated' : ''} ${attacking ? 'attacking' : ''} ${damageChange ? damageChange.delta > 0 ? 'damage-increased' : 'damage-decreased' : ''} ${positionChange ? `position-changed moved-to-${positionChange.to}` : ''}`} style={cardTransitionStyle(pokemon.id)} data-pokemon-id={pokemon.id} data-pokemon-name={displayName} title={inspectionLabel} aria-label={inspectionLabel} onClick={() => onOpen?.(pokemon.id)}>
      <img className="card-art" src={image} data-card-id={pokemon.cardId} alt={displayName} onError={showCardBackOnError} />
      {displayedDamage > 0 && <b className="damage-token">{displayedDamage}</b>}
      <SpecialConditionMarkers conditions={specialConditions} />
      {damageChange && <span className={`damage-change-badge ${damageChange.delta > 0 ? 'added' : 'removed'}`} aria-label={damageChange.delta > 0 ? `${damageChange.delta} damage added; ${damageChange.after} total damage` : `${Math.abs(damageChange.delta)} damage removed; ${damageChange.after} total damage`}><b>{damageChange.delta > 0 ? '+' : '−'}{Math.abs(damageChange.delta)}</b><small>damage</small></span>}
      {positionChange && <span className={`position-change-badge to-${positionChange.to}`} aria-label={`${displayName} moved from ${positionChange.from} to ${positionChange.to} by ${positionChange.cause}`} title={`${positionChange.from === 'active' ? 'Active' : 'Bench'} → ${positionChange.to === 'active' ? 'Active' : 'Bench'} · ${positionChange.cause}`}>
        {positionChange.to === 'active' ? <ArrowUp size={10} weight="bold" /> : <ArrowDown size={10} weight="bold" />}
        <b>{positionChange.to === 'active' ? 'Active' : 'Bench'}</b>
      </span>}
      {energyAttachments.length > 0 && <span className="attached-energy-preview" aria-label={`${energyAttachments.map(({ displayName: name }) => name).join(', ')} attached`}>
        {energyAttachments.slice(-3).map(({ card, displayName: energyName, id, type }) => card
          ? <span className="attached-energy-card" style={cardTransitionStyle(card.id)} title={`${energyName} · Attached Energy`} key={id}><img src={resolvedCardImage(card, catalog)} data-card-id={card.cardId} alt="" onError={showCardBackOnError} /></span>
          : <span className={`attached-energy-card energy-card-fallback ${type ? `energy-${type.toLowerCase()}` : ''}`} title={`${energyName} · Attached Energy`} key={id}><i aria-hidden="true" /><small>{energyName.replace(/^Basic\s*/i, '').replace(/\s*Energy$/i, '') || 'Energy'}</small></span>)}
        {energyAttachments.length > 3 && <b className="attached-energy-overflow" aria-label={`${energyAttachments.length - 3} more attached Energy cards`}>+{energyAttachments.length - 3}</b>}
      </span>}
      {tools.length > 0 && <span className="attached-tool-preview" aria-label={`${tools.map((tool) => `${resolvedCardInfo(tool, catalog)?.name || tool.name} Tool`).join(', ')} attached`}>{tools.slice(-2).map((tool) => { const name = resolvedCardInfo(tool, catalog)?.name || tool.name; return <span className="attached-tool-card" style={cardTransitionStyle(tool.id)} title={`${name} · Pokémon Tool`} key={tool.id}><img src={resolvedCardImage(tool, catalog)} data-card-id={tool.cardId} alt="" onError={showCardBackOnError} /><small>Tool</small></span>; })}</span>}
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
  presentTurnEvents(turn)
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
        return <button type="button" className={`choice-card role-${card.choiceRole} ${current ? 'current' : ''}`} aria-current={current ? 'step' : undefined} aria-label={`${roleCopy}: ${name}`} title={`${frame.label} · ${roleCopy}: ${name}`} onClick={() => onOpen(card)} key={`${frame.reviewIndex}-${card.id}-${index}`}><img src={resolvedCardImage(card, catalog)} data-card-id={card.cardId} alt={name} onError={showCardBackOnError} /></button>;
      })}
    </div>
  </aside>;
}

function AttackRoute({ resolution, opponentAttacking, hasImpact }: { resolution: AttackResolution; opponentAttacking: boolean; hasImpact: boolean }) {
  const outcome = resolution.hits.length
    ? `${resolution.source} used ${resolution.attack}. ${resolution.hits.map((hit) => `${hit.damage || 'Effect'} to ${hit.target}${hit.knockedOut ? ', knocked out' : ''}`).join('. ')}`
    : hasImpact
      ? `${resolution.source} used ${resolution.attack} and placed damage counters`
      : `${resolution.source} used ${resolution.attack} with no direct-damage target captured`;
  return <>
    <span className={`attack-route ${opponentAttacking ? 'from-opponent' : 'from-local'} ${hasImpact ? 'has-hit' : 'effect-only'}`} aria-hidden="true">
      <i className="attack-route-trail trail-left" />
      <i className="attack-route-trail trail-right" />
      <i className="attack-route-core"><Sword size={18} weight="fill" /></i>
      <i className="attack-route-impact"><span /></i>
    </span>
    <span className="sr-only" role="img" aria-label={outcome} />
  </>;
}

function ZoneStack({ label, count, tone, onOpen }: { label: string; count: number | string; tone: 'coral' | 'blue'; onOpen?: () => void }) {
  return <button type="button" className={`zone-stack ${tone}`} onClick={onOpen} title={`Open ${label}`}><span>{label}</span><span className="zone-stack-cards"><CardsThree size={36} weight="duotone" /></span><b>{count}</b></button>;
}

function PrizeFan({ count, cards, tone, onOpen }: { count: number; cards: Card[]; tone: 'coral' | 'blue'; onOpen?: () => void }) {
  const remaining = Math.max(0, Math.min(6, count));
  const slots = prizeSlotStates(remaining);
  return (
    <button
      type="button"
      className={`prize-fan ${tone}`}
      onClick={onOpen}
      title="Open Prize cards"
      aria-label={`${remaining} of 6 Prize cards remaining. Open Prize cards.`}
    >
      <span>Prize</span>
      <span className="prize-fan-cards" aria-hidden="true">
        {slots.map((state, index) => (
          <i key={index} className={state} style={cardTransitionStyle(cards[index]?.id)} />
        ))}
      </span>
    </button>
  );
}

function ZoneCards({ label, cards, catalog, onOpen }: { label: string; cards: TrackedCard[]; catalog: ReadonlyMap<string, CardInfo>; onOpen?: () => void }) {
  const visible = cards.slice(-2).reverse();
  return (
    <button type="button" className="zone-card-group" onClick={onOpen} title={`Open ${label}`}><span>{label}</span><span className="zone-card-stack">{(visible.length ? visible : [{ id: `fallback-${label}`, name: label }]).map((card) => { const name = resolvedCardInfo(card, catalog)?.name || card.name; return <img key={card.id} style={card.id.startsWith('fallback-') ? undefined : cardTransitionStyle(card.id)} src={resolvedCardImage(card, catalog)} data-card-id={card.cardId} title={name} alt={name} onError={showCardBackOnError} />; })}</span><b>{cards.length}</b></button>
  );
}

function reviewCardImage(card: Card, catalog: ReadonlyMap<string, CardInfo>): string {
  const sourceId = cardSourceIdFromReviewCard(card);
  const info = sourceId ? catalog.get(sourceId) || catalog.get(sourceId.toLowerCase()) : undefined;
  return resolvedCardArt(sourceId, card.imageUrl || info?.imageDataUrl);
}

function HandFan({ boardName, cards, count, visibility, catalog, opponent, onOpen }: { boardName: string; cards: Card[]; count: number; visibility: Record<string, ReviewCardVisibility>; catalog: ReadonlyMap<string, CardInfo>; opponent: boolean; onOpen: () => void }) {
  const total = Math.max(cards.length, count);
  const displayed = handFanCardCount(total);
  const orderedCards = sortCardsForDisplay(cards, (card) => {
    const sourceId = cardSourceIdFromReviewCard(card);
    return (sourceId ? catalog.get(sourceId) || catalog.get(sourceId.toLowerCase()) : undefined)?.name || card.name;
  });
  const fanState = displayed === 0 ? 'empty' : displayed === 1 ? 'single' : '';
  const fanStyle = { '--hand-gap-count': Math.max(1, displayed - 1) } as CSSProperties;
  return (
    <button type="button" className={`hand-fan ${opponent ? 'opponent-hand' : 'local-hand'}`} onClick={onOpen} title={`Open ${boardName}'s hand`} aria-label={`${boardName} hand, ${total} card${total === 1 ? '' : 's'}`}>
      <span className={`hand-fan-cards ${fanState}`} style={fanStyle} aria-hidden="true">
        {Array.from({ length: displayed }, (_, index) => {
          const card = orderedCards[index];
          const hidden = opponent || !card;
          return hidden
            ? <span className="hand-fan-card hidden" key={card?.id || `hidden-${index}`}><img src="/tracker-assets/pokemon-card-back.jpg" alt="" /></span>
            : <span className="hand-fan-card known" style={cardTransitionStyle(card.id)} key={card.id} title={card.name}><img src={reviewCardImage(card, catalog)} data-card-id={cardSourceIdFromReviewCard(card)} alt="" onError={showCardBackOnError} /></span>;
        })}
      </span>
      <span className="hand-fan-label"><Hand size={14} weight="duotone" /><span>{opponent ? 'Opponent hand' : 'Your hand'}</span><b>{total}</b></span>
    </button>
  );
}

function OpponentHandSummary({ boardName, count, onOpen }: { boardName: string; count: number; onOpen: () => void }) {
  const slots = opponentHandFanSlots(count);
  return (
    <button type="button" className="opponent-hand-summary" onClick={onOpen} title={`Open ${boardName}'s hand`} aria-label={`${boardName} hand, ${count} card${count === 1 ? '' : 's'}`}>
      <span className="opponent-hand-mini-fan" aria-hidden="true">
        {slots.map((state, index) => <i key={index} className={state} />)}
      </span>
      <span className="opponent-hand-label">Hand</span>
      <b>{count}</b>
    </button>
  );
}

function PlayerField({ board, canonical, visibility, catalog, choiceFrames, currentReviewIndex, turnNumber, status, stadiumCard, stadiumName, stadiumOwner, localPlayerName, opponentName, defeatedIds, defeatedNames, damageChanges, positionChanges, attackerId, opponent = false, avatar, onOpenPokemon, onOpenChoice, onOpenCard, onOpenZone }: { board: TrackedPlayerBoard; canonical: PlayerState; visibility: Record<string, ReviewCardVisibility>; catalog: ReadonlyMap<string, CardInfo>; choiceFrames: TurnChoiceFrame[]; currentReviewIndex: number; turnNumber: number; status: PlayerTurnStatus; stadiumCard: Card | null; stadiumName?: string; stadiumOwner?: string; localPlayerName: string; opponentName: string; defeatedIds: ReadonlySet<string>; defeatedNames: ReadonlySet<string>; damageChanges: ReadonlyMap<string, PokemonDamageChange>; positionChanges: ReadonlyMap<string, PokemonPositionChange>; attackerId?: string; opponent?: boolean; avatar: string; onOpenPokemon: (id: string) => void; onOpenChoice: (card: TrackedCard) => void; onOpenCard: (card: Card) => void; onOpenZone: (title: string, subtitle: string, cards: Card[], visibility: Record<string, ReviewCardVisibility>) => void }) {
  const benches = [...board.bench, ...Array.from({ length: Math.max(0, 5 - board.bench.length) }, () => null)].slice(0, 5);
  const tone = opponent ? 'coral' : 'blue';
  const isDefeated = (pokemon: TrackedPokemon | null) => Boolean(pokemon && (defeatedIds.has(pokemon.id) || defeatedNames.has(pokemon.name)));
  const motionKey = (pokemon: TrackedPokemon | null, fallback: string) => pokemon && (pokemon.id === attackerId || isDefeated(pokemon) || damageChanges.has(pokemon.id) || positionChanges.has(pokemon.id))
    ? `${pokemon.id}:motion:${currentReviewIndex}`
    : pokemon?.id || fallback;
  const bench = <div className="bench-row" aria-label={`${board.name} bench`}>{benches.map((pokemon, index) => <PokemonSlot key={motionKey(pokemon, `empty-${index}`)} pokemon={pokemon} catalog={catalog} defeated={isDefeated(pokemon)} attacking={pokemon?.id === attackerId} damageChange={pokemon ? damageChanges.get(pokemon.id) : undefined} positionChange={pokemon ? positionChanges.get(pokemon.id) : undefined} onOpen={onOpenPokemon} />)}</div>;
  const stadiumHere = Boolean(stadiumName) && (stadiumOwner ? stadiumOwner === board.name : !opponent);
  const active = <div className={`active-lane ${stadiumHere ? 'has-stadium-zone' : ''}`}><span>Active</span>{stadiumHere && <StadiumMarker card={stadiumCard} name={stadiumName} owner={stadiumOwner} catalog={catalog} localPlayer={localPlayerName} opponent={opponentName} onOpen={onOpenCard} />}<PokemonSlot key={motionKey(board.active, 'empty-active')} pokemon={board.active} catalog={catalog} active defeated={isDefeated(board.active)} attacking={board.active?.id === attackerId} damageChange={board.active ? damageChanges.get(board.active.id) : undefined} positionChange={board.active ? positionChanges.get(board.active.id) : undefined} onOpen={onOpenPokemon} /><ChoiceStage boardName={board.name} frames={choiceFrames} currentReviewIndex={currentReviewIndex} catalog={catalog} onOpen={onOpenChoice} /></div>;
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
        <div className="player-identity"><img src={avatar} alt="" /><div><span>{opponent ? 'Opponent' : 'You'}</span><strong>{board.name}</strong></div>{opponent && <OpponentHandSummary boardName={board.name} count={handCount} onOpen={openHand} />}</div>
        <div className="turn-statuses" aria-label={`${board.name} turn status`}>
          <span className="status-slot turn-slot">{status.isCurrentTurn && <span className="status-pill current turn-number-pill" aria-label={`Current turn, turn ${turnNumber}`}><Play size={10} weight="fill" /><span>Turn</span><b>{turnNumber}</b><i>Current</i></span>}</span>
          <span className="status-slot supporter-slot"><span className={`status-pill supporter ${status.supporterUsed ? 'active' : 'inactive'}`} aria-label={status.supporterUsed ? 'Supporter used' : 'Supporter not used'} title={status.supporterUsed ? 'A Supporter has already been played this turn' : 'No Supporter has been played this turn'}><Hand size={11} weight="fill" />Supporter <CheckCircle className="status-check" size={9} weight="fill" /></span></span>
          <span className="status-slot stadium-slot"><span className={`status-pill stadium ${status.stadiumUsed ? 'active' : 'inactive'}`} aria-label={status.stadiumUsed ? 'Stadium used' : 'Stadium not used'} title={status.stadiumUsed ? 'A Stadium has already been played this turn' : 'No Stadium has been played this turn'}><ShieldCheck size={11} weight="fill" />Stadium <CheckCircle className="status-check" size={9} weight="fill" /></span></span>
          <span className="status-slot item-lock-slot"><span className={`status-pill item-lock ${status.itemLocked ? 'active' : 'inactive'}`} aria-label={status.itemLocked ? 'Items locked by Itchy Pollen' : 'Items not locked'} title={status.itemLocked ? 'This player cannot play Item cards because of Itchy Pollen' : 'This player can play Item cards'}><Prohibit size={11} weight="bold" />Item lock</span></span>
        </div>
        <div className="strip-zones"><div className="prize-summary"><span>Prize</span><b>{canonical.prizes.length || prizesRemaining(board)}</b>{Array.from({ length: canonical.prizes.length || prizesRemaining(board) }, (_, index) => <i key={index} className="remaining" />)}</div></div>
      </div>
      <div className="field-layout"><PrizeFan count={canonical.prizes.length || prizesRemaining(board)} cards={canonical.prizes} tone={tone} onOpen={() => openZone('Prize cards', canonical.prizes, 'Prize identities stay private until the game reveals them.')} /><div className="battle-lanes">{opponent ? <>{bench}{active}</> : <>{active}{bench}</>}</div><div className="side-piles"><ZoneStack label="Deck" count={displayedDeckCount(board, canonical.deck.length)} tone={tone} onOpen={() => openZone('Deck', canonical.deck, 'The deck remains face-down outside captured search effects.')} /><ZoneCards label="Discard" cards={board.discardCards || []} catalog={catalog} onOpen={() => openZone('Discard pile', canonical.discard, 'Public discarded cards at this exact action.')} />{canonical.lostZone.length > 0 && <button type="button" className="lost-zone-button" onClick={() => openZone('Lost Zone', canonical.lostZone, 'Cards sent to the Lost Zone are public and cannot be recovered.')}><Sparkle size={13} weight="fill" />Lost Zone <b>{canonical.lostZone.length}</b></button>}</div></div>
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

function ArchiveFeaturedCard({ card, label, tone, catalog }: { card: TrackedCard | undefined; label: string; tone: 'local' | 'opponent'; catalog: ReadonlyMap<string, CardInfo> }) {
  const name = card ? (resolvedCardInfo(card, catalog)?.name || card.name) : 'Unknown deck';
  return <span className={`session-featured-card ${tone}`} title={`${label}: ${name}`}>
    <img src={card ? resolvedCardImage(card, catalog) : fallbackCardArt(name)} alt={`${label} deck: ${name}`} onError={showCardBackOnError} />
    <small>{label}</small>
  </span>;
}

function ArchiveRow({ summary, selected, catalog, onSelect }: { summary: MatchSummary; selected: boolean; catalog: ReadonlyMap<string, CardInfo>; onSelect: () => void }) {
  const result = resultLabel(summary);
  const matchup = archiveMatchup(summary, catalog);
  const localCardName = matchup.localCard ? (resolvedCardInfo(matchup.localCard, catalog)?.name || matchup.localCard.name) : 'Unknown deck';
  const opponentCardName = matchup.opponentCard ? (resolvedCardInfo(matchup.opponentCard, catalog)?.name || matchup.opponentCard.name) : 'Unknown deck';
  const dateLabel = formatMatchDate(summary.importedAt);
  const durationLabel = formatMatchDuration(summary.durationSeconds);
  const prizeLabel = formatPrizeScore(matchup.localPrizesTaken, matchup.opponentPrizesTaken);
  return (
    <button
      type="button"
      className={`session-card ${selected ? 'selected' : ''} ${summary.recording ? 'recording' : ''}`}
      onClick={onSelect}
      aria-label={`${result} against ${summary.opponent}. ${localCardName} versus ${opponentCardName}. ${dateLabel}. ${durationLabel}. ${prizeLabel}.`}
    >
      <span className="session-matchup" aria-hidden="true">
        <ArchiveFeaturedCard card={matchup.localCard} label="You" tone="local" catalog={catalog} />
        <span className="session-matchup-versus">VS</span>
        <ArchiveFeaturedCard card={matchup.opponentCard} label="Them" tone="opponent" catalog={catalog} />
      </span>
      <span className="session-copy">
        <span className="session-heading"><strong>vs. {summary.opponent}</strong><em className={result.toLowerCase()}>{result}</em></span>
        <span className="session-decks" title={`${localCardName} versus ${opponentCardName}`}><b>{localCardName}</b><i>vs</i><b>{opponentCardName}</b></span>
        <span className="session-meta">
          <time dateTime={summary.importedAt}><CalendarBlank size={12} weight="bold" />{dateLabel}</time>
          <small><Clock size={12} weight="bold" />{durationLabel}</small>
          <small><Trophy size={12} weight="fill" />{prizeLabel}</small>
        </span>
      </span>
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
  const [frameAnimations, setFrameAnimations] = useState(initialFrameAnimations);
  const [environment, setEnvironment] = useState<TrackerEnvironment>({
    clientInstalled: false, clientRunning: false, pid: null, captureMode: 'existing-client',
    capture: { permissionReady: false, enabled: false, observerRunning: false, routeActive: false, clientAttached: false, frameCount: 0, operationCount: 0, lastError: null, observerPort: 8899 },
  });
  const [showSetup, setShowSetup] = useState(() => {
    if (!isTauri()) return false;
    try { return localStorage.getItem(CAPTURE_DISCLOSURE_KEY) !== 'acknowledged'; }
    catch { return true; }
  });
  const [archiveOpen, setArchiveOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [frameScrubbing, setFrameScrubbing] = useState(false);
  const [busy, setBusy] = useState(false);
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
  const cardRetryAfterRef = useRef(new Map<string, number>());
  const pendingCardIdsRef = useRef(new Set<string>());
  const cardBatchTimerRef = useRef<number | null>(null);
  const persistTimersRef = useRef(new Map<string, number>());
  const lastPersistedAtRef = useRef(new Map<string, number>());
  const browserReviewsRef = useRef(initial);
  const knownSummaryIdsRef = useRef(new Set(initial.map((review) => review.id)));
  const setupPrompted = useRef(false);
  const autoStartAttempted = useRef(false);
  const selectedTimelineEventRef = useRef<HTMLButtonElement | null>(null);
  const turnIndexRef = useRef(turnIndex);
  const requestedTurnIndexRef = useRef(turnIndex);
  const frameTransitionInFlightRef = useRef(false);
  const frameScrubbingRef = useRef(false);
  const frameNavigationGenerationRef = useRef(0);
  const viewTransitionRef = useRef<TraceViewTransition | null>(null);
  const fallbackAnimationTimerRef = useRef<number | null>(null);
  const frameScrubTimerRef = useRef<number | null>(null);

  const toggleFrameAnimations = useCallback(() => {
    setFrameAnimations((current) => {
      const next = !current;
      try { localStorage.setItem(FRAME_ANIMATIONS_STORAGE_KEY, next ? 'on' : 'off'); } catch { /* Preference persistence is optional. */ }
      return next;
    });
  }, []);

  const navigateToFrame = useCallback((next: FrameNavigationRequest) => {
    const current = turnIndexRef.current;
    const last = Math.max(0, (selectedReview?.turns.length || 1) - 1);
    const target = resolveFrameNavigationTarget(requestedTurnIndexRef.current, next, last);
    requestedTurnIndexRef.current = target;
    if (target === current && !frameTransitionInFlightRef.current && !frameScrubbingRef.current) return;

    const generation = ++frameNavigationGenerationRef.current;

    const apply = () => {
      if (generation !== frameNavigationGenerationRef.current) return;
      turnIndexRef.current = target;
      flushSync(() => setTurnIndex(target));
    };
    const stopActiveTransition = () => {
      const activeTransition = viewTransitionRef.current;
      viewTransitionRef.current = null;
      activeTransition?.skipTransition?.();
      frameTransitionInFlightRef.current = false;
      if (fallbackAnimationTimerRef.current != null) {
        window.clearTimeout(fallbackAnimationTimerRef.current);
        fallbackAnimationTimerRef.current = null;
      }
      document.querySelector('.board-frame')?.classList.remove('frame-fallback-forward', 'frame-fallback-backward');
      document.documentElement.classList.remove('trace-frame-transition');
      delete document.documentElement.dataset.frameDirection;
    };
    const continueScrubbing = () => {
      frameScrubbingRef.current = true;
      setFrameScrubbing(true);
      if (frameScrubTimerRef.current != null) window.clearTimeout(frameScrubTimerRef.current);
      frameScrubTimerRef.current = window.setTimeout(() => {
        frameScrubTimerRef.current = null;
        frameScrubbingRef.current = false;
        requestedTurnIndexRef.current = turnIndexRef.current;
        setFrameScrubbing(false);
      }, 120);
    };
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const navigationMode = frameNavigationMode(frameAnimations, Boolean(reduceMotion), frameTransitionInFlightRef.current, frameScrubbingRef.current);
    if (navigationMode === 'instant') {
      stopActiveTransition();
      apply();
      return;
    }

    // A second navigation request turns the interaction into scrubbing. Cancel the
    // decorative transition and commit every requested frame immediately until the
    // user pauses, instead of buffering input behind a 320 ms animation.
    if (navigationMode === 'scrub') {
      stopActiveTransition();
      continueScrubbing();
      apply();
      return;
    }

    const direction = target > current ? 'forward' : 'backward';
    const transitionDocument = document as TransitionDocument;
    const finish = () => {
      frameTransitionInFlightRef.current = false;
    };

    frameTransitionInFlightRef.current = true;
    if (!transitionDocument.startViewTransition) {
      apply();
      const board = document.querySelector('.board-frame');
      if (board instanceof HTMLElement) {
        board.classList.add(`frame-fallback-${direction}`);
        if (fallbackAnimationTimerRef.current != null) window.clearTimeout(fallbackAnimationTimerRef.current);
        fallbackAnimationTimerRef.current = window.setTimeout(() => {
          fallbackAnimationTimerRef.current = null;
          board.classList.remove(`frame-fallback-${direction}`);
          finish();
        }, 320);
      } else {
        finish();
      }
      return;
    }

    document.documentElement.classList.add('trace-frame-transition');
    document.documentElement.dataset.frameDirection = direction;
    const transition = transitionDocument.startViewTransition(apply);
    viewTransitionRef.current = transition;
    void transition.finished.catch(() => undefined).finally(() => {
      if (viewTransitionRef.current !== transition) return;
      viewTransitionRef.current = null;
      document.documentElement.classList.remove('trace-frame-transition');
      delete document.documentElement.dataset.frameDirection;
      finish();
    });
  }, [frameAnimations, selectedReview?.turns.length]);

  const selectedTurn = selectedReview?.turns[Math.min(turnIndex, Math.max(0, selectedReview.turns.length - 1))] || null;
  const selectedCanonical = useMemo(() => selectedReview && selectedTurn
    ? selectedTurn.canonical || trackedTurnToCanonical(selectedReview, selectedTurn)
    : null, [selectedReview, selectedTurn]);
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
  const captureStatus = useMemo(() => captureIndicator(environment), [environment]);

  const timeline = useMemo(() => buildTimeline(selectedReview?.turns || []), [selectedReview]);
  const keyMoments = useMemo(() => buildKeyMoments(selectedReview), [selectedReview]);
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
    const missing = ids.filter((id) => cardCatalogEntryNeedsRefresh(id, catalogRef.current));
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
    // Exact protocol data is sufficient to rebuild a review. Card metadata and
    // artwork are optional enrichment and can be slow or unavailable on a new
    // machine, so they must never sit in the archive's critical path.
    void resolveCardsForOperations(operations);
    const assembler = new LiveReviewAssembler(catalogRef.current);
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
      const now = Date.now();
      const ids = [...pendingCardIdsRef.current].filter((id) =>
        cardCatalogEntryNeedsRefresh(id, catalogRef.current)
        && (cardRetryAfterRef.current.get(id) || 0) <= now
      );
      pendingCardIdsRef.current.clear();
      if (!ids.length) return;
      ids.forEach((id) => requestedCardIdsRef.current.add(id));
      try {
        const catalog = mergeCatalog(await resolveCardSources(ids));
        ids.forEach((id) => {
          if (cardCatalogEntryNeedsRefresh(id, catalog)) {
            requestedCardIdsRef.current.delete(id);
            cardRetryAfterRef.current.set(id, Date.now() + CARD_ART_RETRY_DELAY_MS);
          } else {
            cardRetryAfterRef.current.delete(id);
          }
        });
        if (active) await rebuildActiveMatch();
      } catch (caught) {
        ids.forEach((id) => {
          requestedCardIdsRef.current.delete(id);
          cardRetryAfterRef.current.set(id, Date.now() + CARD_ART_RETRY_DELAY_MS);
        });
        if (active) setError(caught instanceof Error ? caught.message : String(caught));
      }
    };

    const queueCardResolution = (operation: CapturedOperation) => {
      for (const id of collectCardSourceIds(operation.operation)) {
        if (
          cardCatalogEntryNeedsRefresh(id, catalogRef.current)
          && !requestedCardIdsRef.current.has(id)
          && (cardRetryAfterRef.current.get(id) || 0) <= Date.now()
        ) pendingCardIdsRef.current.add(id);
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
          const legacyReviews = localStorage.getItem(STORAGE_MIGRATED_KEY) === '1' ? [] : loadReviews();
          for (const review of legacyReviews) await commitReview(review);
          if (legacyReviews.length) {
            localStorage.setItem(STORAGE_MIGRATED_KEY, '1');
          }
          // The SQLite archive is ready during native setup. Show it before
          // running legacy import/status maintenance, which can be slow on a
          // machine with an old capture file or a cold antivirus scan.
          const stored = await listMatchSummaries(0, 50);
          stored.forEach((summary) => knownSummaryIdsRef.current.add(summary.id));
          setSummaries(stored);
          setArchiveTotal(stored.length);

          const rawIds = await listRawMatchIds(false, 1);
          const preferredId = rawIds[0] || stored[0]?.id;
          const cached = preferredId ? await loadMatchReview(preferredId) : null;
          if (!active) return;
          if (cached) displayReview(cached, true);
          else if (preferredId) {
            selectedIdRef.current = preferredId;
            setSelectedId(preferredId);
          }
          setRestoringReview(false);
          void resolveCardsForPayload([stored, cached]);

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
          if (active) void initializeTrackerStorage()
            .then((refreshed) => { if (active) setArchiveTotal(refreshed.archivedMatches); })
            .catch((caught) => console.warn('Legacy capture maintenance is temporarily unavailable.', caught));
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
  useEffect(() => {
    turnIndexRef.current = turnIndex;
    if (!frameTransitionInFlightRef.current && !frameScrubbingRef.current) requestedTurnIndexRef.current = turnIndex;
  }, [turnIndex]);

  useEffect(() => () => {
    frameNavigationGenerationRef.current += 1;
    viewTransitionRef.current?.skipTransition?.();
    if (fallbackAnimationTimerRef.current != null) window.clearTimeout(fallbackAnimationTimerRef.current);
    if (frameScrubTimerRef.current != null) window.clearTimeout(frameScrubTimerRef.current);
    frameTransitionInFlightRef.current = false;
    frameScrubbingRef.current = false;
    document.documentElement.classList.remove('trace-frame-transition');
    delete document.documentElement.dataset.frameDirection;
  }, []);

  useEffect(() => {
    frameNavigationGenerationRef.current += 1;
    viewTransitionRef.current?.skipTransition?.();
    viewTransitionRef.current = null;
    frameTransitionInFlightRef.current = false;
    frameScrubbingRef.current = false;
    if (frameScrubTimerRef.current != null) {
      window.clearTimeout(frameScrubTimerRef.current);
      frameScrubTimerRef.current = null;
    }
    setFrameScrubbing(false);
    requestedTurnIndexRef.current = Math.min(turnIndexRef.current, Math.max(0, (selectedReview?.turns.length || 1) - 1));
    setTurnIndex((current) => Math.min(current, Math.max(0, (selectedReview?.turns.length || 1) - 1)));
  }, [selectedReview]);

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
      const previousKeyMoment = key === 'arrowup' || key === 'w';
      const nextKeyMoment = key === 'arrowdown' || key === 's';
      if (!previousFrame && !nextFrame && !previousKeyMoment && !nextKeyMoment) return;

      event.preventDefault();
      setPlaying(false);
      setInspector(null);
      navigateToFrame((current) => {
        if (firstFrame) return 0;
        if (latestFrame) return selectedReview.turns.length - 1;
        if (previousFrame) return Math.max(0, current - 1);
        if (nextFrame) return Math.min(selectedReview.turns.length - 1, current + 1);
        return stepKeyMoment(keyMoments, current, previousKeyMoment ? -1 : 1);
      });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inspector, keyMoments, navigateToFrame, selectedReview, showSetup]);

  useEffect(() => {
    if (!playing || !selectedReview) return undefined;
    const selectedFrame = selectedReview.turns[turnIndex];
    const isAttackFrame = selectedFrame?.events.some((event) => event.kind === 'attack' || event.kind === 'damage');
    const timer = window.setTimeout(() => {
      navigateToFrame((current) => {
        if (current >= selectedReview.turns.length - 1) { setPlaying(false); return current; }
        return current + 1;
      });
    }, isAttackFrame ? 2600 : 1200);
    return () => window.clearTimeout(timer);
  }, [navigateToFrame, playing, selectedReview, turnIndex]);

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

  const closeSetup = useCallback(() => {
    try { localStorage.setItem(CAPTURE_DISCLOSURE_KEY, 'acknowledged'); }
    catch { /* Disclosure persistence is best-effort. */ }
    setShowSetup(false);
  }, []);

  const finishSetup = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const permission = await requestCapturePermission();
      setEnvironment((current) => ({ ...current, capture: permission }));
      if (permission.permissionReady) {
        const capture = await startTracking();
        setEnvironment((current) => ({ ...current, capture }));
        closeSetup();
        setNotice('Setup complete. Your next game will be recorded automatically.');
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }, [closeSetup]);

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
    openCard(cardInfoToEngineCard(info, tracked.id, info?.name || tracked.name, tracked.cardId));
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
      setSelectedReview(review);
      setTurnIndex(Math.max(0, review.turns.length - 1));
      void resolveCardsForPayload([summary, review]);
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
      older.forEach((summary) => knownSummaryIdsRef.current.add(summary.id));
      setSummaries((current) => [...current, ...older.filter((summary) => !current.some((item) => item.id === summary.id))]);
      void resolveCardsForPayload(older);
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
            <div className="archive-brand"><span><img src="/tracker-assets/trace-mascot.png" alt="" /></span><div><strong>Trace</strong><small>Every turn, in view</small></div><div className={`header-status ${captureStatus.tone}`} title={environment.capture.lastError || undefined}><i /><b>{captureStatus.label}</b></div></div>
            <div className="archive-title"><div><h2>Match archive</h2><p>{archiveTotal} matches recorded</p></div><button className="panel-collapse-button" type="button" aria-label="Collapse match archive" aria-expanded="true" title="Collapse match archive" onClick={() => setArchiveOpen(false)}><CaretLeft size={17} weight="bold" /></button></div>
          </div>
          <div className="sessions">
            {summaries.map((summary) => <ArchiveRow key={summary.id} summary={summary} selected={summary.id === selectedId} catalog={cardCatalog} onSelect={() => void selectSummary(summary)} />)}
            {!summaries.length && !restoringReview && <div className="empty-library"><BookOpenText size={38} weight="duotone" /><strong>No matches yet</strong><p>Turn on automatic capture and play normally. Your games will collect here.</p><button type="button" onClick={() => importLog(DEMO_BATTLE_LOG)}>Explore a sample</button></div>}
            {!summaries.length && restoringReview && <div className="empty-library archive-loading"><BookOpenText size={38} weight="duotone" /><strong>Restoring your archive…</strong><p>Loading the latest saved match.</p></div>}
          </div>
          <button className="all-matches" type="button" disabled={summaries.length >= archiveTotal} onClick={() => void loadOlderMatches()}><BookOpenText size={19} weight="duotone" /><span>{summaries.length < archiveTotal ? 'Load older matches' : 'All matches loaded'}</span><CaretRight size={17} weight="bold" /></button>
        </aside>}

        <section className="review-stage">
          {restoringReview && !selectedReview ? <div className="welcome-state loading-review"><BookOpenText size={54} weight="duotone" /><span>Restoring match</span><h2>Loading the reconstructed board…</h2><p>The archive index is ready; only this selected match is being read.</p></div> : selectedReview && selectedTurn && localBoard && opponentBoard && selectedCanonical && localCanonicalPlayer && opponentCanonicalPlayer && turnStatus ? <>
            <div className={`board-frame ${frameAnimations ? 'frame-motion-enabled' : ''} ${frameScrubbing ? 'frame-scrubbing' : ''}`}>
              <div className="reconstructed-chip"><CheckCircle size={18} weight="fill" />Board reconstructed</div>
              <PlayerField board={opponentBoard} canonical={opponentCanonicalPlayer} visibility={selectedCanonical.visibility} catalog={cardCatalog} choiceFrames={turnChoiceFrames.filter((frame) => frame.actor === opponentBoard.name)} currentReviewIndex={turnIndex} turnNumber={selectedCanonical.state.turnNumber} status={turnStatus.players[opponentBoard.name]} stadiumCard={selectedCanonical.state.stadium} stadiumName={turnStatus.stadiumName} stadiumOwner={turnStatus.stadiumOwner} localPlayerName={localBoard.name} opponentName={opponentBoard.name} defeatedIds={defeatedIds} defeatedNames={defeatedNames} damageChanges={damageChanges} positionChanges={positionChanges} attackerId={attackResolution?.sourceId} opponent avatar={TRAINER_ART[0]} onOpenPokemon={openPokemon} onOpenChoice={openChoiceCard} onOpenCard={openCard} onOpenZone={openZone} />
              <div className="midline"><span /></div>
              <PlayerField board={localBoard} canonical={localCanonicalPlayer} visibility={selectedCanonical.visibility} catalog={cardCatalog} choiceFrames={turnChoiceFrames.filter((frame) => frame.actor === localBoard.name)} currentReviewIndex={turnIndex} turnNumber={selectedCanonical.state.turnNumber} status={turnStatus.players[localBoard.name]} stadiumCard={selectedCanonical.state.stadium} stadiumName={turnStatus.stadiumName} stadiumOwner={turnStatus.stadiumOwner} localPlayerName={localBoard.name} opponentName={opponentBoard.name} defeatedIds={defeatedIds} defeatedNames={defeatedNames} damageChanges={damageChanges} positionChanges={positionChanges} attackerId={attackResolution?.sourceId} avatar={TRAINER_ART[2]} onOpenPokemon={openPokemon} onOpenChoice={openChoiceCard} onOpenCard={openCard} onOpenZone={openZone} />
              {frameAnimations && !frameScrubbing && attackResolution && <AttackRoute key={`${selectedReview.id}:${turnIndex}:${attackResolution.sourceId || attackResolution.source}`} resolution={attackResolution} opponentAttacking={attackResolution.attacker === opponentBoard.name} hasImpact={attackResolution.hits.length > 0 || [...damageChanges.values()].some((change) => change.delta > 0)} />}
            </div>
            <div className="turn-controls">
              <div className="turn-caption">
                <span className="turn-caption-meta"><small>{selectedTurn.label}</small><b>{turnIndex} / {Math.max(1, selectedReview.turns.length - 1)}</b></span>
                <strong>{currentActionEvents[0]?.text || (selectedTurn.player ? `${selectedTurn.player}'s action` : selectedTurn.label)}</strong>
                <small>{currentActionEvents.slice(1).filter(isSupportingActionEvent).map((event) => event.text).join(' · ') || (selectedTurn.player ? `Action by ${selectedTurn.player}` : selectedTurn.label === 'Capture baseline' ? 'First complete board received' : selectedTurn.label === 'Partial capture' ? 'Capture began before a complete board was available' : 'Opening setup')}</small>
              </div>
              <label className="turn-scrubber"><span className="sr-only">Replay position</span><span className="turn-scrubber-rail" aria-hidden="true"><i style={{ width: `${selectedReview.turns.length > 1 ? (turnIndex / (selectedReview.turns.length - 1)) * 100 : 0}%` }} /></span><input type="range" min="0" max={Math.max(0, selectedReview.turns.length - 1)} value={turnIndex} onChange={(event) => { navigateToFrame(Number(event.target.value)); setPlaying(false); }} /></label>
              <div className="transport-buttons">
                <button className={`frame-motion-button ${frameAnimations ? 'enabled' : ''}`} type="button" aria-pressed={frameAnimations} aria-label={`Replay animations ${frameAnimations ? 'on' : 'off'}`} title={`Replay animations ${frameAnimations ? 'on' : 'off'} · Click to ${frameAnimations ? 'disable' : 'enable'}`} onClick={toggleFrameAnimations}><Sparkle size={17} weight={frameAnimations ? 'fill' : 'regular'} /></button>
                <button type="button" onClick={() => navigateToFrame(0)} disabled={turnIndex === 0} aria-label="First frame" aria-keyshortcuts="Shift+A" title="First frame · Shift+A"><SkipBack size={19} weight="fill" /></button>
                <button type="button" onClick={() => navigateToFrame((value) => Math.max(0, value - 1))} disabled={turnIndex === 0} aria-label="Previous frame" aria-keyshortcuts="ArrowLeft A" title="Previous frame · A or ←"><CaretLeft size={20} weight="bold" /></button>
                <button className="play-button" type="button" onClick={() => { if (!playing && turnIndex >= selectedReview.turns.length - 1) navigateToFrame(0); setPlaying((value) => !value); }} aria-label={playing ? 'Pause replay' : 'Play replay'}>{playing ? <Pause size={23} weight="fill" /> : <Play size={23} weight="fill" />}</button>
                <button type="button" onClick={() => navigateToFrame((value) => Math.min(selectedReview.turns.length - 1, value + 1))} disabled={turnIndex >= selectedReview.turns.length - 1} aria-label="Next frame" aria-keyshortcuts="ArrowRight D" title="Next frame · D or →"><CaretRight size={20} weight="bold" /></button>
                <button type="button" onClick={() => navigateToFrame(selectedReview.turns.length - 1)} disabled={turnIndex >= selectedReview.turns.length - 1} aria-label="Latest frame" aria-keyshortcuts="Shift+D" title="Latest frame · Shift+D"><SkipForward size={19} weight="fill" /></button>
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
                    const selection = selectionForEvent(turn, event);
                    const eventSelectedChoiceNames = selectedCardNames(selection);
                    const visibleFacts = event.facts || [];
                    const displayLabel = eventDisplayLabel(event);
                    const eventCard = event.cardId
                      ? cardCatalog.get(event.cardId) || cardCatalog.get(event.cardId.toLowerCase())
                      : undefined;
                    const effect = cardEffectSummary(event, eventCard);
                    return <article className={`timeline-event-wrap kind-${event.kind} ${event.coinResult ? `coin-${event.coinResult}` : ''} ${selected ? 'selected' : ''}`} key={entry.key} role="listitem" aria-setsize={timeline.entries.length} aria-posinset={entry.position}>
                      <button ref={selected ? selectedTimelineEventRef : undefined} className="timeline-event" type="button" aria-current={selected ? 'step' : undefined} aria-label={`Event ${entry.position} of ${timeline.entries.length}. ${displayLabel}. ${event.text}`} onClick={() => { setSelectedEventKey(entry.key); navigateToFrame(Math.min(entry.reviewIndex, (selectedReview?.turns.length || 1) - 1)); setPlaying(false); setInspector(null); }}>
                        <span className="event-icon"><EventIcon kind={event.kind} /></span>
                        <span className="event-copy"><span className="event-meta"><small>{displayLabel}</small><span>Event {entry.position}</span></span><strong>{event.text}</strong></span>
                        <span className="event-trailing">{event.coinResult ? <b className={`coin-outcome ${event.coinResult}`}><Coin size={10} weight="fill" />{event.coinResult === 'heads' ? 'Heads' : event.coinResult === 'tails' ? 'Tails' : 'Mixed'}</b> : selected ? <b>Viewing</b> : event.id.includes(':selection:') ? <MagnifyingGlass size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}</span>
                      </button>
                      {selected && effect && eventCard && <button className="event-effect-detail" type="button" onClick={() => openChoiceCard({ id: `${event.id}:card`, cardId: eventCard.id, name: eventCard.name })} aria-label={`${effect.label}: ${effect.title}. ${effect.text}. Open card details`}>
                        <img src={eventCard.imageDataUrl || publicCardArtUrl(eventCard.id) || fallbackCardArt(eventCard.name)} data-card-id={eventCard.id} alt="" onError={showCardBackOnError} />
                        <span><small>{effect.label}</small><strong>{effect.title}</strong><p>{effect.text}</p></span>
                        <CaretRight size={14} weight="bold" />
                      </button>}
                      {selected && Boolean(visibleFacts.length) && <details className="event-data-detail">
                        <summary><CaretRight size={12} weight="bold" /><span><b>Action details</b><small>What happened during this action</small></span><strong>{visibleFacts.length}</strong></summary>
                        <dl>
                          {visibleFacts.map((fact) => <div className={`fact-${fact.kind} tone-${fact.tone || 'neutral'}`} key={fact.id}><dt><i />{fact.label}</dt><dd>{fact.value}</dd></div>)}
                        </dl>
                      </details>}
                      {selected && selection && (eventSelectedChoiceNames.length > 0 || selection.allOptionIds.length > 0) && <div className="timeline-event-detail"><span>{selection.candidateVisibility === 'private' ? <><b>{eventSelectedChoiceNames.length ? eventSelectedChoiceNames.join(' + ') : 'Hidden choice'}</b><small>{eventSelectedChoiceNames.length ? 'Only the chosen card was revealed' : 'The available cards stayed hidden'}</small></> : <><b>{eventSelectedChoiceNames.length ? eventSelectedChoiceNames.join(' + ') : 'Cards viewed'}</b><small>{selection.allOptionIds.length} card{selection.allOptionIds.length === 1 ? '' : 's'} viewed · {eventSelectedChoiceNames.length} chosen</small></>}</span><button type="button" onClick={() => openSelection(selection)}>{eventSelectedChoiceNames.length ? 'View chosen cards' : 'Review cards'}</button></div>}
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

      {showSetup && <div className="modal-backdrop"><div className="setup-modal"><div className="modal-title"><div><span>Trace settings</span><h2>Replay and capture</h2></div><button type="button" disabled={busy} onClick={closeSetup} aria-label="Close settings"><X size={21} weight="bold" /></button></div><p>Choose how replays move, then manage Trace's connection to TCG Live.</p><div className="settings-toggle-row replay-animation-setting"><div><Sparkle size={22} weight="duotone" /><span><strong>Animated replay frames</strong><small>Cards glide, fade, and scale between their exact board positions.</small></span></div><button type="button" role="switch" aria-label="Animated replay frames" aria-checked={frameAnimations} className={frameAnimations ? 'enabled' : ''} onClick={toggleFrameAnimations}><span />{frameAnimations ? 'On' : 'Off'}</button></div><small className="capture-privacy-disclosure">By connecting, Trace securely sends and stores captured match data, including player names and game actions.</small><div className="modal-actions"><button type="button" disabled={busy} onClick={closeSetup}>Close</button><button className="primary" type="button" disabled={busy} onClick={() => void finishSetup()}>{busy ? 'Working…' : environment.capture.permissionReady ? 'Reconnect capture' : 'Connect capture'}</button></div></div></div>}
      <ReviewOverlay inspector={inspector} catalog={cardCatalog} onClose={() => setInspector(null)} onInspectCard={openCard} />
      <UpdateNotice />
      {(notice || error) && <div className={`toast ${error ? 'error' : ''}`}><span>{error ? <X size={18} weight="bold" /> : <CheckCircle size={18} weight="fill" />}</span><p>{error || notice}</p><button type="button" onClick={() => { setError(null); setNotice(null); }} aria-label="Dismiss notification"><X size={16} weight="bold" /></button></div>}
    </div>
  );
}

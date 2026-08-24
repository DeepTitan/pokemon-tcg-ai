import type { PokemonInPlay } from '../engine/types.js';
import type { CanonicalReviewState, MatchReview, ReviewAppliedEffect, TrackedTurn, TrackerEvent } from './types.js';

export interface PlayerTurnStatus {
  isCurrentTurn: boolean;
  supporterUsed: boolean;
  stadiumUsed: boolean;
  itemLocked: boolean;
}

export interface ReviewTurnStatus {
  currentPlayer?: string;
  stadiumName?: string;
  stadiumOwner?: string;
  players: Record<string, PlayerTurnStatus>;
}

function actorForTurn(turn: TrackedTurn): string | undefined {
  return turn.player || turn.events.find((event) => event.actor)?.actor;
}

function actorForEvent(event: TrackerEvent, players: string[]): string | undefined {
  if (event.actor) return event.actor;
  return [...players].sort((left, right) => right.length - left.length)
    .find((player) => event.text.startsWith(`${player}:`) || event.text.startsWith(`${player} `) || event.text.startsWith(`${player}'s `));
}

function stadiumEvent(event: TrackerEvent, stadiumName?: string): boolean {
  if (event.kind === 'stadium' || /stadium spot|stadium was|stadium in play/i.test(event.text)) return true;
  return event.kind === 'trainer' && Boolean(stadiumName) && event.text.toLowerCase().includes(stadiumName!.toLowerCase());
}

function supporterEvent(event: TrackerEvent): boolean {
  return event.kind === 'trainer' && (/supporter/i.test(event.cardType || '') || /^s/i.test(event.cardFormat || ''));
}

function turnSegment(review: MatchReview, selectedIndex: number, currentPlayer?: string): TrackedTurn[] {
  if (!currentPlayer) return [];
  let start = selectedIndex;
  while (start > 0) {
    const previous = review.turns[start - 1];
    const previousActor = actorForTurn(previous);
    if (previousActor && previousActor !== currentPlayer) break;
    if (previous.label.split(/\s+·\s+/)[0] !== review.turns[selectedIndex].label.split(/\s+·\s+/)[0]) break;
    start -= 1;
  }
  return review.turns.slice(start, selectedIndex + 1);
}

function collectPokemonIds(pokemon: PokemonInPlay | null | undefined, found: Set<string>): void {
  if (!pokemon) return;
  found.add(pokemon.card.id);
  if (pokemon.card.cardNumber) found.add(pokemon.card.cardNumber);
  collectPokemonIds(pokemon.previousStage, found);
}

function idsForPlayer(canonical: CanonicalReviewState, playerIndex: number): Set<string> {
  const found = new Set<string>();
  const player = canonical.state.players[playerIndex];
  collectPokemonIds(player.active, found);
  player.bench.forEach((pokemon) => collectPokemonIds(pokemon, found));
  return found;
}

function isItemLockEffect(effect: ReviewAppliedEffect, hasItchyPollenEvent: boolean): boolean {
  if (!effect.enabled) return false;
  const description = `${effect.name} ${effect.effectType || ''}`;
  if (/itchy pollen|preventitem|itemcardplay|item lock/i.test(description)) return true;
  return hasItchyPollenEvent && /preventtrainercardplay/i.test(description);
}

function latestEvent(
  review: MatchReview,
  selectedIndex: number,
  predicate: (event: TrackerEvent) => boolean,
): { event: TrackerEvent; turnIndex: number } | undefined {
  for (let turnIndex = selectedIndex; turnIndex >= 0; turnIndex -= 1) {
    const events = review.turns[turnIndex]?.events || [];
    for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
      if (predicate(events[eventIndex])) return { event: events[eventIndex], turnIndex };
    }
  }
  return undefined;
}

function fallbackItchyPollenTarget(review: MatchReview, selectedIndex: number): string | undefined {
  const latest = latestEvent(review, selectedIndex, (event) => /itchy pollen/i.test(event.text));
  if (!latest) return undefined;
  const attacker = actorForEvent(latest.event, review.players);
  const target = review.players.find((player) => player !== attacker);
  if (!attacker || !target) return undefined;

  let targetTurnStarted = false;
  for (let index = latest.turnIndex + 1; index <= selectedIndex; index += 1) {
    const actor = actorForTurn(review.turns[index]);
    if (actor === target) targetTurnStarted = true;
    if (targetTurnStarted && actor === attacker) return undefined;
  }
  return target;
}

export function deriveReviewTurnStatus(
  review: MatchReview,
  selectedIndex: number,
  canonical: CanonicalReviewState,
): ReviewTurnStatus {
  const selectedTurn = review.turns[selectedIndex];
  const currentPlayer = actorForTurn(selectedTurn)
    || canonical.playerNames[canonical.state.currentPlayer];
  const stadiumName = canonical.state.stadium?.name || selectedTurn.snapshot.stadium || undefined;
  const segment = turnSegment(review, selectedIndex, currentPlayer);
  const players = Object.fromEntries(review.players.map((player) => [player, {
    isCurrentTurn: player === currentPlayer,
    supporterUsed: segment.some((turn) => turn.events.some((event) => (
      actorForEvent(event, review.players) === player && supporterEvent(event)
    ))),
    stadiumUsed: segment.some((turn) => turn.events.some((event) => (
      actorForEvent(event, review.players) === player && stadiumEvent(event, stadiumName)
    ))),
    itemLocked: false,
  }])) as Record<string, PlayerTurnStatus>;

  const latestStadium = stadiumName
    ? latestEvent(review, selectedIndex, (event) => stadiumEvent(event, stadiumName))
    : undefined;
  const stadiumOwner = latestStadium
    ? actorForEvent(latestStadium.event, review.players)
    : undefined;

  const latestItchyPollen = latestEvent(review, selectedIndex, (event) => /itchy pollen/i.test(event.text));
  const mappedLocks = new Set<string>();
  let hasUnmappedLock = false;
  Object.entries(canonical.appliedEffects).forEach(([entityId, effects]) => {
    const lockEffects = effects.filter((effect) => isItemLockEffect(effect, Boolean(latestItchyPollen)));
    if (!lockEffects.length) return;
    const matchedPlayer = canonical.playerNames.find((_, playerIndex) => idsForPlayer(canonical, playerIndex).has(entityId));
    if (matchedPlayer) mappedLocks.add(matchedPlayer);
    else hasUnmappedLock = true;
  });

  mappedLocks.forEach((player) => { if (players[player]) players[player].itemLocked = true; });
  const fallbackTarget = fallbackItchyPollenTarget(review, selectedIndex);
  if ((!mappedLocks.size || hasUnmappedLock) && fallbackTarget && players[fallbackTarget]) {
    players[fallbackTarget].itemLocked = true;
  }

  return { currentPlayer, stadiumName, stadiumOwner, players };
}

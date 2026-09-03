import type {
  CapturedOperation,
  CardInfo,
  CanonicalReviewState,
  MatchReview,
  ReviewAppliedEffect,
  ReviewCardVisibility,
  ReviewEventFact,
  ReviewProtocolGroup,
  ReviewSelection,
  TrackedCard,
  TrackedChoiceCard,
  TrackedPlayerBoard,
  TrackedPokemon,
  TrackerBoardSnapshot,
  TrackerEvent,
  TrackerEventKind,
} from './types.js';
import {
  CardType,
  EnergyType,
  GamePhase,
  PokemonStage,
  StatusCondition,
  TrainerType,
  type Card,
  type EnergyCard,
  type GameState,
  type PlayerState,
  type PokemonCard,
  type PokemonInPlay,
  type TrainerCard,
} from '../engine/types.js';
import { cardInfoToEngineCard, cardSourceIdFromReviewCard, hiddenReviewCard } from './card-adapter.js';

type Entity = Record<string, unknown>;

const BOARD_POSITIONS = [
  'NONE', 'Board', 'BoardStadium', 'Player1', 'Player2', 'Player1VisiblePending',
  'Player2VisiblePending', 'Player1Deck', 'Player2Deck', 'Player1Discard',
  'Player2Discard', 'Player1Hand', 'Player2Hand', 'Player1Bench', 'Player2Bench',
  'Player1Active', 'Player2Active', 'Player1LostZone', 'Player2LostZone',
  'Player1Prize', 'Player2Prize', 'Player1HiddenPending', 'Player2HiddenPending',
] as const;

const OPERATION_TYPES = [
  'None', 'Use', 'Place', 'Evolve', 'Attach', 'Retreat', 'End turn', 'Start turn',
  'Quit', 'Emote', 'Timeout', 'End turn timeout',
] as const;

function record(value: unknown): Entity | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Entity : null;
}

function value(object: Entity | null, ...names: string[]): unknown {
  if (!object) return undefined;
  for (const name of names) {
    if (name in object) return object[name];
    const found = Object.keys(object).find((key) => key.toLowerCase() === name.toLowerCase());
    if (found) return object[found];
  }
  return undefined;
}

function text(object: Entity | null, ...names: string[]): string | undefined {
  const candidate = value(object, ...names);
  if (typeof candidate === 'string' && candidate) return candidate;
  if (typeof candidate === 'number') return String(candidate);
  return undefined;
}

function number(object: Entity | null, ...names: string[]): number | undefined {
  const candidate = value(object, ...names);
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === 'string' && candidate.trim() && Number.isFinite(Number(candidate))) return Number(candidate);
  return undefined;
}

function bool(object: Entity | null, ...names: string[]): boolean | undefined {
  const candidate = value(object, ...names);
  return typeof candidate === 'boolean' ? candidate : undefined;
}

function collection(candidate: unknown): unknown[] {
  if (Array.isArray(candidate)) return candidate;
  const wrapped = record(candidate);
  const values = wrapped && value(wrapped, '$values', 'values');
  return Array.isArray(values) ? values : [];
}

function cardEntitiesFrom(candidate: unknown): Entity[] {
  const found: Entity[] = [];
  const visit = (nestedCandidate: unknown): void => {
    if (Array.isArray(nestedCandidate)) {
      nestedCandidate.forEach(visit);
      return;
    }
    const nested = record(nestedCandidate);
    if (!nested) return;
    if (entityId(nested)) found.push(nested);
    for (const name of ['attachedEnergy', 'attachedPokemon', 'attachedTools']) {
      collection(value(nested, name)).forEach(visit);
    }
  };
  visit(candidate);
  return found;
}

function matchBoardEntities(operation: Entity): Entity[] {
  const board = record(value(operation, 'matchBoard', 'MatchBoard'));
  if (!board) return [];
  const found: Entity[] = [];
  const boardZonePosition: Record<string, number> = {
    stadium: 2,
    p1Deck: 7, p2Deck: 8,
    p1Discard: 9, p2Discard: 10,
    p1Hand: 11, p2Hand: 12,
    p1Bench: 13, p2Bench: 14,
    p1Active: 15, p2Active: 16,
    p1Prize: 19, p2Prize: 20,
  };
  for (const zone of [
    'boardEntity', 'player1', 'player2', 'stadium',
    'p1Active', 'p1Bench', 'p1Deck', 'p1Discard', 'p1Hand', 'p1Prize',
    'p2Active', 'p2Bench', 'p2Deck', 'p2Discard', 'p2Hand', 'p2Prize',
  ]) {
    const zoneValue = value(board, zone);
    const zoneItems = Array.isArray(zoneValue) ? zoneValue : [zoneValue];
    zoneItems.forEach((item, index) => {
      const zoneEntity = record(item);
      if (!zoneEntity) return;
      const stableEntity = {
        ...zoneEntity,
        ...(position(zoneEntity) === 'NONE' && boardZonePosition[zone] != null
          ? { currentGamePos: boardZonePosition[zone], currentPos: boardZonePosition[zone] }
          : {}),
        ...(entityId(zoneEntity) ? {} : { entityID: `match-board:${zone}:${index}` }),
      };
      found.push(...cardEntitiesFrom(stableEntity));
    });
  }
  return found;
}

function list(object: Entity | null, ...names: string[]): unknown[] {
  return collection(value(object, ...names));
}

function entityId(entity: Entity): string | undefined {
  return text(entity, 'entityID', 'entityId', 'EntityID');
}

function position(entity: Entity): string {
  const candidate = value(entity, 'currentGamePos', 'currentPos', 'CurrentGamePos');
  if (typeof candidate === 'number') return BOARD_POSITIONS[candidate] || `Position${candidate}`;
  if (typeof candidate === 'string') {
    const numeric = Number(candidate);
    if (Number.isInteger(numeric)) return BOARD_POSITIONS[numeric] || `Position${numeric}`;
    return candidate.replace(/^BoardPos\./, '');
  }
  return 'NONE';
}

function sourceFor(entity: Entity): Entity | null {
  return record(value(entity, '_cardSource', 'cardSource', 'CardSource'));
}

function cardSourceId(entity: Entity | undefined): string | undefined {
  return entity ? text(entity, 'cardSourceID', 'cardSourceId') : undefined;
}

function cardInfo(entity: Entity | undefined, catalog: ReadonlyMap<string, CardInfo>): CardInfo | undefined {
  const id = cardSourceId(entity);
  return id ? (catalog.get(id) || catalog.get(id.toLowerCase())) : undefined;
}

function cardName(entity: Entity | undefined, catalog: ReadonlyMap<string, CardInfo>): string {
  if (!entity) return 'Unknown card';
  const source = sourceFor(entity);
  return cardInfo(entity, catalog)?.name
    || text(source, 'localizedCardName', 'cardName', 'name', 'title')
    || text(entity, 'localizedCardName', 'cardName', 'name')
    || text(entity, 'cardSourceID', 'cardSourceId')
    || 'Unknown card';
}

function deepMerge(previous: Entity | undefined, next: Entity): Entity {
  const merged: Entity = { ...(previous || {}) };
  for (const [key, nextValue] of Object.entries(next)) {
    const priorValue = record(merged[key]);
    const nextRecord = record(nextValue);
    merged[key] = priorValue && nextRecord ? deepMerge(priorValue, nextRecord) : nextValue;
  }
  return merged;
}

function messageFingerprint(captured: CapturedOperation): string {
  const serialized = JSON.stringify(captured.operation);
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    fnv = Math.imul(fnv ^ code, 0x01000193);
    djb = Math.imul(djb, 33) ^ code;
  }
  return `${captured.messageIndex ?? 'no-index'}:${captured.messageType ?? 'no-type'}:${serialized.length}:${fnv >>> 0}:${djb >>> 0}`;
}

/** Collect every entity batch, including the wrapped UpdatedEntities lists inside modifications. */
function updatedEntities(operation: Entity): Entity[] {
  const found: Entity[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    const nested = record(candidate);
    if (!nested) return;
    for (const [key, nestedValue] of Object.entries(nested)) {
      if (key.toLowerCase() === 'updatedentities') {
        for (const item of collection(nestedValue)) {
          const entity = record(item);
          if (entity) found.push(...cardEntitiesFrom(entity));
        }
      } else if (!['matchboard', 'cardentities', 'playerselection'].includes(key.toLowerCase()) && (Array.isArray(nestedValue) || record(nestedValue))) {
        visit(nestedValue);
      }
    }
  };
  for (const direct of list(operation, 'updatedEntities', 'UpdatedEntities')) {
    const directEntity = record(direct);
    if (directEntity) found.push(...cardEntitiesFrom(directEntity));
  }
  visit(value(operation, 'actionModifications', 'ActionModifications'));
  if (!value(operation, 'matchBoard', 'MatchBoard') && !found.length) {
    visit(value(operation, 'matchOperationResult', 'MatchOperationResult'));
  }
  return found;
}

function entityReferences(entity: Entity, ...names: string[]): string[] {
  return list(entity, ...names).flatMap((candidate) => {
    if (typeof candidate === 'string') return [candidate];
    const nested = record(candidate);
    const id = nested && entityId(nested);
    return id ? [id] : [];
  });
}

function asTrackedCard(entity: Entity, catalog: ReadonlyMap<string, CardInfo>): TrackedCard {
  const info = cardInfo(entity, catalog);
  return {
    id: entityId(entity) || `unknown-${cardName(entity, catalog)}`,
    cardId: cardSourceId(entity),
    name: cardName(entity, catalog),
    cardType: info?.cardType,
  };
}

function attachedEntityIds(entity: Entity, entities: Map<string, Entity>, ...names: string[]): string[] {
  const parentId = entityId(entity);
  const parentPosition = position(entity);
  return entityReferences(entity, ...names).filter((attachedId) => {
    const attached = entities.get(attachedId);
    if (!attached) return false;
    const attachedPosition = position(attached);
    const explicitParent = text(
      attached,
      'currentParentEntityID', 'currentParentEntityId',
      'curParentEntityID', 'curParentEntityId',
      'parentEntityID', 'parentEntityId',
    );
    if (explicitParent && parentId && explicitParent !== parentId) return false;
    return attachedPosition === 'NONE' || attachedPosition === parentPosition;
  });
}

function asPokemon(entity: Entity, entities: Map<string, Entity>, catalog: ReadonlyMap<string, CardInfo>): TrackedPokemon {
  const tracked = asTrackedCard(entity, catalog);
  const source = sourceFor(entity);
  const info = cardInfo(entity, catalog);
  const energyIds = attachedEntityIds(entity, entities, 'attachedEnergy', 'AttachedEnergy');
  const attachedPokemonIds = attachedEntityIds(entity, entities, 'attachedPokemon', 'AttachedPokemon');
  const toolIds = attachedEntityIds(entity, entities, 'attachedTools', 'AttachedTools');
  const energies = energyIds.map((energyId) => cardName(entities.get(energyId), catalog));
  const evolutionStack = attachedPokemonIds.map((pokemonId) => cardName(entities.get(pokemonId), catalog));
  const statuses = list(entity, 'appliedStatusEffects', 'AppliedStatusEffects')
    .map(record)
    .filter((status): status is Entity => Boolean(status))
    .filter((status) => bool(status, 'activated') !== false && bool(status, 'effectEnabled') !== false)
    .map((status) => text(status, 'actionName', 'ActionName'))
    .filter((name): name is string => Boolean(name))
    .map((name) => name.replace(/^\[Ability\]\s*/, ''));
  return {
    ...tracked,
    damage: (number(entity, 'damageCounters', 'DamageCounters') || 0) * 10,
    maxHp: info?.hp || number(source, 'hp', 'HP', 'hitPoints'),
    energies: energies.filter((name) => name !== 'Unknown card'),
    evolutionStack: evolutionStack.filter((name) => name !== 'Unknown card'),
    energyCards: energyIds.map((id) => entities.get(id)).filter((candidate): candidate is Entity => Boolean(candidate)).map((candidate) => asTrackedCard(candidate, catalog)),
    evolutionCards: attachedPokemonIds.map((id) => entities.get(id)).filter((candidate): candidate is Entity => Boolean(candidate)).map((candidate) => asTrackedCard(candidate, catalog)),
    toolCards: toolIds.map((id) => entities.get(id)).filter((candidate): candidate is Entity => Boolean(candidate)).map((candidate) => asTrackedCard(candidate, catalog)),
    statusConditions: statuses,
  };
}

function isMainPokemon(entity: Entity, entities: Map<string, Entity>): boolean {
  const id = entityId(entity);
  if (!id) return true;
  if (text(entity, 'currentParentEntityID', 'currentParentEntityId', 'curParentEntityID', 'curParentEntityId', 'parentEntityID', 'parentEntityId')) return false;
  return ![...entities.values()].some((candidate) =>
    candidate !== entity
    && position(candidate) === position(entity)
    && entityReferences(
      candidate,
      'attachedPokemon', 'AttachedPokemon',
      'attachedEnergy', 'AttachedEnergy',
      'attachedTool', 'AttachedTool',
      'attachedTools', 'AttachedTools',
    ).includes(id)
  );
}

function isPokemonCard(entity: Entity, catalog: ReadonlyMap<string, CardInfo>): boolean {
  const info = cardInfo(entity, catalog);
  if (info) return info.category === 1 || (info.hp || 0) > 0;
  if (text(entity, 'currentParentEntityID', 'currentParentEntityId', 'curParentEntityID', 'curParentEntityId')) return false;
  const source = sourceFor(entity);
  return !source || (number(source, 'hp', 'HP', 'hitPoints') || 0) > 0;
}

function reviewCard(entity: Entity, catalog: ReadonlyMap<string, CardInfo>, forceKnown = false): Card {
  const id = entityId(entity) || `hidden-${Math.random().toString(36).slice(2)}`;
  const sourceId = cardSourceId(entity);
  if (!sourceId && !forceKnown) return hiddenReviewCard(id);
  return cardInfoToEngineCard(cardInfo(entity, catalog), id, cardName(entity, catalog), sourceId);
}

function pokemonCard(entity: Entity, catalog: ReadonlyMap<string, CardInfo>): PokemonCard {
  const converted = reviewCard(entity, catalog, true);
  if (converted.cardType === CardType.Pokemon) return converted as PokemonCard;
  const source = sourceFor(entity);
  const maximumHp = cardInfo(entity, catalog)?.hp || number(source, 'hp', 'HP', 'hitPoints') || 0;
  const pokemon = {
    id: converted.id,
    name: converted.name,
    imageUrl: converted.imageUrl,
    cardNumber: converted.cardNumber,
    cardType: CardType.Pokemon,
    hp: maximumHp,
    stage: PokemonStage.Basic,
    type: EnergyType.Colorless,
    retreatCost: 0,
    attacks: [],
    prizeCards: 1,
    isRulebox: false,
  } as PokemonCard & { reviewSourceId?: string };
  pokemon.reviewSourceId = cardSourceIdFromReviewCard(converted);
  return pokemon;
}

function statusConditions(entity: Entity): StatusCondition[] {
  const names = list(entity, 'appliedStatusEffects', 'AppliedStatusEffects')
    .map(record)
    .filter((status): status is Entity => Boolean(status))
    .filter((status) => bool(status, 'activated') !== false && bool(status, 'effectEnabled') !== false)
    .map((status) => `${text(status, 'actionName', 'ActionName') || ''} ${text(record(value(status, 'statusEffect')), '$type') || ''}`.toLowerCase());
  const found = new Set<StatusCondition>();
  for (const name of names) {
    if (name.includes('poison')) found.add(StatusCondition.Poisoned);
    if (name.includes('burn')) found.add(StatusCondition.Burned);
    if (name.includes('sleep') || name.includes('asleep')) found.add(StatusCondition.Asleep);
    if (name.includes('confus')) found.add(StatusCondition.Confused);
    if (name.includes('paraly')) found.add(StatusCondition.Paralyzed);
  }
  return [...found];
}

function inPlayPokemon(
  entity: Entity,
  entities: Map<string, Entity>,
  catalog: ReadonlyMap<string, CardInfo>,
  seen = new Set<string>(),
): PokemonInPlay {
  const id = entityId(entity) || '';
  const nextSeen = new Set(seen);
  nextSeen.add(id);
  const card = pokemonCard(entity, catalog);
  const damageCounters = number(entity, 'damageCounters', 'DamageCounters') || 0;
  const energy = attachedEntityIds(entity, entities, 'attachedEnergy', 'AttachedEnergy')
    .map((attachedId) => entities.get(attachedId))
    .filter((candidate): candidate is Entity => Boolean(candidate))
    .map((candidate) => reviewCard(candidate, catalog, true))
    .filter((candidate): candidate is EnergyCard => candidate.cardType === CardType.Energy);
  const tools = attachedEntityIds(entity, entities, 'attachedTools', 'AttachedTools')
    .map((attachedId) => entities.get(attachedId))
    .filter((candidate): candidate is Entity => Boolean(candidate))
    .map((candidate) => reviewCard(candidate, catalog, true))
    .filter((candidate): candidate is TrainerCard => candidate.cardType === CardType.Trainer);
  const previousEntity = attachedEntityIds(entity, entities, 'attachedPokemon', 'AttachedPokemon')
    .map((attachedId) => entities.get(attachedId))
    .find((candidate) => candidate && !nextSeen.has(entityId(candidate) || ''));
  return {
    card,
    currentHp: Math.max(0, card.hp - damageCounters * 10),
    attachedEnergy: energy,
    statusConditions: statusConditions(entity),
    damageCounters,
    attachedTools: tools,
    isEvolved: Boolean(previousEntity),
    turnPlayed: 0,
    previousStage: previousEntity ? inPlayPokemon(previousEntity, entities, catalog, nextSeen) : undefined,
    damageShields: [],
    cannotRetreat: false,
  };
}

function emptyPlayerState(): PlayerState {
  return {
    deck: [], hand: [], active: null, bench: [], prizes: [], discard: [], lostZone: [],
    supporterPlayedThisTurn: false,
    energyAttachedThisTurn: false,
    retreatedThisTurn: false,
    prizeCardsRemaining: 6,
    extraTurn: false,
    skipNextTurn: false,
    abilitiesUsedThisTurn: [],
  };
}

function selectionKind(variableSelection: Entity): ReviewSelection['kind'] {
  const type = text(variableSelection, '$type', 'type') || '';
  if (/DamageSelection/i.test(type)) return 'damage';
  if (/ReparentSelection/i.test(type)) return 'reparent';
  if (/TextSelection/i.test(type)) return 'text';
  if (/EntitySelection/i.test(type)) return 'entity';
  return 'unknown';
}

function optionId(candidate: unknown): string | undefined {
  if (typeof candidate === 'string') return candidate;
  const nested = record(candidate);
  if (!nested) return undefined;
  const address = record(value(nested, 'cardAddress', 'CardAddress')) || nested;
  return entityId(address);
}

function explicitSelectionAmount(container: Entity | null, ...keys: string[]): number | undefined {
  const amount = record(value(container, ...keys));
  if (!amount) return undefined;
  const nested = record(value(amount, 'value1', 'Value1'));
  return number(amount, 'explicitValue', 'ExplicitValue')
    ?? number(nested, 'explicitValue', 'ExplicitValue');
}

function selectionFromOperation(operation: Entity, entities: Map<string, Entity>, catalog: ReadonlyMap<string, CardInfo>): ReviewSelection | undefined {
  const playerSelection = record(value(operation, 'playerSelection', 'PlayerSelection'));
  const variableSelection = record(value(playerSelection, 'variableSelection', 'VariableSelection'));
  const id = text(playerSelection, 'selectionID', 'selectionId');
  if (!playerSelection || !variableSelection || !id) {
    // Private opponent choices use a second protocol shape. The server sends
    // the selection settings and filters, but intentionally withholds the full
    // candidate list. Its later completion and MoveCards delta still reveal
    // the exact public result. Preserve that distinction in the review model.
    const settings = record(value(operation, 'variableSelectionSettings', 'VariableSelectionSettings'));
    const directId = text(operation, 'selectionID', 'selectionId');
    if (!settings || !directId) return undefined;
    const groupSettings = list(settings, 'selectionGroupSettings', 'SelectionGroupSettings').map(record).filter((candidate): candidate is Entity => Boolean(candidate));
    const groupMinimums = groupSettings.map((group) => explicitSelectionAmount(group, 'minSelectionAmount', 'MinSelectionAmount')).filter((candidate): candidate is number => candidate != null);
    const groupMaximums = groupSettings.map((group) => explicitSelectionAmount(group, 'maxSelectionAmount', 'MaxSelectionAmount')).filter((candidate): candidate is number => candidate != null);
    const optional = /optional/i.test(text(settings, 'plLocID', 'plLocId') || '');
    const minimum = explicitSelectionAmount(settings, 'minSelectionAmount', 'MinSelectionAmount')
      ?? (groupMinimums.length ? Math.min(...groupMinimums) : optional ? 0 : 0);
    const maximum = explicitSelectionAmount(settings, 'maxSelectionAmount', 'MaxSelectionAmount')
      ?? (groupMaximums.length ? Math.max(...groupMaximums) : 1);
    const sourceEntityId = text(operation, 'originCardEntityID', 'originCardEntityId');
    return {
      id: directId,
      kind: selectionKind(settings),
      candidateVisibility: 'private',
      selectionMethod: number(operation, 'selectionMethod', 'SelectionMethod'),
      sourceEntityId,
      sourceCardId: sourceEntityId ? cardSourceId(entities.get(sourceEntityId)) : undefined,
      sourceZonePositions: [],
      allOptionIds: [],
      eligibleOptionIds: [],
      selectedOptionIds: [],
      optionCards: [],
      minimum: Number.isFinite(minimum) ? minimum : 0,
      maximum: Number.isFinite(maximum) ? maximum : 1,
      completed: false,
    };
  }
  const allOptionIds = list(variableSelection, 'allOptions', 'AllOptions').map(optionId).filter((candidate): candidate is string => Boolean(candidate));
  const eligibleOptionIds = list(variableSelection, 'allValidOptions', 'AllValidOptions').map(optionId).filter((candidate): candidate is string => Boolean(candidate));
  const rootCardEntities = list(operation, 'cardEntities', 'CardEntities').map(record).filter((candidate): candidate is Entity => Boolean(candidate));
  const optionById = new Map<string, Entity>();
  for (const candidate of [...rootCardEntities, ...entities.values()]) {
    const candidateId = entityId(candidate);
    if (candidateId) optionById.set(candidateId, candidate);
  }
  const optionCards = allOptionIds.map((optionEntityId) => {
    const candidate = optionById.get(optionEntityId);
    return candidate ? reviewCard(candidate, catalog) : hiddenReviewCard(optionEntityId);
  });
  const groupRecords = list(variableSelection, 'selectionGroups', 'SelectionGroups').map(record).filter((candidate): candidate is Entity => Boolean(candidate));
  const sourceZonePositions = [...new Set(groupRecords.flatMap((group) => list(group, 'validOptions', 'ValidOptions').map((candidate) => {
    const nested = record(candidate);
    return nested ? number(record(value(nested, 'cardAddress', 'CardAddress')) || nested, 'pos', 'position') : undefined;
  })).filter((candidate): candidate is number => candidate != null))];
  const groupMinimums = groupRecords.map((group) => number(group, 'minAmount', 'MinAmount')).filter((candidate): candidate is number => candidate != null);
  const groupMaximums = groupRecords.map((group) => number(group, 'maxAmount', 'MaxAmount')).filter((candidate): candidate is number => candidate != null);
  const minimum = number(variableSelection, 'totalMinAmount', 'TotalMinAmount')
    ?? (groupMinimums.length ? Math.min(...groupMinimums) : 0);
  const maximum = number(variableSelection, 'totalMaxAmount', 'TotalMaxAmount')
    ?? (groupMaximums.length ? Math.max(...groupMaximums) : 1);
  const sourceEntityId = text(playerSelection, 'originCardEntityID', 'originCardEntityId');
  return {
    id,
    kind: selectionKind(variableSelection),
    candidateVisibility: 'captured',
    selectionMethod: number(variableSelection, 'selectionMethod', 'SelectionMethod'),
    subActionType: number(variableSelection, 'subActionType', 'SubActionType'),
    sourceEntityId,
    sourceCardId: sourceEntityId ? cardSourceId(entities.get(sourceEntityId)) : undefined,
    sourceZonePositions,
    allOptionIds,
    eligibleOptionIds,
    selectedOptionIds: [],
    optionCards,
    minimum: Number.isFinite(minimum) ? minimum : 0,
    maximum: Number.isFinite(maximum) ? maximum : 1,
    completed: false,
  };
}

function cloneSelection(selection: ReviewSelection): ReviewSelection {
  return {
    ...selection,
    sourceZonePositions: [...selection.sourceZonePositions],
    allOptionIds: [...selection.allOptionIds],
    eligibleOptionIds: [...selection.eligibleOptionIds],
    selectedOptionIds: [...selection.selectedOptionIds],
    optionCards: [...selection.optionCards],
  };
}

function appliedEffects(entity: Entity): ReviewAppliedEffect[] {
  const direct = list(entity, 'appliedStatusEffects', 'AppliedStatusEffects').map(record).filter((candidate): candidate is Entity => Boolean(candidate));
  const retained = list(record(value(entity, 'cardEntityGetStatusEffects', 'CardEntityGetStatusEffects')), 'retainedListOfPassiveEffects', 'RetainedListOfPassiveEffects')
    .map(record)
    .map((wrapper) => record(value(wrapper, 'appliedPassiveEffect', 'AppliedPassiveEffect')))
    .filter((candidate): candidate is Entity => Boolean(candidate));
  const unique = new Map<string, ReviewAppliedEffect>();
  for (const effect of [...direct, ...retained]) {
    const id = text(effect, 'effectID', 'effectId', 'applicationID', 'applicationId') || `${text(effect, 'actionName', 'ActionName')}:${unique.size}`;
    unique.set(id, {
      id,
      name: (text(effect, 'actionName', 'ActionName') || 'Applied effect').replace(/^\[Ability\]\s*/, ''),
      effectType: (text(record(value(effect, 'statusEffect', 'StatusEffect')), '$type', 'type') || '').split(',')[0].split('.').pop() || undefined,
      sourceCardId: text(effect, 'actionSourceID', 'actionSourceId'),
      remainingDuration: number(effect, 'remainingDuration', 'RemainingDuration'),
      enabled: bool(effect, 'effectEnabled', 'EffectEnabled') !== false && bool(effect, 'activated', 'Activated') !== false,
    });
  }
  return [...unique.values()];
}

function emptyBoard(name: string): TrackedPlayerBoard {
  return {
    name,
    active: null,
    bench: [],
    handCount: 0,
    knownHand: [],
    knownHandCards: [],
    deckCount: 0,
    deckCards: [],
    discard: [],
    discardCards: [],
    lostZoneCards: [],
    prizeCards: [],
    prizesTaken: 0,
  };
}

function playerNumber(entity: Entity): 1 | 2 | undefined {
  const pos = position(entity);
  if (pos === 'Player1' || bool(entity, 'isPlayer1') === true) return 1;
  if (pos === 'Player2' || bool(entity, 'isPlayer1') === false) return 2;
  return undefined;
}

function ownerNumber(entity: Entity, playerIds: Record<1 | 2, string | undefined>): 1 | 2 | undefined {
  const pos = position(entity);
  if (/Player1/.test(pos)) return 1;
  if (/Player2/.test(pos)) return 2;
  const owner = text(entity, 'ownerPlayerId', 'ownerPlayerID', 'OwnerPlayerId');
  if (owner && owner === playerIds[1]) return 1;
  if (owner && owner === playerIds[2]) return 2;
  return bool(entity, 'isPlayer1') === true ? 1 : bool(entity, 'isPlayer1') === false ? 2 : undefined;
}

function battleStat(entity: Entity | undefined, ...names: string[]): number | undefined {
  return entity ? number(record(value(entity, 'battleFlagCounts', 'BattleFlagCounts')), ...names) : undefined;
}

function buildCanonicalState(
  entities: Map<string, Entity>,
  catalog: ReadonlyMap<string, CardInfo>,
  playerEntities: Record<1 | 2, Entity>,
  playerIds: Record<1 | 2, string | undefined>,
  names: Record<1 | 2, string>,
  localSide: 1 | 2,
  currentSide: 1 | 2 | undefined,
  winnerSide: 1 | 2 | undefined,
  selections: ReviewSelection[],
): CanonicalReviewState {
  const players: [PlayerState, PlayerState] = [emptyPlayerState(), emptyPlayerState()];
  const visibility: Record<string, ReviewCardVisibility> = {};
  const effectsByEntity: Record<string, ReviewAppliedEffect[]> = {};
  let stadium: TrainerCard | null = null;

  const addZoneCard = (side: 1 | 2, zone: keyof Pick<PlayerState, 'deck' | 'hand' | 'prizes' | 'discard' | 'lostZone'>, entity: Entity, forceHidden = false): void => {
    const card = reviewCard(entity, catalog);
    players[side - 1][zone].push(card);
    visibility[card.id] = !forceHidden && cardSourceId(entity) ? 'known' : 'hidden';
  };

  for (const entity of entities.values()) {
    const entityEffects = appliedEffects(entity);
    const reviewedEntityId = entityId(entity);
    if (reviewedEntityId && entityEffects.length) effectsByEntity[reviewedEntityId] = entityEffects;
    const pos = position(entity);
    if (pos === 'BoardStadium' && (cardSourceId(entity) || sourceFor(entity))) {
      const converted = reviewCard(entity, catalog, true);
      stadium = converted.cardType === CardType.Trainer
        ? converted as TrainerCard
        : { id: converted.id, name: converted.name, imageUrl: converted.imageUrl, cardNumber: converted.cardNumber, cardType: CardType.Trainer, trainerType: TrainerType.Stadium };
      visibility[stadium.id] = 'known';
      continue;
    }
    const side = ownerNumber(entity, playerIds);
    const isCardZone = /(?:Deck|Hand|Prize|Discard|LostZone|Active|Bench)$/.test(pos);
    if (!side || !isCardZone) continue;
    if (pos.endsWith('Deck')) addZoneCard(side, 'deck', entity);
    else if (pos.endsWith('Hand')) addZoneCard(side, 'hand', entity, side !== localSide);
    else if (pos.endsWith('Prize')) addZoneCard(side, 'prizes', entity);
    else if (pos.endsWith('Discard')) addZoneCard(side, 'discard', entity);
    else if (pos.endsWith('LostZone')) addZoneCard(side, 'lostZone', entity);
    else if (pos.endsWith('Active') && isPokemonCard(entity, catalog) && isMainPokemon(entity, entities)) {
      players[side - 1].active = inPlayPokemon(entity, entities, catalog);
      visibility[players[side - 1].active!.card.id] = 'known';
    } else if (pos.endsWith('Bench') && isPokemonCard(entity, catalog) && isMainPokemon(entity, entities)) {
      const pokemon = inPlayPokemon(entity, entities, catalog);
      players[side - 1].bench.push(pokemon);
      visibility[pokemon.card.id] = 'known';
    }
  }

  for (const side of [1, 2] as const) {
    players[side - 1].prizeCardsRemaining = players[side - 1].prizes.length
      || Math.max(0, 6 - (battleStat(playerEntities[side], 'PrizeCardsTaken') || 0));
    players[side - 1].supporterPlayedThisTurn = Boolean(battleStat(playerEntities[side], 'CardsPlayedSupporter'));
    players[side - 1].energyAttachedThisTurn = Boolean(battleStat(playerEntities[side], 'CardsPlayedBasicEnergy'));
    players[side - 1].retreatedThisTurn = Boolean(battleStat(playerEntities[side], 'PokemonRetreated'));
    const markAttachments = (pokemon: PokemonInPlay | null): void => {
      if (!pokemon) return;
      visibility[pokemon.card.id] = 'known';
      pokemon.attachedEnergy.forEach((card) => { visibility[card.id] = 'known'; });
      pokemon.attachedTools.forEach((card) => { visibility[card.id] = 'known'; });
      markAttachments(pokemon.previousStage || null);
    };
    markAttachments(players[side - 1].active);
    players[side - 1].bench.forEach(markAttachments);
  }

  for (const selection of selections) {
    selection.optionCards.forEach((card) => {
      if (card.name !== 'Hidden card') visibility[card.id] = 'temporarily-revealed';
    });
  }

  const turnNumber = Math.max(1, battleStat(playerEntities[1], 'TurnsPlayed') || 0, battleStat(playerEntities[2], 'TurnsPlayed') || 0);
  const state: GameState = {
    players,
    currentPlayer: (currentSide ? currentSide - 1 : 0) as 0 | 1,
    turnNumber,
    phase: winnerSide ? GamePhase.GameOver : turnNumber > 0 ? GamePhase.MainPhase : GamePhase.Setup,
    stadium,
    winner: winnerSide ? (winnerSide - 1) as 0 | 1 : null,
    turnActions: [],
    gameLog: [],
    gameFlags: [],
  };
  const clonedSelections = selections.map(cloneSelection);
  return {
    state,
    playerNames: [names[1], names[2]],
    localPlayerIndex: (localSide - 1) as 0 | 1,
    visibility,
    appliedEffects: effectsByEntity,
    selections: clonedSelections,
    selection: clonedSelections.at(-1),
  };
}

function modificationType(modification: Entity): string {
  return (text(modification, '$type', 'type') || '').split(',')[0].split('.').pop() || '';
}

function cleanBracketedName(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const cleaned = candidate.replace(/^\[/, '').replace(/\]$/, '').trim();
  return cleaned && !/^[0-9a-f-]{30,}$/i.test(cleaned) ? cleaned : undefined;
}

function eventKindForCard(info: CardInfo | undefined, entity?: Entity): TrackerEventKind {
  if (info?.category === 1 || (info?.hp || 0) > 0) return 'pokemon';
  if (info?.category === 3 || /Energy$/i.test(info?.name || '')) return 'energy';
  const trainerFormat = info?.format?.toUpperCase().replace(/^[^A-Z]+/, '') || '';
  if (trainerFormat.startsWith('A') || /stadium/i.test(info?.cardType || '') || position(entity || {}) === 'BoardStadium') return 'stadium';
  if (trainerFormat.startsWith('T')) return 'tool';
  return 'trainer';
}

function isToolCard(info: CardInfo | undefined): boolean {
  return info?.category === 2 && /T$/i.test(info.format || '');
}

function naturalList(values: string[]): string {
  if (values.length <= 1) return values[0] || '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

interface OperationAssembly {
  id: string;
  turnIndex?: number;
  promotionTurnIndex?: number;
  snapshotBefore?: TrackerBoardSnapshot;
  gameOperationNumber?: number;
  playerOperation: Entity | null;
  modificationIds: Set<string>;
  modifications: Map<string, Entity>;
  events: Map<string, TrackerEvent>;
  eventOrder: string[];
  damageByTarget: Map<string, number>;
  knockoutTargets: Set<string>;
  prizesBySide: Map<1 | 2, number>;
  hasDamage: boolean;
  privateDraws: Map<string, PrivateDrawResolution>;
  coinFlips: Map<string, boolean[]>;
  attackName?: string;
  abilityName?: string;
  winnerSide?: 1 | 2;
  endReason?: string;
  selections: Map<string, ReviewSelection>;
  selectionOrder: string[];
  selectionMovementIds: Map<string, Set<string>>;
}

interface PrivateDrawResolution {
  side: 1 | 2;
  count: number;
  sourceEntityId?: string;
  effectSource: boolean;
}

interface OperationFacts {
  facts: ReviewEventFact[];
  internalChanges: number;
  protocolGroups: ReviewProtocolGroup[];
}

function promotionEntitiesForSelection(
  selection: ReviewSelection,
  operation: OperationAssembly,
  entities: Map<string, Entity>,
): Entity[] {
  if (!operation.knockoutTargets.size) return [];
  const selected = selection.selectedOptionIds
    .map((id) => entities.get(id))
    .filter((candidate): candidate is Entity => Boolean(candidate));
  const movedFromBench = selection.sourceZonePositions.some((pos) => pos === 13 || pos === 14)
    || selection.selectionMethod === 13;
  return movedFromBench ? selected.filter((entity) => /Active$/.test(position(entity))) : [];
}

function coinFlipResults(modification: Entity): boolean[] {
  const raw = value(modification, 'finalFlipResults', 'FinalFlipResults', 'flipResults', 'FlipResults');
  if (Array.isArray(raw)) return raw.flatMap((candidate) => coinFlipResults({ flipResults: candidate }));
  if (typeof raw === 'number' || typeof raw === 'boolean') return [Number(raw) === 1];
  if (typeof raw !== 'string') return [];
  return [...raw.matchAll(/[01]/g)].map((match) => match[0] === '1');
}

function coinFlipSummary(results: boolean[]): { copy: string; result: TrackerEvent['coinResult'] } {
  const heads = results.filter(Boolean).length;
  const tails = results.length - heads;
  if (results.length === 1) return { copy: heads ? 'Heads' : 'Tails', result: heads ? 'heads' : 'tails' };
  return {
    copy: `${heads} heads · ${tails} tails`,
    result: heads === results.length ? 'heads' : tails === results.length ? 'tails' : 'mixed',
  };
}

function sentenceCaseIdentifier(candidate: string | undefined): string | undefined {
  const normalized = candidate?.trim();
  const knownLabels: Record<string, string> = {
    match_coin_flip_result_heads: 'Heads',
    match_coin_flip_result_tails: 'Tails',
    match_results_victory_reason_opponent_concede: 'Opponent conceded',
    option1_yes: 'Yes',
    option2_no: 'No',
  };
  if (normalized && knownLabels[normalized]) return knownLabels[normalized];
  if (normalized && /^\d+$/.test(normalized)) return `Option ${normalized}`;
  const cleaned = normalized
    ?.replace(/^match_/, '')
    .replace(/^option\d+_/, '')
    .replace(/^\[Ability\]\s*/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function reviewedEntityName(
  id: string | undefined,
  entities: Map<string, Entity>,
  catalog: ReadonlyMap<string, CardInfo>,
  names: Record<1 | 2, string>,
): string | undefined {
  if (!id) return undefined;
  const entity = entities.get(id);
  if (!entity) return undefined;
  const userName = text(entity, 'userName', 'UserName');
  if (userName) return userName;
  if (cardSourceId(entity) || sourceFor(entity)) return cardName(entity, catalog);
  const side = playerNumber(entity);
  return side && position(entity) === `Player${side}` ? names[side] : undefined;
}

function addressLocation(
  address: Entity | null,
  entities: Map<string, Entity>,
  catalog: ReadonlyMap<string, CardInfo>,
  names: Record<1 | 2, string>,
): string {
  const parentId = text(address, 'parentEntityID', 'parentEntityId');
  const parentName = reviewedEntityName(parentId, entities, catalog, names);
  if (parentName) return `attached to ${parentName}`;
  const pos = gamePositionNumber(address, entities);
  const raw = pos == null ? 'Unknown zone' : BOARD_POSITIONS[pos] || `Position ${pos}`;
  const match = raw.match(/^Player([12])(.*)$/);
  if (!match) return raw === 'BoardStadium' ? 'Stadium spot' : raw.replace(/([a-z])([A-Z])/g, '$1 $2');
  const side = Number(match[1]) as 1 | 2;
  const zone = match[2].replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return zone ? `${names[side]}'s ${zone}` : names[side];
}

function meaningfulStatus(effect: Entity | null): { name: string; type?: string; duration?: number } | undefined {
  if (!effect) return undefined;
  const rawName = text(effect, 'actionName', 'ActionName');
  const status = record(value(effect, 'statusEffect', 'StatusEffect'));
  const effectType = (text(status, '$type', 'type') || '').split(',')[0].split('.').pop();
  if (!rawName || /^(?:Setup|VFX|MovePokemonCardIntoPlay$)|(?:VFX|Visual|Animation)/i.test(rawName) || /VFXEffect|EvolveEffects/i.test(effectType || '')) return undefined;
  return {
    name: rawName.replace(/^\[Ability\]\s*/, '').trim(),
    type: effectType,
    duration: number(effect, 'remainingDuration', 'RemainingDuration'),
  };
}

const MODIFICATION_LABELS: Record<string, string> = {
  ActionBoundaryModification: 'Action boundary',
  SetMetaDataModification: 'Action metadata',
  MoveCardsModification: 'Card movement',
  CreateTriggerModification: 'Rules trigger',
  RemoveStatusEffectModification: 'Effect removal',
  ApplyStatusEffectModification: 'Effect application',
  ActivateStatusEffectModification: 'Effect activation',
  CreateUITriggerModification: 'Player prompt',
  ShuffleCardsModification: 'Card shuffle',
  UpdateDurationModification: 'Effect duration',
  MoveDCModification: 'Damage-counter change',
  PlayEffectModification: 'Visual effect',
  ApplyDamageModification: 'Damage calculation',
  EndTurnModification: 'Turn resolution',
  RevealCardsModification: 'Card reveal',
  AttachCardsModification: 'Card attachment',
  EvolveModification: 'Evolution',
  CoinFlipModification: 'Coin flip',
  SwapCardsModification: 'Active/Bench switch',
  EndGameModification: 'Game resolution',
  TextSelectionResultModification: 'Text choice result',
  ReparentSelectionResultModification: 'Card choice result',
};

function modificationLabel(type: string): string {
  return MODIFICATION_LABELS[type]
    || type.replace(/Modification$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
    || 'Engine transition';
}

function buildOperationFacts(
  operation: OperationAssembly,
  entities: Map<string, Entity>,
  catalog: ReadonlyMap<string, CardInfo>,
  names: Record<1 | 2, string>,
  actor: string | undefined,
  originName: string | undefined,
  opType: string,
): OperationFacts {
  const facts: ReviewEventFact[] = [];
  const factKeys = new Set<string>();
  const representedModifications = new Set<string>();
  let factIndex = 0;
  const addFact = (
    kind: ReviewEventFact['kind'],
    label: string,
    factValue: string | undefined,
    tone: ReviewEventFact['tone'] = 'neutral',
  ): void => {
    if (!factValue) return;
    const key = `${kind}|${label}|${factValue}`;
    if (factKeys.has(key)) return;
    factKeys.add(key);
    facts.push({ id: `${operation.id}:fact:${factIndex++}`, kind, label, value: factValue, tone });
  };

  if (operation.gameOperationNumber != null) addFact('system', 'Operation', `#${operation.gameOperationNumber}`);
  addFact('actor', 'Player', actor);
  addFact('resolution', 'Action', opType);
  addFact('actor', 'Source', originName);
  const targetId = text(operation.playerOperation, 'targetID', 'targetId', 'targetEntityID', 'targetEntityId');
  addFact('target', 'Target', reviewedEntityName(targetId, entities, catalog, names));

  interface MovementChain {
    entityId: string;
    from: Entity | null;
    to: Entity | null;
    modificationIds: Set<string>;
  }
  interface AnonymousMovement {
    fromPosition?: number;
    toPosition?: number;
    sourceEntityId?: string;
    count: number;
    modificationIds: Set<string>;
  }
  const movements = new Map<string, MovementChain>();
  const anonymousMovements = new Map<string, AnonymousMovement>();

  for (const [modificationId, modification] of operation.modifications) {
    const type = modificationType(modification);
    if (type === 'MoveCardsModification') {
      for (const candidate of list(modification, 'moveCardDeltas', 'MoveCardDeltas')) {
        const delta = record(candidate);
        const from = record(value(delta, 'fromCardAddress', 'FromCardAddress'));
        const to = record(value(delta, 'toCardAddress', 'ToCardAddress'));
        const id = (to ? entityId(to) : undefined) || (from ? entityId(from) : undefined);
        if (!id) {
          const rawFromPosition = number(from, 'pos', 'position', 'currentGamePos', 'currentPos');
          const rawToPosition = number(to, 'pos', 'position', 'currentGamePos', 'currentPos');
          const fromPosition = rawFromPosition ?? deckPositionForPlayerZone(rawToPosition);
          const toPosition = rawToPosition ?? deckPositionForPlayerZone(rawFromPosition);
          const sourceEntityId = text(modification, 'actionOriginEntityID', 'actionOriginEntityId');
          const key = `${sourceEntityId || 'unknown'}:${fromPosition ?? 'unknown'}:${toPosition ?? 'unknown'}`;
          const chain = anonymousMovements.get(key) || {
            fromPosition,
            toPosition,
            sourceEntityId,
            count: 0,
            modificationIds: new Set<string>(),
          };
          chain.count += 1;
          chain.modificationIds.add(modificationId);
          anonymousMovements.set(key, chain);
          continue;
        }
        const chain = movements.get(id) || { entityId: id, from, to, modificationIds: new Set<string>() };
        chain.from ||= from;
        chain.to = to;
        chain.modificationIds.add(modificationId);
        movements.set(id, chain);
      }
      continue;
    }

    if (type === 'AttachCardsModification') {
      let found = false;
      for (const candidate of list(modification, 'attachCardDeltas', 'AttachCardDeltas')) {
        const delta = record(candidate);
        const from = record(value(delta, 'fromCardAddress', 'FromCardAddress'));
        const to = record(value(delta, 'toCardAddress', 'ToCardAddress'));
        const id = (to ? entityId(to) : undefined) || (from ? entityId(from) : undefined);
        const card = reviewedEntityName(id, entities, catalog, names) || 'Hidden card';
        const parent = reviewedEntityName(text(to, 'parentEntityID', 'parentEntityId'), entities, catalog, names);
        addFact('attachment', 'Attached', parent ? `${card} → ${parent}` : `${card} → ${addressLocation(to, entities, catalog, names)}`, 'info');
        found = true;
      }
      if (found) representedModifications.add(modificationId);
      continue;
    }

    if (type === 'ApplyDamageModification') {
      const isFinal = bool(modification, 'isFinal', 'IsFinal') === true;
      let found = false;
      for (const candidate of list(modification, 'appliedDamageDeltas', 'AppliedDamageDeltas')) {
        const delta = record(candidate);
        const address = record(value(delta, 'cardAddress', 'CardAddress'));
        const amount = number(delta, 'damageAmount', 'DamageAmount');
        const target = reviewedEntityName(address ? entityId(address) : undefined, entities, catalog, names) || 'Unknown target';
        if (amount != null) addFact('damage', isFinal ? 'Damage dealt' : 'Damage calculated', `${amount} to ${target}`, 'negative');
        found ||= amount != null;
      }
      if (found) representedModifications.add(modificationId);
      continue;
    }

    if (type === 'SetMetaDataModification') {
      const attackNames = list(modification, 'setMetaDataDeltas', 'SetMetaDataDeltas').map(record).filter((delta) => number(delta, 'metaDataKey', 'MetaDataKey') === 22).map((delta) => cleanBracketedName(text(delta, 'value', 'Value'))).filter((candidate): candidate is string => Boolean(candidate));
      attackNames.forEach((name) => addFact('resolution', 'Attack selected', name, 'info'));
      if (attackNames.length) representedModifications.add(modificationId);
      continue;
    }

    if (type === 'MoveDCModification' && bool(modification, 'isFinal', 'IsFinal') !== false) {
      let found = false;
      for (const candidate of list(modification, 'modifiedDCEntities', 'ModifiedDCEntities')) {
        const delta = record(candidate);
        const address = record(value(delta, 'cardAddress', 'CardAddress'));
        const target = reviewedEntityName(address ? entityId(address) : undefined, entities, catalog, names) || 'Unknown Pokémon';
        const next = number(delta, 'newDC', 'NewDC');
        const previous = number(delta, 'previousDC', 'PreviousDC');
        if (next == null) continue;
        const copy = previous == null
          ? `${target}: ${next * 10} damage marked`
          : `${target}: ${previous * 10} → ${next * 10} damage`;
        addFact('damage', 'Damage counters', copy, next > (previous ?? 0) ? 'negative' : 'positive');
        found = true;
      }
      if (found) representedModifications.add(modificationId);
      continue;
    }

    if (type === 'CoinFlipModification' && bool(modification, 'isFinal', 'IsFinal') !== false) {
      const results = coinFlipResults(modification);
      if (results.length) {
        const result = coinFlipSummary(results);
        addFact('coin', 'Coin flip', result.copy, result.result === 'heads' ? 'positive' : result.result === 'tails' ? 'negative' : 'info');
        representedModifications.add(modificationId);
      }
      continue;
    }

    if (type === 'ApplyStatusEffectModification' || type === 'ActivateStatusEffectModification') {
      const deltaNames = type === 'ApplyStatusEffectModification'
        ? ['applyStatusEffectDeltas', 'ApplyStatusEffectDeltas']
        : ['activateStatusEffectDeltas', 'ActivateStatusEffectDeltas'];
      let found = false;
      for (const candidate of list(modification, ...deltaNames)) {
        const delta = record(candidate);
        const effect = record(value(delta, type === 'ApplyStatusEffectModification' ? 'appliedStatusEffect' : 'activateStatusEffect', type === 'ApplyStatusEffectModification' ? 'AppliedStatusEffect' : 'ActivateStatusEffect'));
        const meaningful = meaningfulStatus(effect);
        if (!meaningful) continue;
        const target = reviewedEntityName(text(effect, 'appliedToEntityID', 'appliedToEntityId'), entities, catalog, names);
        const duration = meaningful.duration != null && meaningful.duration >= 0 ? ` · ${meaningful.duration} turn${meaningful.duration === 1 ? '' : 's'}` : '';
        const typeCopy = meaningful.type && !/StatusEffect$/i.test(meaningful.type) ? ` · ${meaningful.type.replace(/([a-z])([A-Z])/g, '$1 $2')}` : '';
        addFact('status', type === 'ApplyStatusEffectModification' ? 'Effect applied' : 'Effect activated', `${meaningful.name}${target ? ` → ${target}` : ''}${duration}${typeCopy}`, 'info');
        found = true;
      }
      if (found) representedModifications.add(modificationId);
      continue;
    }

    if (type === 'RevealCardsModification') {
      const data = record(value(modification, 'actionModificationData', 'ActionModificationData'));
      const deltas = list(modification, 'revealedCardsDelta', 'RevealedCardsDelta').length
        ? list(modification, 'revealedCardsDelta', 'RevealedCardsDelta')
        : list(data, 'revealedCardsDelta', 'RevealedCardsDelta');
      const revealed = deltas.map(record).map((delta) => {
        const address = record(value(delta, 'cardAddress', 'CardAddress'));
        return reviewedEntityName(address ? entityId(address) : undefined, entities, catalog, names);
      }).filter((candidate): candidate is string => Boolean(candidate));
      const total = deltas.length;
      if (total) {
        addFact('reveal', 'Cards revealed', revealed.length === total ? revealed.join(', ') : `${revealed.join(', ')}${revealed.length ? ' · ' : ''}${total - revealed.length} hidden card${total - revealed.length === 1 ? '' : 's'}`, 'info');
        representedModifications.add(modificationId);
      }
      continue;
    }

    if (type === 'ShuffleCardsModification') {
      const rawPosition = number(modification, 'shuffledPos', 'ShuffledPos', 'position', 'Position');
      const actorSide = ([1, 2] as const).find((side) => names[side] === actor);
      const inferredPosition = rawPosition ?? (actorSide === 1 ? 7 : actorSide === 2 ? 8 : -1);
      const location = inferredPosition != null && inferredPosition >= 0
        ? addressLocation({ pos: inferredPosition }, entities, catalog, names)
        : 'Cards randomized';
      addFact('shuffle', 'Shuffled', location, 'info');
      representedModifications.add(modificationId);
      continue;
    }

    if (type === 'EvolveModification') {
      let found = false;
      for (const candidate of list(modification, 'EvolveCardDeltas', 'evolveCardDeltas')) {
        const delta = record(candidate);
        const previousAddress = record(value(delta, 'evolvingCardAddress', 'EvolvingCardAddress'));
        const evolvedAddress = record(value(delta, 'evolvedCardFromAddress', 'EvolvedCardFromAddress'));
        const previous = reviewedEntityName(previousAddress ? entityId(previousAddress) : undefined, entities, catalog, names) || 'Pokémon';
        const evolved = reviewedEntityName(evolvedAddress ? entityId(evolvedAddress) : undefined, entities, catalog, names) || 'Evolved Pokémon';
        addFact('evolution', 'Evolution', `${previous} → ${evolved}`, 'positive');
        found = true;
      }
      if (found) representedModifications.add(modificationId);
      continue;
    }

    if (type === 'SwapCardsModification') {
      const swaps = list(modification, 'swapCardDeltas', 'SwapCardDeltas').map(record).filter((candidate): candidate is Entity => Boolean(candidate));
      const moved = [...new Set(swaps.map((delta) => {
        const address = record(value(delta, 'fromCardAddress', 'FromCardAddress'));
        return reviewedEntityName(address ? entityId(address) : undefined, entities, catalog, names);
      }).filter((candidate): candidate is string => Boolean(candidate)))];
      if (moved.length) {
        addFact('movement', 'Switched', moved.join(' ↔ '), 'info');
        representedModifications.add(modificationId);
      }
      continue;
    }

    if (type === 'TextSelectionResultModification') {
      const selected = sentenceCaseIdentifier(text(modification, 'SelectedLocId', 'selectedLocId'));
      const selectingSide = number(modification, 'SelectingPlayer', 'selectingPlayer');
      const selectingPlayer = selectingSide === 1 || selectingSide === 2 ? names[selectingSide] : actor;
      if (selected) {
        addFact('selection', 'Choice resolved', `${selectingPlayer ? `${selectingPlayer}: ` : ''}${selected}`, 'info');
        representedModifications.add(modificationId);
      }
      continue;
    }

    if (type === 'EndTurnModification') {
      addFact('resolution', 'Turn state', `${actor || 'Player'} ended the turn`, 'info');
      representedModifications.add(modificationId);
      continue;
    }

    if (type === 'EndGameModification') {
      const winner = number(modification, 'winner', 'Winner');
      const winnerName = winner === 1 || winner === 2 ? names[winner] : undefined;
      const reason = sentenceCaseIdentifier(text(modification, 'winGameEndReasonLocID', 'WinGameEndReasonLocID', 'reason', 'Reason'));
      addFact('resolution', 'Game result', `${winnerName ? `${winnerName} won` : 'Game ended'}${reason ? ` · ${reason}` : ''}`, 'positive');
      representedModifications.add(modificationId);
    }
  }

  for (const movement of movements.values()) {
    const entityName = reviewedEntityName(movement.entityId, entities, catalog, names) || 'Hidden card';
    // Read the endpoint itself before consulting the now-updated entity map.
    // A private deck search deliberately omits the source position; looking up
    // that entity after the move incorrectly makes both endpoints look like the
    // destination Hand.
    const rawFromPosition = number(movement.from, 'pos', 'position', 'currentGamePos', 'currentPos');
    const rawToPosition = number(movement.to, 'pos', 'position', 'currentGamePos', 'currentPos');
    const inferredFromPosition = rawFromPosition ?? deckPositionForPlayerZone(rawToPosition);
    const inferredToPosition = rawToPosition ?? deckPositionForPlayerZone(rawFromPosition);
    const from = addressLocation(inferredFromPosition == null ? movement.from : { ...(movement.from || {}), pos: inferredFromPosition }, entities, catalog, names);
    const to = addressLocation(inferredToPosition == null ? movement.to : { ...(movement.to || {}), pos: inferredToPosition }, entities, catalog, names);
    if (from !== to) addFact('movement', 'Card moved', `${entityName}: ${from} → ${to}`, 'info');
    movement.modificationIds.forEach((id) => representedModifications.add(id));
  }

  for (const movement of anonymousMovements.values()) {
    const drawSide = privateDrawSide(movement.fromPosition, movement.toPosition, undefined);
    const sourceName = reviewedEntityName(movement.sourceEntityId, entities, catalog, names);
    if (drawSide) {
      addFact(
        'movement',
        'Cards drawn',
        `${sourceName ? `${sourceName}: ` : ''}${names[drawSide]} drew ${movement.count} hidden card${movement.count === 1 ? '' : 's'}`,
        'info',
      );
    } else {
      const from = addressLocation(movement.fromPosition == null ? null : { pos: movement.fromPosition }, entities, catalog, names);
      const to = addressLocation(movement.toPosition == null ? null : { pos: movement.toPosition }, entities, catalog, names);
      addFact(
        'movement',
        'Cards moved',
        `${movement.count} hidden card${movement.count === 1 ? '' : 's'}: ${from} → ${to}`,
        'info',
      );
    }
    movement.modificationIds.forEach((id) => representedModifications.add(id));
  }

  for (const selectionId of operation.selectionOrder) {
    const selection = operation.selections.get(selectionId);
    if (!selection) continue;
    const chosenNames = selection.selectedOptionIds.map((id) => reviewedEntityName(id, entities, catalog, names)).filter((candidate): candidate is string => Boolean(candidate));
    const promotedNames = promotionEntitiesForSelection(selection, operation, entities)
      .map((entity) => cardName(entity, catalog));
    const isPromotion = promotedNames.length > 0;
    const selectionProtocol = [
      `${selection.kind.charAt(0).toUpperCase()}${selection.kind.slice(1)} choice`,
      selection.selectionMethod != null ? `method ${selection.selectionMethod}` : undefined,
      selection.subActionType != null ? `sub-action ${selection.subActionType}` : undefined,
    ].filter((candidate): candidate is string => Boolean(candidate)).join(' · ');
    const sourceZones = selection.sourceZonePositions.map((pos) => addressLocation({ pos }, entities, catalog, names));
    addFact('selection', 'Selection type', selectionProtocol, 'info');
    if (sourceZones.length) addFact('selection', 'Candidate zone', sourceZones.join(', '));
    addFact(
      'selection',
      'Selection',
      selection.candidateVisibility === 'private'
        ? `${selection.selectedOptionIds.length} ${isPromotion ? 'promoted' : 'chosen'} · candidate list private`
        : `${selection.allOptionIds.length} viewed · ${selection.eligibleOptionIds.length} eligible · ${selection.selectedOptionIds.length} ${isPromotion ? 'promoted' : 'chosen'}`,
      'info',
    );
    if (isPromotion) addFact('resolution', 'Promoted to Active', promotedNames.join(', '), 'info');
    else if (chosenNames.length) addFact('selection', 'Chosen', chosenNames.join(', '), 'positive');
    addFact('selection', 'Selection limits', `${selection.minimum} minimum · ${selection.maximum} maximum${selection.completed ? ' · completed' : ' · pending'}`);
  }

  const protocolGroupsByType = new Map<string, ReviewProtocolGroup>();
  for (const [modificationId, modification] of operation.modifications) {
    const type = modificationType(modification) || 'UnknownModification';
    const existing = protocolGroupsByType.get(type) || {
      id: `${operation.id}:protocol:${type}`,
      label: modificationLabel(type),
      count: 0,
      readableCount: 0,
    };
    existing.count += 1;
    if (representedModifications.has(modificationId)) existing.readableCount += 1;
    protocolGroupsByType.set(type, existing);
  }

  return {
    facts,
    internalChanges: Math.max(0, operation.modifications.size - representedModifications.size),
    protocolGroups: [...protocolGroupsByType.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
  };
}

interface MatchAssembly {
  entities: Map<string, Entity>;
  zoneCounts: Map<number, number>;
  review: MatchReview | null;
  messageIds: Set<string>;
  operations: Map<string, OperationAssembly>;
  localAccountId?: string;
}

const REVIEW_ZONE_POSITIONS = [7, 8, 9, 10, 11, 12, 17, 18, 19, 20] as const;

function gamePositionNumber(address: Entity | null, entities: Map<string, Entity>): number | undefined {
  const explicit = number(address, 'pos', 'position', 'currentGamePos', 'currentPos');
  if (explicit != null) return explicit;
  const id = address && entityId(address);
  const candidate = id ? entities.get(id) : undefined;
  const name = candidate ? position(candidate) : undefined;
  const index = name ? BOARD_POSITIONS.indexOf(name as typeof BOARD_POSITIONS[number]) : -1;
  return index >= 0 ? index : undefined;
}

function deckPositionForPlayerZone(positionNumber: number | undefined): 7 | 8 | undefined {
  if (positionNumber == null || positionNumber < 7 || positionNumber > 22) return undefined;
  return positionNumber % 2 === 1 ? 7 : 8;
}

function updateZoneCountsFromBoard(operation: Entity, zoneCounts: Map<number, number>): void {
  const board = record(value(operation, 'matchBoard', 'MatchBoard'));
  if (!board) return;
  const zones: Array<[string, number]> = [
    ['p1Deck', 7], ['p2Deck', 8], ['p1Discard', 9], ['p2Discard', 10],
    ['p1Hand', 11], ['p2Hand', 12], ['p1LostZone', 17], ['p2LostZone', 18],
    ['p1Prize', 19], ['p2Prize', 20],
  ];
  for (const [name, pos] of zones) {
    const zone = value(board, name);
    zoneCounts.set(pos, Array.isArray(zone) ? zone.length : zone ? 1 : 0);
  }
}

interface CardMovement {
  from?: number;
  to: number;
  toParent?: string;
}

function playerSideForZone(positionNumber: number | undefined): 1 | 2 | undefined {
  if (positionNumber == null || positionNumber < 7 || positionNumber > 22) return undefined;
  return positionNumber % 2 === 1 ? 1 : 2;
}

function privateDrawSide(
  from: number | undefined,
  to: number | undefined,
  movedEntityId: string | undefined,
): 1 | 2 | undefined {
  if (movedEntityId) return undefined;
  const side = playerSideForZone(to);
  if (!side) return undefined;
  const deck = side === 1 ? 7 : 8;
  const hand = side === 1 ? 11 : 12;
  return from === deck && to === hand ? side : undefined;
}

function initializeZoneCount(
  positionNumber: number | undefined,
  zoneCounts: Map<number, number>,
  entities: Map<string, Entity>,
): void {
  if (positionNumber == null || zoneCounts.has(positionNumber)) return;
  const existing = [...entities.values()].filter((entity) =>
    number(entity, 'currentGamePos', 'currentPos') === positionNumber
  ).length;
  zoneCounts.set(positionNumber, existing);
}

function updateZoneCountsFromCardTransitions(
  modification: Entity,
  zoneCounts: Map<number, number>,
  entities: Map<string, Entity>,
  movements: Map<string, CardMovement>,
): void {
  const type = modificationType(modification);
  const isMove = type === 'MoveCardsModification';
  const isAttachment = type === 'AttachCardsModification';
  if (!isMove && !isAttachment) return;
  const deltas = isMove
    ? list(modification, 'moveCardDeltas', 'MoveCardDeltas')
    : list(modification, 'attachCardDeltas', 'AttachCardDeltas');
  const resetPrivateHands = new Set<number>();
  for (const handPosition of [11, 12]) {
    const deckPosition = handPosition === 11 ? 7 : 8;
    const currentCount = zoneCounts.get(handPosition)
      ?? [...entities.values()].filter((entity) => number(entity, 'currentGamePos', 'currentPos') === handPosition).length;
    const anonymousCardsReturned = deltas.filter((candidate) => {
      const delta = record(candidate);
      const fromAddress = record(value(delta, 'fromCardAddress', 'FromCardAddress'));
      const toAddress = record(value(delta, 'toCardAddress', 'ToCardAddress'));
      const movedEntityId = (toAddress && entityId(toAddress)) || (fromAddress && entityId(fromAddress));
      return !movedEntityId
        && gamePositionNumber(fromAddress, entities) === handPosition
        && gamePositionNumber(toAddress, entities) === deckPosition;
    }).length;
    if (anonymousCardsReturned > 0 && anonymousCardsReturned >= currentCount) resetPrivateHands.add(handPosition);
  }
  const authoritativePrivateHandCounts = new Map<number, number>();
  for (const candidate of deltas) {
    const delta = record(candidate);
    const fromAddress = record(value(delta, 'fromCardAddress', 'FromCardAddress'));
    const toAddress = record(value(delta, 'toCardAddress', 'ToCardAddress'));
    // Inspect the endpoints themselves first. When TCG Live redacts the deck
    // side of a move it often leaves the entity ID in place, and resolving that
    // ID through the pre-move entity map would incorrectly make both endpoints
    // look like the same public zone (for example, Discard -> Discard instead
    // of Discard -> Deck).
    let from = number(fromAddress, 'pos', 'position', 'currentGamePos', 'currentPos');
    let to = number(toAddress, 'pos', 'position', 'currentGamePos', 'currentPos');
    if (from == null && to == null) {
      from = gamePositionNumber(fromAddress, entities);
      to = gamePositionNumber(toAddress, entities);
    }
    // The server intentionally redacts the deck-side address of private moves.
    // The visible endpoint still identifies the owning player, so an omitted
    // endpoint can be reconstructed as that player's deck. This covers draws,
    // private searches, and hand-to-deck shuffles without trusting the stale
    // previousGamePos values carried by later entity updates.
    if (from == null) from = deckPositionForPlayerZone(to);
    if (to == null) to = deckPositionForPlayerZone(from);
    if (from === to) continue;
    initializeZoneCount(from, zoneCounts, entities);
    initializeZoneCount(to, zoneCounts, entities);
    if (from != null) zoneCounts.set(from, Math.max(0, (zoneCounts.get(from) || 0) - 1));
    if (to != null) zoneCounts.set(to, (zoneCounts.get(to) || 0) + 1);
    const movedEntityId = (toAddress && entityId(toAddress)) || (fromAddress && entityId(fromAddress));
    const drawSide = privateDrawSide(from, to, movedEntityId);
    const destinationIndex = number(toAddress, 'index', 'Index');
    if (drawSide && to != null && destinationIndex != null) {
      authoritativePrivateHandCounts.set(
        to,
        Math.max(authoritativePrivateHandCounts.get(to) || 0, destinationIndex + 1),
      );
    }
    if (isMove && movedEntityId && to != null) {
      movements.set(movedEntityId, {
        from,
        to,
        toParent: toAddress ? text(toAddress, 'parentEntityID', 'parentEntityId') : undefined,
      });
    }
  }
  // Private draws omit entity IDs, but the destination indices are still
  // authoritative. They prevent partial captures (or repeated hidden-zone
  // inference) from compounding into an impossible opponent hand size.
  for (const [handPosition, count] of authoritativePrivateHandCounts) {
    zoneCounts.set(handPosition, count);
  }
  // Effects such as Unfair Stamp redact every opponent card ID while moving
  // the entire hand back into the deck. Any identities learned in earlier
  // frames are therefore stale; retaining them makes the old known cards win
  // over the authoritative hidden draw count during reconciliation.
  for (const handPosition of resetPrivateHands) {
    for (const [id, entity] of entities) {
      if (number(entity, 'currentGamePos', 'currentPos') === handPosition) entities.delete(id);
    }
  }
}

function reconcileHiddenZones(assembly: MatchAssembly, localSide?: 1 | 2): void {
  const localHandPosition = localSide === 1 ? 11 : localSide === 2 ? 12 : undefined;
  for (const pos of REVIEW_ZONE_POSITIONS) {
    const desired = assembly.zoneCounts.get(pos);
    if (desired == null) continue;
    for (const [id, entity] of assembly.entities) {
      if (id.startsWith('match-board:') && number(entity, 'currentGamePos', 'currentPos') === pos) assembly.entities.delete(id);
      if (id.startsWith(`hidden-zone:${pos}:`)) assembly.entities.delete(id);
    }
    // The local hand is delivered with exact entity IDs and card sources. Its
    // entity state is authoritative; inferred move counts can repeat across
    // action phases and must never manufacture extra private cards there.
    if (pos === localHandPosition) continue;
    let existing = [...assembly.entities.entries()].filter(([, entity]) => number(entity, 'currentGamePos', 'currentPos') === pos);
    const excess = existing.length - desired;
    if (excess > 0) {
      const removable = existing.filter(([, entity]) => !cardSourceId(entity) && !sourceFor(entity));
      removable.slice(0, excess).forEach(([id]) => assembly.entities.delete(id));
      existing = [...assembly.entities.entries()].filter(([, entity]) => number(entity, 'currentGamePos', 'currentPos') === pos);
    }
    for (let index = existing.length; index < desired; index += 1) {
      const isPlayer1 = pos % 2 === 1;
      const id = `hidden-zone:${pos}:${index}`;
      assembly.entities.set(id, { entityID: id, currentGamePos: pos, currentPos: pos, isPlayer1 });
    }
  }
}

function upsertEvent(operation: OperationAssembly, key: string, event: TrackerEvent): void {
  if (!operation.events.has(key)) operation.eventOrder.push(key);
  operation.events.set(key, event);
}

export class LiveReviewAssembler {
  private readonly matches = new Map<string, MatchAssembly>();

  constructor(private readonly catalog: ReadonlyMap<string, CardInfo> = new Map()) {}

  ingest(captured: CapturedOperation): MatchReview | null {
    const matchKey = captured.matchId || captured.gameId;
    let assembly = this.matches.get(matchKey);
    if (!assembly) {
      assembly = {
        entities: new Map(),
        zoneCounts: new Map(),
        review: null,
        messageIds: new Set(),
        operations: new Map(),
        localAccountId: captured.accountId || undefined,
      };
      this.matches.set(matchKey, assembly);
    }
    if (captured.accountId) assembly.localAccountId = captured.accountId;

    // A PlayerMessage request and its full-board response can legitimately reuse
    // the same server message index. Only collapse byte-equivalent decoded
    // payloads; treating the index as unique discards the response and its zones.
    const messageId = `${matchKey}:${messageFingerprint(captured)}`;
    if (assembly.messageIds.has(messageId)) return assembly.review;
    assembly.messageIds.add(messageId);

    const operation = record(captured.operation) || {};
    updateZoneCountsFromBoard(operation, assembly.zoneCounts);
    const operationId = captured.operationId
      || text(operation, 'operationID', 'operationId')
      || `message:${messageId}`;
    let assembledOperation = assembly.operations.get(operationId);
    if (!assembledOperation) {
      assembledOperation = {
        id: operationId,
        playerOperation: null,
        modificationIds: new Set(),
        modifications: new Map(),
        events: new Map(),
        eventOrder: [],
        damageByTarget: new Map(),
        knockoutTargets: new Set(),
        prizesBySide: new Map(),
        hasDamage: false,
        privateDraws: new Map(),
        coinFlips: new Map(),
        selections: new Map(),
        selectionOrder: [],
        selectionMovementIds: new Map(),
      };
      assembly.operations.set(operationId, assembledOperation);
    }

    const gameOperationNumber = number(operation, 'operationNumber', 'OperationNumber');
    if (gameOperationNumber != null) assembledOperation.gameOperationNumber = gameOperationNumber;
    const playerOperation = record(value(operation, 'playerOperation', 'PlayerOperation'));
    if (playerOperation) assembledOperation.playerOperation = deepMerge(assembledOperation.playerOperation || undefined, playerOperation);

    const pendingSelection = selectionFromOperation(operation, assembly.entities, this.catalog);
    if (pendingSelection) {
      if (!assembledOperation.selections.has(pendingSelection.id)) assembledOperation.selectionOrder.push(pendingSelection.id);
      assembledOperation.selections.set(pendingSelection.id, pendingSelection);

      // A local deck search is the first time the server sends the identities of
      // cards that were previously represented only by anonymous zone slots.
      // Keep that knowledge after the selection closes so later deck/discard
      // views can follow the same entity IDs through subsequent movements.
      const optionIds = new Set(pendingSelection.allOptionIds);
      const revealedByDeck = new Map<number, Set<string>>();
      const rootCardEntities = list(operation, 'cardEntities', 'CardEntities')
        .flatMap((candidate) => cardEntitiesFrom(candidate));
      for (const revealed of rootCardEntities) {
        const id = entityId(revealed);
        const deckPosition = number(revealed, 'currentGamePos', 'currentPos');
        if (!id || !optionIds.has(id) || !cardSourceId(revealed) || (deckPosition !== 7 && deckPosition !== 8)) continue;
        assembly.entities.set(id, deepMerge(assembly.entities.get(id), revealed));
        const revealedIds = revealedByDeck.get(deckPosition) || new Set<string>();
        revealedIds.add(id);
        revealedByDeck.set(deckPosition, revealedIds);
      }
      for (const [deckPosition, revealedIds] of revealedByDeck) {
        // Some searches expose a strict subset, so never shrink a larger
        // authoritative zone count. A full-deck search, however, repairs a
        // partial capture by establishing the missing minimum cardinality.
        assembly.zoneCounts.set(deckPosition, Math.max(assembly.zoneCounts.get(deckPosition) || 0, revealedIds.size));
      }
    }

    const originId = text(assembledOperation.playerOperation, 'originEntityID', 'originEntityId');
    const modifications = list(operation, 'actionModifications', 'ActionModifications').map(record).filter(Boolean) as Entity[];
    const cardMovements = new Map<string, CardMovement>();
    modifications.forEach((modification, index) => {
      const modificationId = text(modification, 'actionModificationID', 'actionModificationId') || `${messageId}:${index}`;
      if (assembledOperation!.modificationIds.has(modificationId)) return;
      assembledOperation!.modificationIds.add(modificationId);
      assembledOperation!.modifications.set(modificationId, modification);
      const type = modificationType(modification);
      updateZoneCountsFromCardTransitions(modification, assembly!.zoneCounts, assembly!.entities, cardMovements);

      if (type === 'MoveCardsModification') {
        const sourceEntityId = text(modification, 'actionOriginEntityID', 'actionOriginEntityId');
        for (const candidate of list(modification, 'moveCardDeltas', 'MoveCardDeltas')) {
          const delta = record(candidate);
          const fromAddress = record(value(delta, 'fromCardAddress', 'FromCardAddress'));
          const toAddress = record(value(delta, 'toCardAddress', 'ToCardAddress'));
          const from = gamePositionNumber(fromAddress, assembly!.entities);
          const to = gamePositionNumber(toAddress, assembly!.entities);
          const movedEntityId = (toAddress && entityId(toAddress)) || (fromAddress && entityId(fromAddress));
          const drawSide = privateDrawSide(from, to, movedEntityId);
          if (!drawSide) continue;
          const key = `${drawSide}:${sourceEntityId || 'unknown'}`;
          const previous = assembledOperation!.privateDraws.get(key);
          const sourceEntity = sourceEntityId ? assembly!.entities.get(sourceEntityId) : undefined;
          assembledOperation!.privateDraws.set(key, {
            side: drawSide,
            count: (previous?.count || 0) + 1,
            sourceEntityId,
            effectSource: previous?.effectSource || Boolean(sourceEntity && (cardSourceId(sourceEntity) || sourceFor(sourceEntity))),
          });
        }
      }

      if (type === 'ApplyDamageModification') {
        assembledOperation!.hasDamage = true;
        if (bool(modification, 'isFinal', 'IsFinal') === true) {
          for (const candidate of list(modification, 'appliedDamageDeltas', 'AppliedDamageDeltas')) {
            const delta = record(candidate);
            const address = record(value(delta, 'cardAddress', 'CardAddress'));
            const targetId = address && text(address, 'entityID', 'entityId');
            const amount = number(delta, 'damageAmount', 'DamageAmount');
            if (targetId && amount && amount > 0) {
              assembledOperation!.damageByTarget.set(targetId, (assembledOperation!.damageByTarget.get(targetId) || 0) + amount);
            }
          }
        }
      }

      if (type === 'SetMetaDataModification') {
        for (const candidate of list(modification, 'setMetaDataDeltas', 'SetMetaDataDeltas')) {
          const delta = record(candidate);
          if (number(delta, 'metaDataKey', 'MetaDataKey') !== 22) continue;
          assembledOperation!.attackName ||= cleanBracketedName(text(delta, 'value', 'Value'));
        }
      }

      if (type === 'CoinFlipModification' && bool(modification, 'isFinal', 'IsFinal') !== false) {
        const results = coinFlipResults(modification);
        if (results.length) assembledOperation!.coinFlips.set(modificationId, results);
      }

      if (type === 'ActivateStatusEffectModification') {
        for (const candidate of list(modification, 'activateStatusEffectDeltas', 'ActivateStatusEffectDeltas')) {
          const delta = record(candidate);
          const effect = record(value(delta, 'activateStatusEffect', 'ActivateStatusEffect'));
          const actionName = text(effect, 'actionName', 'ActionName');
          const appliedBy = text(effect, 'appliedByEntityID', 'appliedByEntityId');
          if (actionName?.trimStart().startsWith('[Ability]') && (!originId || !appliedBy || appliedBy === originId)) {
            assembledOperation!.abilityName ||= actionName.replace(/^\[Ability\]\s*/, '').trim();
          }
        }
      }

      if (type === 'EndGameModification') {
        const winner = number(modification, 'winner', 'Winner');
        if (winner === 1 || winner === 2) assembledOperation!.winnerSide = winner;
        assembledOperation!.endReason = text(modification, 'winGameEndReasonLocID', 'WinGameEndReasonLocID', 'reason', 'Reason');
      }
    });

    const boardSnapshotEntities = matchBoardEntities(operation);
    if (boardSnapshotEntities.length) {
      for (const [existingId, existing] of assembly.entities) {
        const isZoneEntity = /(?:Deck|Hand|Prize|Discard|LostZone|Active|Bench)$/.test(position(existing)) || position(existing) === 'BoardStadium';
        const isAnonymousSnapshotEntity = existingId.startsWith('match-board:')
          || existingId.startsWith('hidden-zone:')
          || (!cardSourceId(existing) && !sourceFor(existing));
        if (isZoneEntity && isAnonymousSnapshotEntity) {
          assembly.entities.delete(existingId);
        }
      }
    }
    const operationEntityUpdates = [...boardSnapshotEntities, ...updatedEntities(operation)];
    const updatedEntityIds = new Set<string>();
    const currentEntityPositionChanges = new Set<string>();
    for (const entityUpdate of operationEntityUpdates) {
      const id = entityId(entityUpdate);
      if (!id) continue;
      updatedEntityIds.add(id);
      const previous = assembly.entities.get(id);
      const previousPosition = previous ? position(previous) : 'NONE';
      const wasMainPokemon = previous ? isMainPokemon(previous, assembly.entities) : false;
      const previousKnockouts = battleStat(previous, 'CardEntityTimesKnockedOut') || 0;
      const previousPrizes = battleStat(previous, 'PrizeCardsTaken') || 0;
      const merged = deepMerge(previous, entityUpdate);
      const movement = cardMovements.get(id);
      if (movement) {
        merged.previousGamePos = movement.from;
        merged.previousPos = movement.from;
        merged.currentGamePos = movement.to;
        merged.currentPos = movement.to;
        merged.currentParentEntityID = movement.toParent ?? null;
        merged.currentParentEntityId = movement.toParent ?? null;
        merged.curParentEntityID = movement.toParent ?? null;
        merged.curParentEntityId = movement.toParent ?? null;
        merged.parentEntityID = movement.toParent ?? null;
        merged.parentEntityId = movement.toParent ?? null;
      }
      assembly.entities.set(id, merged);

      const nextPosition = position(merged);
      if (previous && previousPosition !== nextPosition) currentEntityPositionChanges.add(id);
      const nextKnockouts = battleStat(merged, 'CardEntityTimesKnockedOut') || 0;
      if (
        previous
        && wasMainPokemon
        && /(?:Active|Bench)$/.test(previousPosition)
        && /Discard$/.test(nextPosition)
        && nextKnockouts > previousKnockouts
      ) {
        assembledOperation.knockoutTargets.add(id);
      }

      const side = playerNumber(merged);
      const nextPrizes = battleStat(merged, 'PrizeCardsTaken') || 0;
      if (side && previous && nextPrizes > previousPrizes) {
        assembledOperation.prizesBySide.set(side, (assembledOperation.prizesBySide.get(side) || 0) + nextPrizes - previousPrizes);
      }
    }

    for (const [id, movement] of cardMovements) {
      if (updatedEntityIds.has(id)) continue;
      const previous = assembly.entities.get(id);
      assembly.entities.set(id, {
        ...(previous || {}),
        entityID: id,
        previousGamePos: movement.from,
        previousPos: movement.from,
        currentGamePos: movement.to,
        currentPos: movement.to,
        currentParentEntityID: movement.toParent ?? null,
        currentParentEntityId: movement.toParent ?? null,
      });
    }

    const completedSelectionIds = new Set(list(operation, 'completedSelections', 'CompletedSelections').filter((candidate): candidate is string => typeof candidate === 'string'));
    for (const selectionId of assembledOperation.selectionOrder) {
      const selection = assembledOperation.selections.get(selectionId);
      if (!selection) continue;
      if (completedSelectionIds.has(selectionId)) selection.completed = true;
      // Search resolutions do not always repeat the chosen card in
      // `updatedEntities`. The exact MoveCards delta is still authoritative:
      // if an eligible option moved, that card was chosen. Accumulate those
      // exact moves across operation phases and prefer them over entity
      // snapshots, whose previousGamePos field can describe an older turn.
      const movedEligibleIds = [...cardMovements.keys()].filter((id) =>
        selection.eligibleOptionIds.includes(id)
      );
      const exactSelectionIds = assembledOperation.selectionMovementIds.get(selectionId) || new Set<string>();
      movedEligibleIds.forEach((id) => exactSelectionIds.add(id));
      if (exactSelectionIds.size > 0) {
        assembledOperation.selectionMovementIds.set(selectionId, exactSelectionIds);
        selection.selectedOptionIds = [...exactSelectionIds].slice(0, Math.max(0, selection.maximum));
      } else if (selection.completed && selection.selectedOptionIds.length === 0) {
        // A small number of protocol paths complete without a MoveCards delta.
        // Fall back only to positions that actually changed relative to the
        // reducer's prior state, never the stale previous/current pair carried
        // inside a full entity snapshot.
        selection.selectedOptionIds = selection.eligibleOptionIds
          .filter((id) => currentEntityPositionChanges.has(id))
          .slice(0, Math.max(0, selection.maximum));
      }
      if (selection.candidateVisibility === 'private' && selection.completed) {
        const privateResultIds = [...cardMovements.keys()].filter((id) =>
          id !== originId && !selection.selectedOptionIds.includes(id) && Boolean(cardSourceId(assembly!.entities.get(id)))
        );
        const privateRemaining = Math.max(0, selection.maximum - selection.selectedOptionIds.length);
        if (privateResultIds.length > 0 && privateResultIds.length <= privateRemaining) {
          selection.selectedOptionIds.push(...privateResultIds);
          for (const resultId of privateResultIds) {
            const resultEntity = assembly.entities.get(resultId);
            if (resultEntity && !selection.optionCards.some((card) => card.id === resultId)) {
              selection.optionCards.push(reviewCard(resultEntity, this.catalog));
            }
            const resultMovement = cardMovements.get(resultId);
            if (resultMovement?.from != null && !selection.sourceZonePositions.includes(resultMovement.from)) {
              selection.sourceZonePositions.push(resultMovement.from);
            }
          }
        }
      }
      selection.selectedOptionIds = [...new Set(selection.selectedOptionIds)]
        .slice(0, Math.max(0, selection.maximum));
    }

    const localSideForHiddenZones = ([1, 2] as const).find((side) => [...assembly!.entities.values()].some((entity) => {
      if (playerNumber(entity) !== side || !text(entity, 'userName', 'UserName')) return false;
      return entityId(entity) === assembly!.localAccountId
        || text(entity, 'ownerPlayerId', 'playerId', 'accountId') === assembly!.localAccountId;
    }));
    reconcileHiddenZones(assembly, localSideForHiddenZones);

    const playerEntities = [...assembly.entities.values()].filter((entity) => text(entity, 'userName', 'UserName'));
    if (playerEntities.length < 2) return assembly.review;
    const byNumber = new Map<number, Entity>();
    for (const player of playerEntities) {
      const side = playerNumber(player);
      if (side) byNumber.set(side, player);
    }
    if (!byNumber.get(1) || !byNumber.get(2)) return assembly.review;

    const playerIds: Record<1 | 2, string | undefined> = {
      1: entityId(byNumber.get(1)!),
      2: entityId(byNumber.get(2)!),
    };
    const playerAccountIds: Record<1 | 2, string | undefined> = {
      1: text(byNumber.get(1)!, 'ownerPlayerId', 'playerId', 'accountId'),
      2: text(byNumber.get(2)!, 'ownerPlayerId', 'playerId', 'accountId'),
    };
    const names: Record<1 | 2, string> = {
      1: text(byNumber.get(1)!, 'userName', 'UserName') || 'Player 1',
      2: text(byNumber.get(2)!, 'userName', 'UserName') || 'Player 2',
    };
    const boards: Record<1 | 2, TrackedPlayerBoard> = { 1: emptyBoard(names[1]), 2: emptyBoard(names[2]) };
    let stadium: string | null = null;

    for (const entity of assembly.entities.values()) {
      const pos = position(entity);
      const owner = ownerNumber(entity, playerIds);
      const isCardZone = /(?:Deck|Hand|Prize|Discard|LostZone|Active|Bench)$/.test(pos);
      if (!isCardZone && pos !== 'BoardStadium') continue;
      if (pos === 'BoardStadium') stadium = cardName(entity, this.catalog);
      if (!owner) continue;
      if (pos.endsWith('Hand')) {
        boards[owner].handCount += 1;
        if (cardSourceId(entity) || sourceFor(entity)) {
          boards[owner].knownHand.push(cardName(entity, this.catalog));
          boards[owner].knownHandCards?.push(asTrackedCard(entity, this.catalog));
        }
      }
      if (pos.endsWith('Deck')) {
        boards[owner].deckCount = (boards[owner].deckCount || 0) + 1;
        if (cardSourceId(entity) || sourceFor(entity)) boards[owner].deckCards?.push(asTrackedCard(entity, this.catalog));
      }
      if (pos.endsWith('Discard')) {
        boards[owner].discard.push(cardName(entity, this.catalog));
        boards[owner].discardCards?.push(asTrackedCard(entity, this.catalog));
      }
      if (pos.endsWith('LostZone')) boards[owner].lostZoneCards?.push(asTrackedCard(entity, this.catalog));
      if (pos.endsWith('Prize')) {
        boards[owner].prizeCards?.push(asTrackedCard(entity, this.catalog));
        continue;
      }
      if (pos.endsWith('Active') && isPokemonCard(entity, this.catalog) && isMainPokemon(entity, assembly.entities)) boards[owner].active = asPokemon(entity, assembly.entities, this.catalog);
      if (pos.endsWith('Bench') && isPokemonCard(entity, this.catalog) && isMainPokemon(entity, assembly.entities)) boards[owner].bench.push(asPokemon(entity, assembly.entities, this.catalog));
    }
    for (const side of [1, 2] as const) {
      const recordedPrizes = battleStat(byNumber.get(side), 'PrizeCardsTaken');
      const prizesLeft = [...assembly.entities.values()].filter((entity) => position(entity) === `Player${side}Prize`).length;
      boards[side].prizesTaken = recordedPrizes ?? (prizesLeft > 0 ? Math.max(0, 6 - prizesLeft) : 0);
    }

    const snapshot: TrackerBoardSnapshot = { players: { [names[1]]: boards[1], [names[2]]: boards[2] }, stadium };
    const localSide = ([1, 2] as const).find((side) =>
      playerIds[side] === assembly!.localAccountId
      || playerAccountIds[side] === assembly!.localAccountId
    ) || 1;

    if (!assembly.review) {
      const setupCanonical = buildCanonicalState(
        assembly.entities,
        this.catalog,
        { 1: byNumber.get(1)!, 2: byNumber.get(2)! },
        playerIds,
        names,
        localSide,
        undefined,
        undefined,
        [],
      );
      assembly.review = {
        id: `live-${matchKey}`,
        importedAt: new Date().toISOString(),
        source: 'live-network',
        players: [names[1], names[2]],
        localPlayer: names[localSide],
        opponent: names[localSide === 1 ? 2 : 1],
        turns: [{
          index: 0,
          label: boardSnapshotEntities.length ? 'Capture baseline' : 'Partial capture',
          events: [],
          snapshot,
          canonical: setupCanonical,
        }],
        rawLog: '',
      };
    }
    assembly.review.players = [names[1], names[2]];
    assembly.review.localPlayer = names[localSide];
    assembly.review.opponent = names[localSide === 1 ? 2 : 1];
    if (boardSnapshotEntities.length) {
      const baseline = assembly.review.turns[0];
      baseline.label = 'Capture baseline';
      baseline.snapshot = snapshot;
      baseline.canonical = buildCanonicalState(
        assembly.entities,
        this.catalog,
        { 1: byNumber.get(1)!, 2: byNumber.get(2)! },
        playerIds,
        names,
        localSide,
        undefined,
        undefined,
        [],
      );
    }

    const actorId = text(assembledOperation.playerOperation, 'accountID', 'accountId');
    const actorSide = ([1, 2] as const).find((side) =>
      playerIds[side] === actorId || playerAccountIds[side] === actorId
    );
    const actor = actorSide ? names[actorSide] : undefined;
    const assembledOriginId = text(assembledOperation.playerOperation, 'originEntityID', 'originEntityId');
    const originEntity = assembledOriginId ? assembly.entities.get(assembledOriginId) : undefined;
    const originName = originEntity && (cardSourceId(originEntity) || sourceFor(originEntity))
      ? cardName(originEntity, this.catalog)
      : undefined;
    const originInfo = cardInfo(originEntity, this.catalog);
    const opTypeRaw = value(assembledOperation.playerOperation, 'operationType', 'OperationType');
    const opType = typeof opTypeRaw === 'number'
      ? (OPERATION_TYPES[opTypeRaw] || `Operation ${opTypeRaw}`)
      : String(opTypeRaw || 'State update');
    assembledOperation.attackName ||= originInfo?.actions?.filter((action) => action.kind === 'attack').length === 1
      ? originInfo.actions.find((action) => action.kind === 'attack')?.name
      : undefined;
    assembledOperation.abilityName ||= originInfo?.actions?.filter((action) => action.kind === 'ability').length === 1
      ? originInfo.actions.find((action) => action.kind === 'ability')?.name
      : undefined;

    if (assembledOperation.turnIndex == null) {
      const meaningful = assembledOperation.gameOperationNumber != null
        || Boolean(assembledOperation.playerOperation)
        || assembledOperation.modificationIds.size > 0
        || assembledOperation.selectionOrder.length > 0;
      if (!meaningful) return assembly.review;
      assembledOperation.snapshotBefore = assembly.review.turns.at(-1)?.snapshot;
      assembledOperation.turnIndex = assembly.review.turns.length;
      assembly.review.turns.push({
        index: assembledOperation.turnIndex,
        label: `Action ${assembledOperation.turnIndex}`,
        gameOperationNumber: assembledOperation.gameOperationNumber,
        player: actor,
        events: [],
        snapshot,
      });
    }

    const turnIndex = assembledOperation.turnIndex;
    const actorPrefix = actor ? `${actor}: ` : '';
    const stadiumWasPlayed = assembledOriginId ? [...assembledOperation.modifications.values()].some((modification) =>
      modificationType(modification) === 'MoveCardsModification'
      && list(modification, 'moveCardDeltas', 'MoveCardDeltas').some((candidate) => {
        const delta = record(candidate);
        const from = record(value(delta, 'fromCardAddress', 'FromCardAddress'));
        const to = record(value(delta, 'toCardAddress', 'ToCardAddress'));
        return Boolean(to && entityId(to) === assembledOriginId)
          && number(to, 'pos', 'position') === 2
          && number(from, 'pos', 'position') !== 2;
      })
    ) : false;
    const pokemonWasBenched = Boolean(assembledOriginId && originEntity && isPokemonCard(originEntity, this.catalog)
      && [...assembledOperation.modifications.values()].some((modification) =>
        modificationType(modification) === 'MoveCardsModification'
        && list(modification, 'moveCardDeltas', 'MoveCardDeltas').some((candidate) => {
          const delta = record(candidate);
          const from = record(value(delta, 'fromCardAddress', 'FromCardAddress'));
          const to = record(value(delta, 'toCardAddress', 'ToCardAddress'));
          const movedId = (to && entityId(to)) || (from && entityId(from));
          const fromPosition = gamePositionNumber(from, assembly.entities);
          const toPosition = gamePositionNumber(to, assembly.entities);
          return movedId === assembledOriginId
            && (fromPosition === 11 || fromPosition === 12)
            && (toPosition === 13 || toPosition === 14);
        })
      ));
    if (!assembledOperation.winnerSide) {
      let primaryKind: TrackerEventKind = 'system';
      let primaryText = originName ? `${actorPrefix}${opType} — ${originName}` : `${actorPrefix}${opType}`;
      if (assembledOperation.hasDamage) {
        primaryKind = 'attack';
        primaryText = `${actorPrefix}${originName || 'Pokémon'} used ${assembledOperation.attackName || 'an attack'}`;
      } else if (assembledOperation.abilityName && opType === 'Use') {
        primaryKind = 'ability';
        primaryText = `${actorPrefix}${originName || 'Pokémon'} used ${assembledOperation.abilityName}`;
      } else if (pokemonWasBenched) {
        primaryKind = 'pokemon';
        primaryText = `${actorPrefix}Benched ${originName || 'a Pokémon'}`;
      } else if (opType === 'Place') {
        primaryKind = 'pokemon';
        primaryText = `${actorPrefix}placed ${originName || 'a Pokémon'}`;
      } else if (opType === 'Evolve') {
        primaryKind = 'pokemon';
        primaryText = `${actorPrefix}evolved into ${originName || 'a Pokémon'}`;
      } else if (opType === 'Attach') {
        const targetId = text(assembledOperation.playerOperation, 'targetID', 'targetId');
        const targetName = targetId ? cardName(assembly.entities.get(targetId), this.catalog) : undefined;
        primaryKind = isToolCard(originInfo) ? 'tool' : 'energy';
        primaryText = `${actorPrefix}attached ${originName || (primaryKind === 'tool' ? 'a Tool' : 'Energy')}${targetName ? ` to ${targetName}` : ''}`;
      } else if (opType === 'Retreat') {
        primaryText = `${actorPrefix}retreated ${originName || 'the Active Pokémon'}`;
      } else if (originName && (opType === 'Use' || opType === 'State update')) {
        primaryKind = eventKindForCard(originInfo, originEntity);
        primaryText = primaryKind === 'stadium' && stadiumWasPlayed
          ? `${actorPrefix}played ${originName}`
          : primaryKind === 'trainer'
          ? `${actorPrefix}played ${originName}`
          : `${actorPrefix}used ${originName}`;
      }
      upsertEvent(assembledOperation, 'primary', {
        id: `${operationId}:primary`, turnIndex, actor, sourceEntityId: assembledOriginId, cardId: originInfo?.id,
        cardFormat: originInfo?.format, cardType: originInfo?.cardType,
        text: primaryText, detail: false, kind: primaryKind,
      });
    }

    for (const [coinFlipId, results] of assembledOperation.coinFlips) {
      const outcome = coinFlipSummary(results);
      upsertEvent(assembledOperation, `coin:${coinFlipId}`, {
        id: `${operationId}:coin:${coinFlipId}`,
        turnIndex,
        actor,
        cardId: originInfo?.id,
        coinResult: outcome.result,
        text: `${actorPrefix}${originName || 'Coin flip'} — ${outcome.copy}`,
        detail: false,
        kind: 'coin',
      });
    }

    for (const [targetId, amount] of assembledOperation.damageByTarget) {
      const targetName = cardName(assembly.entities.get(targetId), this.catalog);
      upsertEvent(assembledOperation, `damage:${targetId}`, {
        id: `${operationId}:damage:${targetId}`,
        turnIndex,
        actor,
        sourceEntityId: assembledOriginId,
        targetEntityId: targetId,
        cardId: originInfo?.id,
        cardFormat: originInfo?.format,
        cardType: originInfo?.cardType,
        text: `${actorPrefix}${assembledOperation.attackName || originName || 'Attack'} dealt ${amount} damage to ${targetName}`,
        detail: false,
        kind: 'damage',
      });
    }

    for (const [drawKey, draw] of assembledOperation.privateDraws) {
      const drawingPlayer = names[draw.side];
      const drawSource = draw.effectSource && draw.sourceEntityId ? assembly.entities.get(draw.sourceEntityId) : undefined;
      const drawSourceInfo = cardInfo(drawSource, this.catalog);
      const drawSourceName = drawSource && (cardSourceId(drawSource) || sourceFor(drawSource))
        ? cardName(drawSource, this.catalog)
        : undefined;
      const isTriggeredDraw = Boolean(drawSourceName && draw.sourceEntityId !== assembledOriginId);
      const drawEventKey = `draw:${drawSourceName ? 'effect' : 'turn'}:${drawKey}`;
      const sourcePrefix = drawSourceName
        ? isTriggeredDraw ? `${drawSourceName} triggered — ` : `${drawSourceName} — `
        : '';
      upsertEvent(assembledOperation, drawEventKey, {
        id: `${operationId}:draw:${drawKey}`,
        turnIndex,
        actor: drawingPlayer,
        sourceEntityId: draw.sourceEntityId,
        cardId: drawSourceInfo?.id,
        cardFormat: drawSourceInfo?.format,
        cardType: drawSourceInfo?.cardType,
        text: `${sourcePrefix}${drawingPlayer} drew ${draw.count} card${draw.count === 1 ? '' : 's'}`,
        detail: false,
        kind: 'draw',
      });
    }

    for (const targetId of assembledOperation.knockoutTargets) {
      const targetName = cardName(assembly.entities.get(targetId), this.catalog);
      upsertEvent(assembledOperation, `knockout:${targetId}`, {
        id: `${operationId}:knockout:${targetId}`,
        turnIndex,
        actor,
        sourceEntityId: assembledOriginId,
        targetEntityId: targetId,
        cardId: originInfo?.id,
        cardFormat: originInfo?.format,
        cardType: originInfo?.cardType,
        text: `${targetName} was Knocked Out${originName ? ` by ${originName}` : ''}`,
        detail: false,
        kind: 'knockout',
      });
    }

    for (const [side, count] of assembledOperation.prizesBySide) {
      upsertEvent(assembledOperation, `prize:${side}`, {
        id: `${operationId}:prize:${side}`,
        turnIndex,
        actor: names[side],
        text: `${names[side]} took ${count} Prize card${count === 1 ? '' : 's'}`,
        detail: false,
        kind: 'prize',
      });
    }

    for (const selectionId of assembledOperation.selectionOrder) {
      const selection = assembledOperation.selections.get(selectionId);
      if (!selection) continue;
      const selectionSubject = selection.sourceCardId
        ? this.catalog.get(selection.sourceCardId)?.name || selection.sourceCardId
        : selection.kind === 'text' ? 'a game choice' : 'cards';
      const selectedNames = selection.selectedOptionIds
        .map((id) => cardName(assembly.entities.get(id), this.catalog))
        .filter((name) => name !== 'Unknown card');
      const promotedEntities = promotionEntitiesForSelection(selection, assembledOperation, assembly.entities);
      const promotedNames = promotedEntities.map((entity) => cardName(entity, this.catalog));
      const promotedSide = promotedEntities[0] ? ownerNumber(promotedEntities[0], playerIds) : undefined;
      const selectionActor = promotedSide ? names[promotedSide] : actor;
      const selectionActorPrefix = selectionActor ? `${selectionActor}: ` : '';
      const choiceSource = originName || selectionSubject;
      const choiceCopy = promotedNames.length
        ? `promoted ${naturalList(promotedNames)} to the Active Spot`
        : selectedNames.length
        ? `chose ${naturalList(selectedNames)} with ${choiceSource}`
        : selection.kind === 'entity' && selection.allOptionIds.length > 6
          ? `searched ${selection.allOptionIds.length} cards (${selection.eligibleOptionIds.length} eligible)`
          : `made ${/^[aeiou]/i.test(selection.kind) ? 'an' : 'a'} ${selection.kind} selection for ${selectionSubject}`;
      const selectionInfo = promotedEntities[0]
        ? cardInfo(promotedEntities[0], this.catalog)
        : selection.sourceCardId
        ? this.catalog.get(selection.sourceCardId) || this.catalog.get(selection.sourceCardId.toLowerCase())
        : originInfo;
      upsertEvent(assembledOperation, `selection:${selectionId}`, {
        id: `${operationId}:selection:${selectionId}`,
        turnIndex,
        actor: selectionActor,
        cardId: selectionInfo?.id,
        cardFormat: selectionInfo?.format,
        cardType: selectionInfo?.cardType,
        text: `${selectionActorPrefix}${choiceCopy}`,
        detail: false,
        kind: 'system',
      });
    }

    if (assembledOperation.winnerSide) {
      const winner = names[assembledOperation.winnerSide];
      const concession = /concede/i.test(assembledOperation.endReason || '');
      assembly.review.winner = winner;
      snapshot.winner = winner;
      upsertEvent(assembledOperation, 'endgame', {
        id: `${operationId}:endgame`,
        turnIndex,
        actor: winner,
        text: `Game over — ${winner} won${concession ? ' by opponent concession' : ''}`,
        detail: false,
        kind: 'system',
      });
    }

    const turn = assembly.review.turns[turnIndex];
    const currentTurnNumber = Math.max(1, battleStat(byNumber.get(1), 'TurnsPlayed') || 0, battleStat(byNumber.get(2), 'TurnsPlayed') || 0);
    turn.label = `Turn ${currentTurnNumber} · Action ${turnIndex}`;
    turn.gameOperationNumber = assembledOperation.gameOperationNumber;
    turn.player = actor;
    const choiceOriginId = assembledOriginId
      || assembledOperation.selectionOrder
        .map((selectionId) => assembledOperation!.selections.get(selectionId)?.sourceEntityId)
        .find((candidate): candidate is string => Boolean(candidate));
    const choiceOrigin = choiceOriginId ? assembly.entities.get(choiceOriginId) : undefined;
    const choiceOriginName = choiceOrigin && (cardSourceId(choiceOrigin) || sourceFor(choiceOrigin))
      ? cardName(choiceOrigin, this.catalog)
      : originName;
    const promotionEntitiesBySelection = new Map(assembledOperation.selectionOrder.flatMap((selectionId) => {
      const selection = assembledOperation!.selections.get(selectionId);
      if (!selection) return [];
      const promoted = promotionEntitiesForSelection(selection, assembledOperation!, assembly!.entities);
      return promoted.length ? [[selectionId, promoted] as const] : [];
    }));
    const promotionEventKeys = new Set([...promotionEntitiesBySelection.keys()].map((selectionId) => `selection:${selectionId}`));
    const choiceEntities: Array<{ entity: Entity; role: TrackedChoiceCard['choiceRole'] }> = [
      ...(choiceOrigin && (cardSourceId(choiceOrigin) || sourceFor(choiceOrigin)) ? [{ entity: choiceOrigin, role: 'action' as const }] : []),
      ...assembledOperation.selectionOrder.flatMap((selectionId) => {
        const selection = assembledOperation!.selections.get(selectionId);
        if (!selection) return [];
        const promotionIds = new Set(promotionEntitiesForSelection(selection, assembledOperation!, assembly!.entities)
          .map((entity) => entityId(entity)));
        return (selection?.selectedOptionIds || [])
          .map((id) => assembly!.entities.get(id))
          .filter((candidate): candidate is Entity => Boolean(candidate && (cardSourceId(candidate) || sourceFor(candidate))))
          .map((entity) => ({
            entity,
            role: promotionIds.has(entityId(entity))
              ? 'promoted' as const
              : /Discard$/.test(position(entity)) ? 'discarded' as const : 'chosen' as const,
          }));
      }),
    ];
    const seenChoiceIds = new Set<string>();
    turn.choiceCards = choiceEntities
      .filter(({ role }) => role !== 'promoted')
      .filter(({ entity }) => {
        const id = entityId(entity);
        if (!id || seenChoiceIds.has(id)) return false;
        seenChoiceIds.add(id);
        return true;
      })
      .map(({ entity, role }) => ({ ...asTrackedCard(entity, this.catalog), choiceRole: role }));
    const chosenCardNames = turn.choiceCards
      .filter((card) => card.choiceRole === 'chosen')
      .map((card) => card.name);
    turn.choiceLabel = assembledOperation.hasDamage
      ? assembledOperation.attackName ? `Attacked with ${assembledOperation.attackName}` : 'Attack resolved'
      : chosenCardNames.length
      ? `Chose ${naturalList(chosenCardNames)}${choiceOriginName ? ` with ${choiceOriginName}` : ''}`
      : assembledOperation.abilityName && opType === 'Use' ? `Used ${assembledOperation.abilityName}`
        : opType === 'Attach' ? isToolCard(originInfo) ? 'Attached a Pokémon Tool' : 'Attached Energy from hand'
          : opType === 'Evolve' ? 'Chose an evolution'
            : pokemonWasBenched ? `Benched ${originName || 'a Pokémon'}`
              : opType === 'Place' ? 'Played to the Bench'
              : opType === 'Retreat' ? 'Chose to retreat'
                : originName ? `Played ${originName}` : undefined;
    const operationFacts = buildOperationFacts(
      assembledOperation,
      assembly.entities,
      this.catalog,
      names,
      actor,
      originName,
      opType,
    );
    for (const [key, event] of assembledOperation.events) {
      assembledOperation.events.set(key, {
        ...event,
        facts: operationFacts.facts,
        protocolChanges: assembledOperation.modifications.size,
        internalChanges: operationFacts.internalChanges,
        protocolGroups: operationFacts.protocolGroups,
      });
    }
    const eventRank = (key: string): number => {
      if (key === 'primary') return 0;
      if (key.startsWith('coin:')) return 1;
      if (key.startsWith('damage:')) return 2;
      if (key.startsWith('draw:effect:')) return 3;
      if (key.startsWith('knockout:')) return 4;
      if (key.startsWith('prize:')) return 5;
      if (key.startsWith('draw:turn:')) return 7;
      return 6;
    };
    turn.events = assembledOperation.eventOrder
      .map((key, index) => ({ key, index, event: assembledOperation!.events.get(key)! }))
      .filter(({ key, event }) => Boolean(event) && !promotionEventKeys.has(key))
      .sort((left, right) => eventRank(left.key) - eventRank(right.key) || left.index - right.index)
      .map(({ event }) => event);
    const resolvesKnockouts = assembledOperation.hasDamage && assembledOperation.knockoutTargets.size > 0;
    const attackStageSnapshot = resolvesKnockouts && assembledOperation.snapshotBefore
      ? {
        ...snapshot,
        players: Object.fromEntries(Object.entries(snapshot.players).map(([playerName, playerBoard]) => {
          const beforeBoard = assembledOperation!.snapshotBefore!.players[playerName];
          return [playerName, beforeBoard
            ? { ...playerBoard, active: beforeBoard.active, bench: beforeBoard.bench }
            : playerBoard];
        })),
      }
      : snapshot;
    turn.snapshot = attackStageSnapshot;
    const winnerSide = assembledOperation.winnerSide
      || ([1, 2] as const).find((side) => assembly!.review?.winner === names[side]);
    const canonical = buildCanonicalState(
      assembly.entities,
      this.catalog,
      { 1: byNumber.get(1)!, 2: byNumber.get(2)! },
      playerIds,
      names,
      localSide,
      actorSide,
      winnerSide,
      assembledOperation.selectionOrder.map((selectionId) => assembledOperation!.selections.get(selectionId)!).filter(Boolean),
    );
    turn.canonical = canonical;

    const promotedEntities = [...promotionEntitiesBySelection.values()].flat();
    if (resolvesKnockouts && promotedEntities.length > 0) {
      if (assembledOperation.promotionTurnIndex == null) {
        assembledOperation.promotionTurnIndex = assembly.review.turns.length;
        assembly.review.turns.push({
          index: assembledOperation.promotionTurnIndex,
          label: `Turn ${currentTurnNumber} · Promotion`,
          gameOperationNumber: assembledOperation.gameOperationNumber,
          events: [],
          snapshot,
        });
      }
      const promotionTurnIndex = assembledOperation.promotionTurnIndex;
      const promotionTurn = assembly.review.turns[promotionTurnIndex];
      const promotedCards = promotedEntities
        .filter((entity, index, entities) => entities.findIndex((candidate) => entityId(candidate) === entityId(entity)) === index)
        .map((entity) => ({ ...asTrackedCard(entity, this.catalog), choiceRole: 'promoted' as const }));
      const promotedSide = ownerNumber(promotedEntities[0], playerIds);
      const promotedPlayer = promotedSide ? names[promotedSide] : undefined;
      promotionTurn.index = promotionTurnIndex;
      promotionTurn.label = `Turn ${currentTurnNumber} · Promotion`;
      promotionTurn.gameOperationNumber = assembledOperation.gameOperationNumber;
      promotionTurn.player = promotedPlayer;
      promotionTurn.choiceLabel = `Promoted ${naturalList(promotedCards.map((card) => card.name))} to the Active Spot`;
      promotionTurn.choiceCards = promotedCards;
      promotionTurn.events = assembledOperation.eventOrder
        .filter((key) => promotionEventKeys.has(key))
        .map((key) => assembledOperation!.events.get(key))
        .filter((event): event is TrackerEvent => Boolean(event))
        .map((event) => ({ ...event, turnIndex: promotionTurnIndex }));
      promotionTurn.snapshot = snapshot;
      promotionTurn.canonical = canonical;
    }
    return assembly.review;
  }
}

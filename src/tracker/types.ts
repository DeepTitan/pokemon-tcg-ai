import type { Card, GameState } from '../engine/types.js';

export type TrackerEventKind =
  | 'setup'
  | 'draw'
  | 'pokemon'
  | 'trainer'
  | 'tool'
  | 'energy'
  | 'ability'
  | 'attack'
  | 'damage'
  | 'coin'
  | 'knockout'
  | 'prize'
  | 'stadium'
  | 'system';

export type ReviewEventFactKind =
  | 'actor'
  | 'movement'
  | 'attachment'
  | 'target'
  | 'damage'
  | 'coin'
  | 'selection'
  | 'status'
  | 'reveal'
  | 'shuffle'
  | 'evolution'
  | 'resolution'
  | 'system';

export interface ReviewEventFact {
  id: string;
  kind: ReviewEventFactKind;
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'info';
}

export interface ReviewProtocolGroup {
  id: string;
  label: string;
  count: number;
  readableCount: number;
}

export interface TrackerEvent {
  id: string;
  turnIndex: number;
  actor?: string;
  /** Stable in-match entity IDs keep same-name cards distinct in the replay. */
  sourceEntityId?: string;
  targetEntityId?: string;
  cardId?: string;
  cardFormat?: string;
  cardType?: string;
  coinResult?: 'heads' | 'tails' | 'mixed';
  facts?: ReviewEventFact[];
  protocolChanges?: number;
  internalChanges?: number;
  protocolGroups?: ReviewProtocolGroup[];
  text: string;
  detail: boolean;
  kind: TrackerEventKind;
}

export interface CardInfo {
  id: string;
  name: string;
  hp?: number;
  cardType?: string;
  category?: number;
  setCode?: string;
  number?: string;
  imageDataUrl?: string;
  imagePath?: string;
  format?: string;
  retreat?: number;
  weaknessType?: string;
  weaknessAmount?: string;
  resistanceType?: string;
  resistanceAmount?: string;
  evolvesFrom?: string;
  rulesText?: string;
  actions?: CardActionInfo[];
}

export interface CardActionInfo {
  kind: 'ability' | 'attack' | 'rule';
  name: string;
  text: string;
  cost: string;
  damage: string;
}

export interface TrackedCard {
  id: string;
  cardId?: string;
  name: string;
  imageDataUrl?: string;
  cardType?: string;
}

export type TrackedChoiceRole = 'action' | 'chosen' | 'discarded' | 'promoted';

export interface TrackedChoiceCard extends TrackedCard {
  choiceRole: TrackedChoiceRole;
}

export interface TrackedPokemon extends TrackedCard {
  damage: number;
  maxHp?: number;
  energies: string[];
  evolutionStack: string[];
  energyCards?: TrackedCard[];
  evolutionCards?: TrackedCard[];
  toolCards?: TrackedCard[];
  statusConditions?: string[];
}

export interface TrackedPlayerBoard {
  name: string;
  active: TrackedPokemon | null;
  bench: TrackedPokemon[];
  handCount: number;
  knownHand: string[];
  knownHandCards?: TrackedCard[];
  deckCount?: number;
  deckCards?: TrackedCard[];
  discard: string[];
  discardCards?: TrackedCard[];
  lostZoneCards?: TrackedCard[];
  prizeCards?: TrackedCard[];
  prizesTaken: number;
}

export type ReviewCardVisibility = 'known' | 'hidden' | 'temporarily-revealed';

export interface ReviewSelection {
  id: string;
  kind: 'entity' | 'damage' | 'reparent' | 'text' | 'unknown';
  /** Whether the payload exposed every candidate or only the eventual result. */
  candidateVisibility?: 'captured' | 'private';
  selectionMethod?: number;
  subActionType?: number;
  sourceEntityId?: string;
  sourceCardId?: string;
  sourceZonePositions: number[];
  allOptionIds: string[];
  eligibleOptionIds: string[];
  selectedOptionIds: string[];
  optionCards: Card[];
  minimum: number;
  maximum: number;
  completed: boolean;
}

export interface ReviewAppliedEffect {
  id: string;
  name: string;
  effectType?: string;
  sourceCardId?: string;
  remainingDuration?: number;
  enabled: boolean;
}

export interface CanonicalReviewState {
  state: GameState;
  playerNames: [string, string];
  localPlayerIndex: 0 | 1;
  visibility: Record<string, ReviewCardVisibility>;
  appliedEffects: Record<string, ReviewAppliedEffect[]>;
  selections: ReviewSelection[];
  selection?: ReviewSelection;
}

export interface TrackerBoardSnapshot {
  players: Record<string, TrackedPlayerBoard>;
  stadium: string | null;
  winner?: string;
}

export interface TrackedTurn {
  index: number;
  label: string;
  gameOperationNumber?: number;
  player?: string;
  choiceLabel?: string;
  choiceCards?: TrackedChoiceCard[];
  events: TrackerEvent[];
  snapshot: TrackerBoardSnapshot;
  canonical?: CanonicalReviewState;
}

export interface MatchReview {
  id: string;
  importedAt: string;
  source: 'battle-log' | 'live-network';
  players: string[];
  localPlayer: string;
  opponent: string;
  winner?: string;
  resultReason?: 'local-client-closed';
  turns: TrackedTurn[];
  rawLog: string;
}

export interface MatchSummary {
  id: string;
  importedAt: string;
  source: MatchReview['source'];
  localPlayer: string;
  opponent: string;
  winner?: string;
  turnCount: number;
  operationCount: number;
  reducerVersion: number;
  finalSnapshot?: TrackerBoardSnapshot;
  recording: boolean;
}

export interface StorageStatus {
  rawOperations: number;
  rawMatches: number;
  derivedMatches: number;
  pendingMatches: number;
  archivedMatches: number;
  importedLegacyOperations: number;
}

export interface CaptureStatus {
  permissionReady: boolean;
  enabled: boolean;
  observerRunning: boolean;
  routeActive: boolean;
  clientAttached: boolean;
  frameCount: number;
  operationCount: number;
  lastError: string | null;
  observerPort: number;
}

export interface CapturedOperation {
  receivedAt: string;
  socketHost: string;
  globalMessageType: string;
  gameId: string;
  messageType: string | number | null;
  matchId: string | null;
  accountId: string | null;
  operationId: string | null;
  messageIndex: number | null;
  operation: Record<string, unknown>;
}

export interface TrackerEnvironment {
  clientInstalled: boolean;
  clientRunning: boolean;
  pid: number | null;
  captureMode: 'existing-client';
  capture: CaptureStatus;
}

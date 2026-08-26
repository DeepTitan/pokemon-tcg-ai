import assert from 'node:assert/strict';
import { CardType, GamePhase, TrainerType, type GameState } from '../../engine/types.js';
import { deriveReviewTurnStatus } from '../turn-status-model.js';
import type { CanonicalReviewState, MatchReview, TrackedPlayerBoard, TrackedTurn } from '../types.js';

const names: [string, string] = ['Alex', 'Blair'];
const emptyBoard = (name: string): TrackedPlayerBoard => ({
  name, active: null, bench: [], handCount: 0, knownHand: [], discard: [], prizesTaken: 0,
});
const snapshot = (stadium: string | null) => ({ players: { Alex: emptyBoard('Alex'), Blair: emptyBoard('Blair') }, stadium });
const turn = (index: number, player: string, text: string, kind: TrackedTurn['events'][number]['kind'], stadium: string | null, cardFormat?: string): TrackedTurn => ({
  index, label: `Turn ${Math.ceil(index / 2)}`, player, snapshot: snapshot(stadium),
  events: [{ id: `event-${index}`, turnIndex: index, actor: player, text, detail: false, kind, cardFormat }],
});
const turns = [
  turn(0, 'Alex', 'Alex: played Artazon', 'stadium', 'Artazon'),
  turn(1, 'Alex', 'Alex: Budew used Itchy Pollen', 'attack', 'Artazon'),
  turn(2, 'Blair', 'Blair: played Iono', 'trainer', 'Artazon', 'S'),
  turn(3, 'Alex', 'Alex: drew a card', 'draw', 'Artazon'),
];
const review: MatchReview = {
  id: 'status-test', importedAt: '', source: 'live-network', players: names,
  localPlayer: 'Alex', opponent: 'Blair', turns, rawLog: '',
};
const player = (supporterPlayedThisTurn: boolean) => ({
  deck: [], hand: [], active: null, bench: [], prizes: [], discard: [], lostZone: [],
  supporterPlayedThisTurn, energyAttachedThisTurn: false, retreatedThisTurn: false,
  prizeCardsRemaining: 6, extraTurn: false, skipNextTurn: false, abilitiesUsedThisTurn: [],
});
const gameState: GameState = {
  players: [player(false), player(true)], currentPlayer: 1, turnNumber: 1, phase: GamePhase.MainPhase,
  stadium: {
    id: 'stadium', name: 'Artazon', cardType: CardType.Trainer, trainerType: TrainerType.Stadium,
    imageUrl: '', cardNumber: '',
  },
  winner: null, turnActions: [], gameLog: [], gameFlags: [],
};
const canonical: CanonicalReviewState = {
  state: gameState, playerNames: names, localPlayerIndex: 0, visibility: {}, appliedEffects: {}, selections: [],
};

const duringLock = deriveReviewTurnStatus(review, 2, canonical);
assert.equal(duringLock.currentPlayer, 'Blair');
assert.equal(duringLock.stadiumOwner, 'Alex');
assert.equal(duringLock.players.Blair.supporterUsed, true);
assert.equal(duringLock.players.Blair.itemLocked, true);
assert.equal(duringLock.players.Blair.stadiumUsed, false);

const afterLock = deriveReviewTurnStatus(review, 3, { ...canonical, state: { ...gameState, currentPlayer: 0 } });
assert.equal(afterLock.players.Blair.itemLocked, false);

const stadiumPlay = deriveReviewTurnStatus(review, 0, { ...canonical, state: { ...gameState, currentPlayer: 0 } });
assert.equal(stadiumPlay.players.Alex.stadiumUsed, true);

console.log('turn status model tests passed');

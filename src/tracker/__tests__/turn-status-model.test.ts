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

const sharedStadiumTurns = [
  turn(0, 'Alex', 'Alex: played Artazon', 'stadium', 'Artazon'),
  turn(1, 'Blair', 'Blair: used Artazon', 'stadium', 'Artazon'),
  turn(2, 'Blair', 'Blair: played Artazon', 'stadium', 'Artazon'),
];
sharedStadiumTurns[2].events[0].facts = [{ id: 'use', kind: 'resolution', label: 'Action', tone: 'neutral', value: 'Use' }];
const sharedStadiumReview = { ...review, turns: sharedStadiumTurns };
for (const index of [0, 1, 2, 1, 0]) {
  assert.equal(deriveReviewTurnStatus(sharedStadiumReview, index, canonical).stadiumOwner, 'Alex', 'Activation never transfers ownership, including legacy played labels and rewinds');
}
sharedStadiumTurns.push(turn(3, 'Blair', 'Blair: played Artazon', 'stadium', 'Artazon'));
sharedStadiumTurns[0].events[0].sourceEntityId = 'old-stadium';
sharedStadiumTurns[3].events[0].sourceEntityId = 'new-stadium';
assert.equal(deriveReviewTurnStatus(sharedStadiumReview, 3, { ...canonical,
  state: { ...gameState, stadium: { ...gameState.stadium!, id: 'new-stadium' } } }).stadiumOwner, 'Blair', 'A replacement belongs to the player who placed that physical card');
assert.equal(deriveReviewTurnStatus(sharedStadiumReview, 2, { ...canonical,
  state: { ...gameState, stadium: { ...gameState.stadium!, id: 'unrecorded-stadium' } } }).stadiumOwner, undefined, 'Do not reuse an owner from a different physical Stadium');
assert.equal(deriveReviewTurnStatus(sharedStadiumReview, 2, { ...canonical, stadiumOwner: 'Blair' }).stadiumOwner, 'Blair', 'Captured ownership outranks incomplete event text');

console.log('turn status model tests passed');

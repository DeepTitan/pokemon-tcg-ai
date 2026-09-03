import assert from 'node:assert/strict';
import { archiveMatchup, formatMatchDuration, formatPrizeScore, representativePokemon } from '../archive-summary-model.js';
import type { CardInfo, MatchSummary, TrackedPlayerBoard } from '../types.js';

const catalog = new Map<string, CardInfo>([
  ['alakazam', { id: 'alakazam', name: 'Alakazam', category: 1, hp: 140, imageDataUrl: 'alakazam.png' }],
  ['fez', { id: 'fez', name: 'Fezandipiti ex', category: 1, hp: 210, imageDataUrl: 'fez.png' }],
  ['dragapult', { id: 'dragapult', name: 'Dragapult ex', category: 1, hp: 320, imageDataUrl: 'dragapult.png' }],
  ['poffin', { id: 'poffin', name: 'Buddy-Buddy Poffin', category: 2 }],
]);

const board: TrackedPlayerBoard = {
  name: 'You',
  active: { id: 'fez-1', cardId: 'fez', name: 'Fezandipiti ex', damage: 0, maxHp: 210, energies: [], evolutionStack: [] },
  bench: [
    { id: 'alakazam-1', cardId: 'alakazam', name: 'Alakazam', damage: 0, maxHp: 140, energies: [], evolutionStack: [] },
    { id: 'alakazam-2', cardId: 'alakazam', name: 'Alakazam', damage: 0, maxHp: 140, energies: [], evolutionStack: [] },
  ],
  handCount: 3,
  knownHand: [],
  discard: [],
  discardCards: [
    { id: 'alakazam-3', cardId: 'alakazam', name: 'Alakazam' },
    { id: 'poffin-1', cardId: 'poffin', name: 'Buddy-Buddy Poffin' },
  ],
  prizesTaken: 4,
};

assert.equal(representativePokemon(board, catalog)?.name, 'Alakazam', 'repetition should beat a one-off support ex');

const evolutionBoard: TrackedPlayerBoard = {
  ...board,
  active: {
    id: 'alakazam-main', cardId: 'alakazam', name: 'Alakazam', damage: 0, maxHp: 140,
    energies: [], evolutionStack: ['Kadabra', 'Abra'],
  },
  bench: [
    { id: 'abra-1', name: 'Abra', cardType: 'P', damage: 0, maxHp: 50, energies: [], evolutionStack: [] },
    { id: 'abra-2', name: 'Abra', cardType: 'P', damage: 0, maxHp: 50, energies: [], evolutionStack: [] },
  ],
  discardCards: [
    { id: 'dunsparce-1', name: 'Dunsparce', cardType: 'C' },
    { id: 'dunsparce-2', name: 'Dunsparce', cardType: 'C' },
    { id: 'dunsparce-3', name: 'Dunsparce', cardType: 'C' },
  ],
  knownHandCards: [
    { id: 'kadabra-1', name: 'Kadabra', cardType: 'P' },
    { id: 'kadabra-2', name: 'Kadabra', cardType: 'P' },
    { id: 'kadabra-3', name: 'Kadabra', cardType: 'P' },
  ],
};
assert.equal(representativePokemon(evolutionBoard, catalog)?.name, 'Alakazam', 'the evolved centerpiece should inherit its lower-stage evidence and ignore hand noise');
assert.equal(formatMatchDuration(27), 'Time 27s');
assert.equal(formatMatchDuration(1_327.648), 'Time 22m');
assert.equal(formatMatchDuration(3_901), 'Time 1h 5m');
assert.equal(formatMatchDuration(undefined), 'Time —');
assert.equal(formatPrizeScore(6, 2), 'Prizes 6–2');
assert.equal(formatPrizeScore(6, undefined), 'Prizes —');

const opponentBoard: TrackedPlayerBoard = {
  ...board,
  name: 'Them',
  active: { id: 'dragapult-1', cardId: 'dragapult', name: 'Dragapult ex', damage: 0, maxHp: 320, energies: [], evolutionStack: [] },
  bench: [],
  discardCards: [],
  prizesTaken: 2,
};
const summary: MatchSummary = {
  id: 'match-1',
  importedAt: '2026-09-03T09:00:29.406Z',
  source: 'live-network',
  localPlayer: 'You',
  opponent: 'Them',
  winner: 'You',
  turnCount: 10,
  operationCount: 212,
  reducerVersion: 10,
  durationSeconds: 1_328,
  finalSnapshot: { players: { You: board, Them: opponentBoard }, stadium: null },
  recording: false,
};
const matchup = archiveMatchup(summary, catalog);
assert.equal(matchup.localCard?.name, 'Alakazam');
assert.equal(matchup.opponentCard?.name, 'Dragapult ex');
assert.equal(formatPrizeScore(matchup.localPrizesTaken, matchup.opponentPrizesTaken), 'Prizes 4–2');

console.log('archive-summary-model: deck centerpieces, duration, and prize score verified');

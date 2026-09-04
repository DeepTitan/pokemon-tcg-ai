import assert from 'node:assert/strict';
import { sortCardsForDisplay } from '../card-order-model.js';

const cards = [
  { id: '1', name: 'Rare Candy' },
  { id: '2', name: 'Abra' },
  { id: '3', name: 'Rare Candy' },
  { id: '4', name: 'Hidden card' },
  { id: '5', name: 'Abra' },
];

assert.deepEqual(
  sortCardsForDisplay(cards).map((card) => card.id),
  ['2', '5', '1', '3', '4'],
  'matching cards should be adjacent, equal copies should remain stable, and hidden cards should follow known cards',
);
assert.deepEqual(cards.map((card) => card.id), ['1', '2', '3', '4', '5'], 'display ordering must not mutate captured zone order');

const unresolved = [
  { id: 'a', name: 'sv-test-9' },
  { id: 'b', name: 'Munkidori' },
  { id: 'c', name: 'sv-test-8' },
];
const resolvedNames = new Map([['a', 'Munkidori'], ['b', 'Munkidori'], ['c', 'Buddy-Buddy Poffin']]);
assert.deepEqual(
  sortCardsForDisplay(unresolved, (card) => resolvedNames.get(card.id) || card.name).map((card) => card.id),
  ['c', 'a', 'b'],
  'resolved catalog names should drive grouping when captured names are source IDs',
);

console.log('card-order-model: identical cards are grouped without mutating captured order');

import assert from 'node:assert/strict';
import { actionCardsForTurn } from '../action-card-model.js';
import { cardInfoToEngineCard } from '../card-adapter.js';
import type { CardInfo, ReviewSelection, TrackedTurn } from '../types.js';

const source: CardInfo = { id: 'sv6_129', name: 'Drakloak', category: 1, hp: 90, cardType: 'N' };
const chosen: CardInfo = { id: 'sv1_196', name: 'Ultra Ball', category: 2 };
const other: CardInfo = { id: 'sv2_185', name: 'Iono', category: 2 };
const catalog = new Map([source, chosen, other].map((card) => [card.id, card]));
const otherImage = '/fixture/unchosen-iono.png';

function fixture(overrides: Partial<ReviewSelection> = {}): { turn: TrackedTurn; choice: ReviewSelection } {
  const otherCard = cardInfoToEngineCard(other, 'other-instance');
  otherCard.imageUrl = otherImage;
  const choice: ReviewSelection = {
    id: 'recon-choice',
    kind: 'entity',
    candidateVisibility: 'captured',
    sourceEntityId: 'source-instance',
    sourceCardId: source.id,
    sourceZonePositions: [8],
    allOptionIds: ['chosen-instance', 'other-instance'],
    eligibleOptionIds: ['chosen-instance', 'other-instance'],
    selectedOptionIds: ['chosen-instance'],
    optionCards: [cardInfoToEngineCard(chosen, 'chosen-instance'), otherCard],
    minimum: 1,
    maximum: 1,
    completed: true,
    ...overrides,
  };
  return {
    choice,
    turn: {
      index: 3,
      label: 'Turn 2 · Action 3',
      player: 'Isaiah',
      choiceCards: [
        { id: 'source-instance', cardId: source.id, name: source.name, choiceRole: 'action' },
        { id: 'chosen-instance', cardId: chosen.id, name: chosen.name, choiceRole: 'chosen' },
      ],
      events: [
        { id: 'recon:primary', turnIndex: 3, actor: 'Isaiah', cardId: source.id, text: 'Isaiah: Drakloak used Recon Directive', kind: 'ability', detail: false },
        { id: 'recon:selection:recon-choice', turnIndex: 3, actor: 'Isaiah', cardId: source.id, text: 'Isaiah: chose Ultra Ball with Drakloak', kind: 'system', detail: false },
      ],
      snapshot: { players: {}, stadium: null },
      canonical: { selections: [choice] } as TrackedTurn['canonical'],
    },
  };
}

const captured = fixture();
const before = JSON.stringify(captured.turn);
const displayed = actionCardsForTurn(captured.turn, catalog);
assert.deepEqual(displayed.map((card) => [card.id, card.choiceRole]), [
  ['source-instance', 'action'],
  ['chosen-instance', 'chosen'],
  ['other-instance', 'unchosen'],
], 'the captured alternative follows the original action and chosen card');
assert.deepEqual(displayed.slice(0, 2), captured.turn.choiceCards, 'existing choice-card details and order remain unchanged');
assert.equal(displayed[2].cardId, other.id, 'the thumbnail keeps the exact printing source ID');
assert.equal(displayed[2].name, other.name);
assert.equal(displayed[2].imageDataUrl, otherImage, 'captured artwork is retained for the unchosen thumbnail');
assert.deepEqual(actionCardsForTurn(captured.turn, catalog), displayed, 'repeated rendering does not append another alternative');
assert.equal(JSON.stringify(captured.turn), before, 'display derivation must not mutate saved choices or canonical selections');

const alreadyDisplayed = { ...captured.turn, choiceCards: displayed };
assert.deepEqual(actionCardsForTurn(alreadyDisplayed, catalog), displayed, 'an alternative already in choiceCards is not duplicated');

const sameName = fixture();
sameName.choice.optionCards[1] = cardInfoToEngineCard(chosen, 'other-instance');
assert.deepEqual(actionCardsForTurn(sameName.turn, catalog).map((card) => [card.id, card.name, card.choiceRole]), [
  ['source-instance', 'Drakloak', 'action'],
  ['chosen-instance', 'Ultra Ball', 'chosen'],
  ['other-instance', 'Ultra Ball', 'unchosen'],
], 'identical names and printing IDs must not collapse distinct physical copies');

for (const [label, overrides] of [
  ['pending choice', { completed: false }],
  ['private choice', { candidateVisibility: 'private' }],
  ['no chosen card', { selectedOptionIds: [] }],
  ['stale chosen ID', { selectedOptionIds: ['missing-instance'] }],
  ['no captured options', { allOptionIds: [] }],
  ['missing option cards', { optionCards: [] }],
] satisfies Array<[string, Partial<ReviewSelection>]>) {
  const sample = fixture(overrides);
  assert.deepEqual(actionCardsForTurn(sample.turn, catalog), sample.turn.choiceCards, `${label} must not add alternatives`);
}

for (const name of ['Hidden card', 'Unknown card', '', '   ']) {
  const sample = fixture();
  sample.choice.optionCards[1].name = name;
  assert.deepEqual(actionCardsForTurn(sample.turn, catalog), sample.turn.choiceCards, `an unresolved candidate must not become a thumbnail: ${JSON.stringify(name)}`);
}

const missingSelection = fixture();
missingSelection.turn.canonical = undefined;
assert.deepEqual(actionCardsForTurn(missingSelection.turn, catalog), missingSelection.turn.choiceCards, 'legacy turns without canonical choices keep their original cards');
const mismatchedSelection = fixture({ id: 'another-choice' });
assert.deepEqual(actionCardsForTurn(mismatchedSelection.turn, catalog), mismatchedSelection.turn.choiceCards, 'the alternative must belong to the linked selection event');
const unrelated = fixture();
unrelated.turn.events[0].text = 'Isaiah: Drakloak used Another Ability';
assert.deepEqual(actionCardsForTurn(unrelated.turn, catalog), unrelated.turn.choiceCards, 'unrelated abilities retain the existing action panel');

const missingAction = fixture({ candidateVisibility: 'private' });
missingAction.turn.choiceCards = missingAction.turn.choiceCards!.slice(1);
const withSource = actionCardsForTurn(missingAction.turn, catalog);
assert.deepEqual(withSource.map((card) => [card.cardId, card.choiceRole]), [
  [source.id, 'action'], [chosen.id, 'chosen'],
], 'the existing event-to-action-card fallback remains available and deduplicates the source');
const promotion = fixture();
promotion.turn.choiceCards = [{ id: 'promoted-instance', cardId: source.id, name: source.name, choiceRole: 'promoted' }];
assert.deepEqual(actionCardsForTurn(promotion.turn, catalog), promotion.turn.choiceCards, 'promotion-only panels retain their existing special case');

console.log('action-card-model: Recon alternatives preserve physical identity, privacy, order, artwork, and saved state');

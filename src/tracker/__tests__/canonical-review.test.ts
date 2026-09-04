import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardType, TrainerType } from '../../engine/types.js';
import { cardInfoToEngineCard, cardSourceIdFromReviewCard } from '../card-adapter.js';
import { LiveReviewAssembler } from '../live-operation-reducer.js';
import { ReviewOverlay } from '../ReviewInteractions.js';
import { displayedDeckCount, trackedTurnToCanonical } from '../review-state-adapter.js';
import type { CapturedOperation, CardInfo, MatchReview } from '../types.js';

assert.equal(displayedDeckCount({ deckCount: 0 }, 7), 0, 'a captured empty deck must not fall back to an estimate');
assert.equal(displayedDeckCount({}, 7), 7, 'legacy reviews without a deck count may use their canonical count');
assert.equal(displayedDeckCount({ deckCount: 0, deckCountKnown: false }, 7), '?', 'a private deck lower bound must never be presented as its exact count');

const legacyReview = {
  id: 'legacy-card-id', importedAt: '2026-09-03T00:00:00.000Z', source: 'battle-log', players: ['Isaiah', 'Opponent'],
  localPlayer: 'Isaiah', opponent: 'Opponent', rawLog: '', turns: [{
    index: 0, label: 'Turn 1', events: [], snapshot: { stadium: null, players: {
      Isaiah: { name: 'Isaiah', active: null, bench: [], handCount: 0, knownHand: [], deckCount: 0, discard: [], discardCards: [{ id: 'legacy-boss', cardId: 'sv2_248', name: 'sv2_248' }], prizesTaken: 0 },
      Opponent: { name: 'Opponent', active: null, bench: [], handCount: 0, knownHand: [], deckCount: 0, discard: [], prizesTaken: 0 },
    } },
  }],
} satisfies MatchReview;
const legacyCanonical = trackedTurnToCanonical(legacyReview, legacyReview.turns[0]);
assert.equal(cardSourceIdFromReviewCard(legacyCanonical.state.players[0].discard[0]), 'sv2_248', 'legacy replay conversion must preserve the stable card source ID');

const unresolvedBoss = cardInfoToEngineCard(undefined, 'late-boss', 'sv2_248', 'sv2_248');
assert.equal(cardSourceIdFromReviewCard(unresolvedBoss), 'sv2_248', 'late metadata must not erase the stable card source ID');
const hydratedOverlay = renderToStaticMarkup(createElement(ReviewOverlay, {
  inspector: {
    kind: 'zone',
    title: 'Opponent · Discard pile',
    subtitle: 'Public cards',
    cards: [unresolvedBoss],
    visibility: { 'late-boss': 'known' },
  },
  catalog: new Map([['sv2_248', {
    id: 'sv2_248', name: "Boss's Orders", category: 2, format: 'S', imageDataUrl: 'asset://localhost/boss.png',
  }]]),
  onClose: () => undefined,
  onInspectCard: () => undefined,
}));
assert.match(hydratedOverlay, /Boss&#x27;s Orders/, 'the zone modal should replace a raw ID when metadata arrives');
assert.match(hydratedOverlay, /asset:\/\/localhost\/boss\.png/, 'the zone modal should replace the card back when artwork arrives');

const catalog = new Map<string, CardInfo>([
  ['top-mon', { id: 'top-mon', name: 'Dragapult ex', hp: 320, category: 1, cardType: 'P', format: '2ex', retreat: 1, weaknessType: 'D', evolvesFrom: 'Drakloak', actions: [{ kind: 'ability', name: 'Infiltrator', text: 'Once during your turn, do a thing.', cost: '', damage: '' }, { kind: 'attack', name: 'Phantom Dive', text: 'Put damage counters on the Bench.', cost: 'PR', damage: '200' }] }],
  ['base-mon', { id: 'base-mon', name: 'Drakloak', hp: 90, category: 1, cardType: 'P', format: '1', evolvesFrom: 'Dreepy' }],
  ['energy-p', { id: 'energy-p', name: 'Basic Psychic Energy', category: 3, cardType: 'P' }],
  ['tool-one', { id: 'tool-one', name: 'Maximum Belt', category: 2, format: '=T', rulesText: 'The attacks of the Pokémon this card is attached to do more damage.' }],
  ['searcher', { id: 'searcher', name: 'Ultra Ball', category: 2, format: 'I', rulesText: 'Search your deck for a Pokémon.' }],
  ['stadium-searcher', { id: 'stadium-searcher', name: 'Spikemuth Gym', category: 2, format: '=A', rulesText: "Once during each player's turn, that player may search their deck for a Marnie's Pokémon." }],
  ['marnie-result', { id: 'marnie-result', name: "Marnie's Impidimp", hp: 70, category: 1, cardType: 'D', format: '0' }],
  ['option-a', { id: 'option-a', name: 'Dreepy', hp: 70, category: 1, cardType: 'P', format: '0' }],
  ['option-b', { id: 'option-b', name: 'Munkidori', hp: 110, category: 1, cardType: 'D', format: '0' }],
  ['option-c', { id: 'option-c', name: 'Iono', category: 2, format: 'S', rulesText: 'Each player shuffles their hand.' }],
  ['dedenne-card', { id: 'dedenne-card', name: 'Dedenne', hp: 70, category: 1, cardType: 'P', format: '0', actions: [{ kind: 'attack', name: 'Electromagnetic Sonar', text: 'Put 1 Trainer card from your discard pile into your hand.', cost: 'P', damage: '' }] }],
  ['dawn-card', { id: 'dawn-card', name: 'Dawn', category: 2, format: 'S' }],
  ['poke-pad-card', { id: 'poke-pad-card', name: 'Poké Pad', category: 2, format: 'I' }],
]);

const base: Omit<CapturedOperation, 'receivedAt' | 'operationId' | 'messageIndex' | 'operation'> = {
  socketHost: 'api.us-east-1.studio-prod.pokemon.com',
  globalMessageType: 'PlayerMessage',
  gameId: 'canonical-game',
  messageType: 11,
  matchId: 'canonical-match',
  accountId: 'local-account',
};

function specialConditionEffect(effectTag: number, applicationID: string, actionName = 'Captured condition') {
  return {
    actionName,
    applicationID,
    activated: true,
    effectEnabled: true,
    remainingDuration: -1,
    statusEffect: {
      $type: 'MatchLogic.SpecialConditionEffect, MatchLogic',
      effectTag,
      // This number is the strength, not the condition enum. It deliberately
      // stays 1 for every fixture so the EffectTag mapping is what is tested.
      specialConditionValue: { value1: { explicitValue: 1 } },
    },
  };
}

const capturedConditions = [
  specialConditionEffect(1, '[Ability] Subjugating Chains_SpecialCondition_Poison', '[Ability] Subjugating Chains'),
  specialConditionEffect(2, 'captured-effect-tag-2'),
  specialConditionEffect(3, 'captured-effect-tag-3'),
  specialConditionEffect(4, 'captured-effect-tag-4'),
  specialConditionEffect(5, 'captured-effect-tag-5'),
];

const fullBoard: CapturedOperation = {
  ...base,
  receivedAt: '1.000Z',
  operationId: 'board-state',
  messageIndex: 10,
  operation: {
    matchBoard: {
      boardEntity: { entityID: 'board', currentGamePos: 1 },
      player1: { entityID: 'player-1', ownerPlayerId: 'opponent-account', currentGamePos: 3, isPlayer1: true, userName: 'Opponent', battleFlagCounts: { TurnsPlayed: 2 } },
      player2: { entityID: 'player-2', ownerPlayerId: 'local-account', currentGamePos: 4, isPlayer1: false, userName: 'Isaiah', battleFlagCounts: { TurnsPlayed: 2 } },
      p1Deck: Array.from({ length: 3 }, () => ({ currentGamePos: 7, isPlayer1: true })),
      p1Hand: [
        { entityID: 'opponent-private-card', isPlayer1: true, cardSourceID: 'option-b' },
        { isPlayer1: true },
      ],
      p1Prize: Array.from({ length: 6 }, () => ({ currentGamePos: 19, isPlayer1: true })),
      p1Discard: [], p1Bench: [], p1Active: null,
      p2Deck: Array.from({ length: 4 }, () => ({ currentGamePos: 8 })),
      p2Hand: [{ entityID: 'search-card', ownerPlayerId: 'local-account', currentGamePos: 12, cardSourceID: 'searcher' }],
      p2Prize: Array.from({ length: 6 }, () => ({ currentGamePos: 20 })),
      p2Discard: [], p2Bench: [],
      p2Active: {
        entityID: 'top', ownerPlayerId: 'local-account', currentGamePos: 16, cardSourceID: 'top-mon', damageCounters: 4,
        attachedPokemon: [{ entityID: 'base', ownerPlayerId: 'local-account', currentGamePos: 16, currentParentEntityID: 'top', cardSourceID: 'base-mon' }],
        attachedEnergy: [{ entityID: 'energy', ownerPlayerId: 'local-account', currentGamePos: 16, currentParentEntityID: 'top', cardSourceID: 'energy-p' }],
        attachedTools: [{ entityID: 'tool', ownerPlayerId: 'local-account', currentGamePos: 16, currentParentEntityID: 'top', cardSourceID: 'tool-one' }],
        appliedStatusEffects: capturedConditions,
      },
      stadium: null,
    },
  },
};

const assembler = new LiveReviewAssembler(catalog);
const setupReview = assembler.ingest(fullBoard);
assert.ok(setupReview);
assert.equal(setupReview.turns[0].label, 'Capture baseline');
const setup = setupReview.turns[0].canonical;
assert.ok(setup);
assert.equal(setup.localPlayerIndex, 1);
assert.equal(setup.state.players[0].deck.length, 3);
assert.equal(setup.state.players[0].hand.length, 2);
assert.ok(setup.state.players[0].hand.every((card) => setup.visibility[card.id] === 'hidden'));
assert.equal(setup.state.players[1].hand[0].name, 'Ultra Ball');
assert.equal(setup.visibility[setup.state.players[1].hand[0].id], 'known');
assert.equal(setup.state.players[1].active?.card.name, 'Dragapult ex');
assert.equal(setup.state.players[1].active?.currentHp, 280);
assert.equal(setup.state.players[1].active?.previousStage?.card.name, 'Drakloak');
assert.deepEqual(setup.state.players[1].active?.attachedEnergy.map((card) => card.name), ['Basic Psychic Energy']);
assert.deepEqual(setup.state.players[1].active?.attachedTools.map((card) => card.name), ['Maximum Belt']);
assert.equal(setup.state.players[1].active?.attachedTools[0]?.trainerType, TrainerType.Tool);
assert.deepEqual(setup.state.players[1].active?.statusConditions, ['Poisoned', 'Burned', 'Paralyzed', 'Confused', 'Asleep']);
assert.deepEqual(setupReview.turns[0].snapshot.players.Isaiah.active?.statusConditions, ['Poisoned', 'Burned', 'Paralyzed', 'Confused', 'Asleep']);
assert.equal(setup.appliedEffects.top[0].name, 'Subjugating Chains');
assert.equal(setup.appliedEffects.top[0].effectType, 'SpecialConditionEffect');
assert.equal(setup.state.players[1].active?.card.cardType, CardType.Pokemon);

const checkupAssembler = new LiveReviewAssembler(catalog);
checkupAssembler.ingest({
  ...base,
  receivedAt: 'checkup-rules',
  operationId: 'checkup-rules',
  messageIndex: 1,
  messageType: 8,
  operation: {
    gameActions: [
      { actionGuid: 'handle-poison-guid', actionName: 'Handle poison' },
      { actionGuid: 'handle-burn-guid', actionName: 'Handle burn' },
    ],
  },
});
checkupAssembler.ingest({ ...fullBoard, receivedAt: 'checkup-board', messageIndex: 2 });
const poisonCheckupReview = checkupAssembler.ingest({
  ...base,
  receivedAt: 'checkup-damage',
  operationId: 'poison-checkup',
  messageIndex: 3,
  operation: {
    operationNumber: 2,
    actionModifications: [{
      $type: 'MatchLogic.EndTurnModification, MatchLogic',
      actionModificationID: 'end-turn-before-checkup',
    }, {
      $type: 'MatchLogic.MoveDCModification, MatchLogic',
      actionModificationID: 'poison-damage-counters',
      actionGUID: 'handle-poison-guid',
      isFinal: true,
      modifiedDCEntities: [{ cardAddress: { entityID: 'top', pos: 16 }, previousDC: 4, newDC: 5 }],
    }, {
      $type: 'MatchLogic.MoveDCModification, MatchLogic',
      actionModificationID: 'burn-damage-counters',
      actionGUID: 'handle-burn-guid',
      isFinal: true,
      modifiedDCEntities: [{ cardAddress: { entityID: 'top', pos: 16 }, previousDC: 5, newDC: 7 }],
    }],
    updatedEntities: [{
      entityID: 'top', ownerPlayerId: 'local-account', currentGamePos: 16,
      cardSourceID: 'top-mon', damageCounters: 7, appliedStatusEffects: capturedConditions,
    }],
  },
});
const poisonCheckupTurn = poisonCheckupReview?.turns.at(-1);
assert.equal(poisonCheckupTurn?.snapshot.players.Isaiah.active?.damage, 70, 'between-turn Poison and Burn must update the visible board damage');
assert.equal(poisonCheckupTurn?.canonical?.state.players[1].active?.damageCounters, 7, 'between-turn conditions must update canonical damage counters');
assert.match(poisonCheckupTurn?.events.find((event) => /Poison between turns/.test(event.text))?.text || '', /Dragapult ex took 10 damage from Poison between turns/);
assert.match(poisonCheckupTurn?.events.find((event) => /Burn between turns/.test(event.text))?.text || '', /Dragapult ex took 20 damage from Burn between turns/);
assert.ok(poisonCheckupTurn?.events[0].facts?.some((fact) => fact.label === 'Damage counters' && fact.value === 'Dragapult ex: 40 → 50 damage'));
assert.ok(poisonCheckupTurn?.events[0].facts?.some((fact) => fact.label === 'Damage counters' && fact.value === 'Dragapult ex: 50 → 70 damage'));

const knockoutCheckupAssembler = new LiveReviewAssembler(catalog);
knockoutCheckupAssembler.ingest({
  ...base,
  receivedAt: 'knockout-checkup-rules',
  operationId: 'knockout-checkup-rules',
  messageIndex: 4,
  messageType: 8,
  operation: { gameActions: [{ actionGuid: 'handle-poison-guid', actionName: 'Handle poison' }] },
});
const knockoutBoard = structuredClone(fullBoard);
knockoutBoard.receivedAt = 'knockout-checkup-board';
knockoutBoard.messageIndex = 5;
const knockoutMatchBoard = (knockoutBoard.operation as { matchBoard: Record<string, unknown> }).matchBoard;
knockoutMatchBoard.p1Active = {
  entityID: 'knockout-target', ownerPlayerId: 'opponent-account', isPlayer1: true,
  currentGamePos: 15, cardSourceID: 'option-a', damageCounters: 0,
  battleFlagCounts: { CardEntityTimesKnockedOut: 0 },
};
knockoutCheckupAssembler.ingest(knockoutBoard);
const knockoutCheckupReview = knockoutCheckupAssembler.ingest({
  ...base,
  receivedAt: 'knockout-checkup-damage',
  operationId: 'attack-with-poison-checkup',
  messageIndex: 6,
  operation: {
    operationNumber: 3,
    playerOperation: { operationType: 1, accountID: 'local-account', originEntityID: 'top' },
    actionModifications: [{
      $type: 'MatchLogic.ApplyDamageModification, MatchLogic',
      actionModificationID: 'knockout-attack-damage',
      isFinal: true,
      appliedDamageDeltas: [{ cardAddress: { entityID: 'knockout-target', pos: 15 }, damageAmount: 70 }],
    }, {
      $type: 'MatchLogic.EndTurnModification, MatchLogic',
      actionModificationID: 'knockout-end-turn',
    }, {
      $type: 'MatchLogic.MoveDCModification, MatchLogic',
      actionModificationID: 'knockout-poison-damage',
      actionGUID: 'handle-poison-guid',
      isFinal: true,
      modifiedDCEntities: [{ cardAddress: { entityID: 'top', pos: 16 }, previousDC: 4, newDC: 5 }],
    }],
    updatedEntities: [{
      entityID: 'top', ownerPlayerId: 'local-account', currentGamePos: 16,
      cardSourceID: 'top-mon', damageCounters: 5, appliedStatusEffects: capturedConditions,
    }, {
      entityID: 'knockout-target', ownerPlayerId: 'opponent-account', isPlayer1: true,
      previousGamePos: 15, currentGamePos: 9, cardSourceID: 'option-a', damageCounters: 7,
      battleFlagCounts: { CardEntityTimesKnockedOut: 1 },
    }],
  },
});
const knockoutCheckupTurn = knockoutCheckupReview?.turns.at(-1);
assert.equal(knockoutCheckupTurn?.snapshot.players.Isaiah.active?.damage, 50, 'the staged KO frame must not roll back Poison damage on a surviving Pokémon');
assert.equal(knockoutCheckupTurn?.snapshot.players.Opponent.active?.id, 'knockout-target', 'the defeated Pokémon must remain staged for the KO frame');
assert.match(knockoutCheckupTurn?.events.find((event) => event.id.includes(':condition-damage:'))?.text || '', /10 damage from Poison between turns/);

const search: CapturedOperation = {
  ...base,
  receivedAt: '2.000Z',
  operationId: 'search-operation',
  messageIndex: 11,
  operation: {
    cardEntities: [
      { entityID: 'deck-a', ownerPlayerId: 'local-account', currentGamePos: 8, cardSourceID: 'option-a' },
      { entityID: 'deck-b', ownerPlayerId: 'local-account', currentGamePos: 8, cardSourceID: 'option-b' },
      { entityID: 'deck-c', ownerPlayerId: 'local-account', currentGamePos: 8, cardSourceID: 'option-c' },
    ],
    playerSelection: {
      selectionID: 'selection-1', originCardEntityID: 'search-card', selectingPlayerID: 'local-account',
      variableSelection: {
        $type: 'MatchLogic.EntitySelection, MatchLogic', selectionMethod: 1, subActionType: 5,
        allOptions: [{ entityID: 'deck-a', pos: 8 }, { entityID: 'deck-b', pos: 8 }, { entityID: 'deck-c', pos: 8 }],
        allValidOptions: [{ entityID: 'deck-a', pos: 8 }, { entityID: 'deck-b', pos: 8 }],
        selectionGroups: [{ minAmount: 0, maxAmount: 1, validOptions: [{ cardAddress: { entityID: 'deck-a', pos: 8 } }, { cardAddress: { entityID: 'deck-b', pos: 8 } }] }],
        totalMinAmount: 0, totalMaxAmount: 1,
      },
    },
  },
};
const selectionReview = assembler.ingest(search);
assert.ok(selectionReview);
assert.equal(selectionReview.turns.length, 2);
let selection = selectionReview.turns[1].canonical?.selection;
assert.ok(selection);
assert.deepEqual(selection.optionCards.map((card) => card.name), ['Dreepy', 'Munkidori', 'Iono']);
assert.deepEqual(selection.eligibleOptionIds, ['deck-a', 'deck-b']);
assert.equal(selection.completed, false);
const revealedDeck = selectionReview.turns[1].canonical?.state.players[1].deck || [];
assert.equal(revealedDeck.length, 4, 'revealed identities must replace anonymous slots without changing the deck count');
assert.deepEqual(selectionReview.turns[1].choiceCards?.map((card) => card.name), ['Ultra Ball']);
assert.deepEqual(selectionReview.turns[1].choiceCards?.map((card) => card.choiceRole), ['action']);
assert.deepEqual(
  revealedDeck.filter((card) => card.name !== 'Hidden card').map((card) => card.name).sort(),
  ['Dreepy', 'Iono', 'Munkidori'],
  'a deck search must promote every revealed identity into persistent deck knowledge',
);

const resolvedReview = assembler.ingest({
  ...base,
  receivedAt: '3.000Z',
  operationId: 'search-operation',
  messageIndex: 12,
  operation: {
    completedSelections: ['selection-1'],
    actionModifications: [{
      $type: 'MatchLogic.MoveCardsModification, MatchLogic',
      actionModificationID: 'search-choice-move',
      moveCardDeltas: [{
        fromCardAddress: { entityID: 'deck-b', pos: 8 },
        toCardAddress: { entityID: 'deck-b', pos: 12 },
      }],
    }],
    updatedEntities: [{ entityID: 'deck-b', ownerPlayerId: 'local-account', cardSourceID: 'option-b', previousGamePos: 8, currentGamePos: 12 }],
  },
});
assert.ok(resolvedReview);
selection = resolvedReview.turns[1].canonical?.selection;
assert.ok(selection);
assert.equal(selection.completed, true);
assert.deepEqual(selection.selectedOptionIds, ['deck-b']);
assert.equal(resolvedReview.turns[1].canonical?.state.players[1].deck.length, 3);
assert.deepEqual(resolvedReview.turns[1].choiceCards?.map((card) => card.name), ['Ultra Ball', 'Munkidori']);
assert.deepEqual(resolvedReview.turns[1].choiceCards?.map((card) => card.choiceRole), ['action', 'chosen']);
assert.equal(resolvedReview.turns[1].choiceLabel, 'Chose Munkidori with Ultra Ball');
assert.match(resolvedReview.turns[1].events.find((event) => event.id.includes(':selection:'))?.text || '', /chose Munkidori with Ultra Ball/);
assert.deepEqual(
  resolvedReview.turns[1].canonical?.state.players[1].deck.filter((card) => card.name !== 'Hidden card').map((card) => card.name).sort(),
  ['Dreepy', 'Iono'],
  'known deck identities must follow the selected card into its destination zone',
);
assert.equal(resolvedReview.turns[1].canonical?.state.players[1].hand.at(-1)?.name, 'Munkidori');

const movementOnlyAssembler = new LiveReviewAssembler(catalog);
movementOnlyAssembler.ingest(fullBoard);
movementOnlyAssembler.ingest(search);
const movementOnlyReview = movementOnlyAssembler.ingest({
  ...base,
  receivedAt: '3.100Z',
  operationId: 'search-operation',
  messageIndex: 121,
  operation: {
    completedSelections: ['selection-1'],
    actionModifications: [{
      $type: 'MatchLogic.MoveCardsModification, MatchLogic',
      actionModificationID: 'search-choice-without-entity-update',
      moveCardDeltas: [{
        fromCardAddress: { entityID: 'deck-a', pos: 8 },
        toCardAddress: { entityID: 'deck-a', pos: 12 },
      }],
    }],
  },
});
const movementOnlySelection = movementOnlyReview?.turns[1].canonical?.selection;
assert.deepEqual(movementOnlySelection?.selectedOptionIds, ['deck-a'], 'an exact card move must resolve a search even when updatedEntities omits the chosen card');
assert.match(movementOnlyReview?.turns[1].events.find((event) => event.id.includes(':selection:'))?.text || '', /chose Dreepy with Ultra Ball/);
assert.equal(movementOnlyReview?.turns[1].events.find((event) => event.id.includes(':selection:'))?.cardId, 'searcher');

const staleCandidateAssembler = new LiveReviewAssembler(catalog);
staleCandidateAssembler.ingest({
  ...fullBoard,
  operationId: 'dedenne-board-state',
  operation: {
    matchBoard: {
      ...(fullBoard.operation as { matchBoard: Record<string, unknown> }).matchBoard,
      p2Bench: [{ entityID: 'dedenne', ownerPlayerId: 'local-account', currentGamePos: 14, cardSourceID: 'dedenne-card' }],
    },
  },
});
const staleCandidatePrompt = staleCandidateAssembler.ingest({
  ...base,
  receivedAt: '3.150Z',
  operationId: 'dedenne-selection-operation',
  messageIndex: 122,
  operation: {
    playerOperation: { operationType: 1, accountID: 'local-account', originEntityID: 'dedenne' },
    cardEntities: [
      { entityID: 'dawn', ownerPlayerId: 'local-account', cardSourceID: 'dawn-card', previousGamePos: 12, currentGamePos: 10 },
      { entityID: 'poke-pad-a', ownerPlayerId: 'local-account', cardSourceID: 'poke-pad-card', previousGamePos: 12, currentGamePos: 10 },
      { entityID: 'poke-pad-b', ownerPlayerId: 'local-account', cardSourceID: 'poke-pad-card', previousGamePos: 10, currentGamePos: 10 },
    ],
    playerSelection: {
      selectionID: 'dedenne-selection', originCardEntityID: 'dedenne', selectingPlayerID: 'local-account',
      variableSelection: {
        $type: 'MatchLogic.EntitySelection, MatchLogic', selectionMethod: 1, subActionType: 5,
        allOptions: [{ entityID: 'dawn', pos: 10 }, { entityID: 'poke-pad-a', pos: 10 }, { entityID: 'poke-pad-b', pos: 10 }],
        allValidOptions: [{ entityID: 'dawn', pos: 10 }, { entityID: 'poke-pad-a', pos: 10 }, { entityID: 'poke-pad-b', pos: 10 }],
        selectionGroups: [{ minAmount: 1, maxAmount: 1, validOptions: [{ cardAddress: { entityID: 'dawn', pos: 10 } }, { cardAddress: { entityID: 'poke-pad-a', pos: 10 } }, { cardAddress: { entityID: 'poke-pad-b', pos: 10 } }] }],
        totalMinAmount: 1, totalMaxAmount: 1,
      },
    },
  },
});
assert.deepEqual(
  staleCandidatePrompt?.turns[1].canonical?.selection?.selectedOptionIds,
  [],
  'stale previousGamePos values in the candidate snapshot must not resolve a pending choice',
);
const staleCandidateResolved = staleCandidateAssembler.ingest({
  ...base,
  receivedAt: '3.160Z',
  operationId: 'dedenne-selection-operation',
  messageIndex: 123,
  operation: {
    completedSelections: ['dedenne-selection'],
    actionModifications: [{
      $type: 'MatchLogic.MoveCardsModification, MatchLogic',
      actionModificationID: 'dedenne-choice-move',
      moveCardDeltas: [{
        fromCardAddress: { entityID: 'poke-pad-b', pos: 10 },
        toCardAddress: { entityID: 'poke-pad-b', pos: 12 },
      }],
    }],
    updatedEntities: [
      { entityID: 'dawn', ownerPlayerId: 'local-account', cardSourceID: 'dawn-card', previousGamePos: 12, currentGamePos: 10 },
      { entityID: 'poke-pad-a', ownerPlayerId: 'local-account', cardSourceID: 'poke-pad-card', previousGamePos: 12, currentGamePos: 10 },
      { entityID: 'poke-pad-b', ownerPlayerId: 'local-account', cardSourceID: 'poke-pad-card', previousGamePos: 10, currentGamePos: 12 },
    ],
  },
});
const staleCandidateSelection = staleCandidateResolved?.turns[1].canonical?.selection;
assert.equal(staleCandidateSelection?.maximum, 1);
assert.deepEqual(staleCandidateSelection?.selectedOptionIds, ['poke-pad-b']);
assert.deepEqual(staleCandidateResolved?.turns[1].choiceCards?.map((card) => card.name), ['Dedenne', 'Poké Pad']);
assert.match(staleCandidateResolved?.turns[1].events.find((event) => event.id.includes(':selection:'))?.text || '', /chose Poké Pad with Dedenne/);
assert.doesNotMatch(staleCandidateResolved?.turns[1].events.find((event) => event.id.includes(':selection:'))?.text || '', /Dawn/);

const privateSelectionAssembler = new LiveReviewAssembler(catalog);
privateSelectionAssembler.ingest({
  ...fullBoard,
  operationId: 'private-stadium-seed',
  messageIndex: 130,
  operation: {
    matchBoard: {
      ...(fullBoard.operation as { matchBoard: Record<string, unknown> }).matchBoard,
      stadium: { entityID: 'stadium-card', ownerPlayerId: 'local-account', currentGamePos: 2, cardSourceID: 'stadium-searcher' },
    },
  },
});
privateSelectionAssembler.ingest({
  ...base,
  receivedAt: '3.200Z',
  operationId: 'private-stadium-effect',
  messageIndex: 131,
  operation: {
    operationNumber: 3,
    playerOperation: { operationType: 1, accountID: 'local-account', originEntityID: 'stadium-card' },
    actionModifications: [],
  },
});
privateSelectionAssembler.ingest({
  ...base,
  receivedAt: '3.300Z',
  operationId: 'private-stadium-effect',
  messageIndex: 132,
  operation: {
    selectionID: 'private-selection-1',
    originCardEntityID: 'stadium-card',
    selectingPlayerID: 'local-account',
    selectionMethod: 1,
    variableSelectionSettings: {
      $type: 'MatchLogic.EntitySelectionSettings, MatchLogic',
      plLocID: 'optional_move_number',
      maxSelectionAmount: { value1: { explicitValue: 1 } },
      selectionGroupSettings: [{ maxSelectionAmount: { value1: { explicitValue: 1 } } }],
    },
  },
});
const privateSelectionReview = privateSelectionAssembler.ingest({
  ...base,
  receivedAt: '3.400Z',
  operationId: 'private-stadium-effect',
  messageIndex: 133,
  operation: {
    operationNumber: 3,
    playerOperation: { operationType: 1, accountID: 'local-account', originEntityID: 'stadium-card' },
    completedSelections: ['private-selection-1'],
    actionModifications: [{
      $type: 'MatchLogic.MoveCardsModification, MatchLogic',
      actionModificationID: 'private-stadium-result',
      moveCardDeltas: [{
        fromCardAddress: { entityID: 'private-result' },
        toCardAddress: { entityID: 'private-result', pos: 12 },
      }],
    }, {
      $type: 'MatchLogic.ShuffleCardsModification, MatchLogic',
      actionModificationID: 'private-stadium-shuffle',
    }],
    updatedEntities: [{
      entityID: 'private-result', ownerPlayerId: 'local-account', cardSourceID: 'marnie-result',
      previousGamePos: 8, currentGamePos: 12,
    }],
  },
});
const privateTurn = privateSelectionReview?.turns.at(-1);
const privateSelection = privateTurn?.canonical?.selection;
assert.equal(privateSelection?.candidateVisibility, 'private');
assert.equal(privateSelection?.completed, true);
assert.deepEqual(privateSelection?.selectedOptionIds, ['private-result']);
assert.deepEqual(privateSelection?.optionCards.map((card) => card.name), ["Marnie's Impidimp"]);
assert.match(privateTurn?.events.find((event) => event.id.includes(':selection:'))?.text || '', /chose Marnie's Impidimp with Spikemuth Gym/);
assert.deepEqual(privateTurn?.choiceCards?.map((card) => [card.choiceRole, card.name]), [['action', 'Spikemuth Gym'], ['chosen', "Marnie's Impidimp"]]);
assert.ok(privateTurn?.events[0].facts?.some((fact) => fact.label === 'Card moved' && /Marnie's Impidimp: Isaiah's Deck → Isaiah's Hand/.test(fact.value)));
assert.ok(privateTurn?.events[0].facts?.some((fact) => fact.label === 'Shuffled' && fact.value === "Isaiah's Deck"));
assert.ok(privateTurn?.events[0].facts?.some((fact) => fact.label === 'Selection' && fact.value === '1 chosen · candidate list private'));

const hiddenDrawReview = assembler.ingest({
  ...base,
  receivedAt: '4.000Z',
  operationId: 'hidden-draw-operation',
  messageIndex: 13,
  operation: {
    actionModifications: [{
      $type: 'MatchLogic.MoveCardsModification, MatchLogic',
      actionModificationID: 'private-opponent-draw',
      moveCardDeltas: [{ fromCardAddress: {}, toCardAddress: { pos: 11 } }],
    }],
  },
});
assert.ok(hiddenDrawReview);
const hiddenDraw = hiddenDrawReview.turns.at(-1)?.canonical;
assert.ok(hiddenDraw);
assert.equal(hiddenDraw.state.players[0].deck.length, 2, 'a redacted private draw must still decrement the correct deck');
assert.equal(hiddenDraw.state.players[0].hand.length, 3, 'a redacted private draw must still increment the correct hand');
assert.ok(hiddenDraw.state.players[0].hand.every((card) => hiddenDraw.visibility[card.id] === 'hidden'));

const reusedMessageIndex = new LiveReviewAssembler(catalog);
reusedMessageIndex.ingest({
  ...fullBoard,
  receivedAt: 'index-reuse-request',
  operation: {
    operationNumber: 1,
    playerOperation: { operationType: 1, accountID: 'local-account' },
    updatedEntities: [
      { entityID: 'player-1', ownerPlayerId: 'opponent-account', currentGamePos: 3, isPlayer1: true, userName: 'Opponent' },
      { entityID: 'player-2', ownerPlayerId: 'local-account', currentGamePos: 4, isPlayer1: false, userName: 'Isaiah' },
    ],
  },
});
const reusedIndexReview = reusedMessageIndex.ingest({ ...fullBoard, receivedAt: 'index-reuse-board-response' });
const reusedIndexState = reusedIndexReview?.turns.at(-1)?.canonical;
assert.ok(reusedIndexState);
assert.equal(reusedIndexState.state.players[0].hand.length, 2, 'a full-board response sharing the request message index must still be ingested');
assert.ok(reusedIndexState.state.players[0].hand.every((card) => reusedIndexState.visibility[card.id] === 'hidden'));
assert.equal(reusedIndexState.state.players[1].hand[0].name, 'Ultra Ball');
const beforeRepeatedBoard = JSON.stringify(reusedIndexReview);
assert.equal(JSON.stringify(reusedMessageIndex.ingest({ ...fullBoard, receivedAt: 'duplicate-board-delivery' })), beforeRepeatedBoard, 'an exact board payload repeated later must stay idempotent');

const localHandCounts = new LiveReviewAssembler(catalog);
localHandCounts.ingest(fullBoard);
const duplicatedMovePhase = (id: string) => ({
  $type: 'MatchLogic.MoveCardsModification, MatchLogic',
  actionModificationID: id,
  moveCardDeltas: [{ fromCardAddress: { entityID: 'draw-source', pos: 8 }, toCardAddress: { entityID: 'drawn-local-card', pos: 12 } }],
});
const localHandCountReview = localHandCounts.ingest({
  ...base,
  receivedAt: 'repeated-move-phases',
  operationId: 'repeated-move-operation',
  messageIndex: 14,
  operation: {
    operationNumber: 2,
    actionModifications: [duplicatedMovePhase('move-preview'), duplicatedMovePhase('move-final')],
    updatedEntities: [{ entityID: 'drawn-local-card', ownerPlayerId: 'local-account', previousGamePos: 8, currentGamePos: 12, cardSourceID: 'option-a' }],
  },
});
const exactLocalHand = localHandCountReview?.turns.at(-1)?.canonical?.state.players[1].hand;
assert.equal(exactLocalHand?.length, 2, 'repeated inferred movement phases must not create hidden cards in the local hand');
assert.ok(exactLocalHand?.every((card) => card.name !== 'Hidden card'));

console.log('canonical-review: full board, privacy, attachments, and exact deck-search replay reconstructed successfully');

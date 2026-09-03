import assert from 'node:assert/strict';
import { cardSourceIdFromReviewCard } from '../card-adapter.js';
import { LiveReviewAssembler } from '../live-operation-reducer.js';
import type { CapturedOperation, CardInfo } from '../types.js';

const catalog = new Map<string, CardInfo>([
  ['sv-test-1', { id: 'sv-test-1', name: 'Dragapult ex', hp: 320, cardType: 'P', imageDataUrl: 'data:image/png;base64,test' }],
  ['sv-test-2', { id: 'sv-test-2', name: 'Munkidori', hp: 110, cardType: 'D' }],
  ['sv-test-3', { id: 'sv-test-3', name: "Marnie's Grimmsnarl ex", hp: 320, cardType: 'D', category: 1 }],
  ['sv-energy', { id: 'sv-energy', name: 'Basic Darkness Energy', cardType: 'D', category: 3 }],
  ['sv-hammer', { id: 'sv-hammer', name: 'Crushing Hammer', category: 2, format: 'I' }],
  ['sv-stamp', { id: 'sv-stamp', name: 'Unfair Stamp', category: 2, format: 'I' }],
  ['sv-tool', { id: 'sv-tool', name: 'Handheld Fan', category: 2, format: 'T' }],
  ['sv-lucky-helmet', { id: 'sv-lucky-helmet', name: 'Lucky Helmet', category: 2, format: 'T', rulesText: 'If the Pokémon this card is attached to is damaged by an attack, draw 2 cards.' }],
  ['sv-honchkrow', { id: 'sv-honchkrow', name: "Team Rocket's Honchkrow", hp: 130, cardType: 'D', category: 1 }],
  ['sv-stadium', { id: 'sv-stadium', name: 'Spikemuth Gym', category: 2, format: '=A', rulesText: "Search your deck for a Marnie's Pokémon." }],
  ['sv-dreepy', { id: 'sv-dreepy', name: 'Dreepy', hp: 70, cardType: 'P', category: 1 }],
]);

const operation: CapturedOperation = {
  receivedAt: '1.000Z',
  socketHost: 'api.us-east-1.studio-prod.pokemon.com',
  globalMessageType: 'PlayerMessage',
  gameId: 'game-1',
  messageType: 1,
  matchId: 'match-1',
  accountId: 'player-1',
  operationId: 'operation-1',
  messageIndex: 1,
  operation: {
    operationNumber: 1,
    playerOperation: { operationType: 2, accountID: 'player-1', originEntityID: 'card-active' },
    updatedEntities: [
      { entityID: 'player-entity-1', ownerPlayerId: 'player-1', currentPos: 3, isPlayer1: true, userName: 'Isaiah' },
      { entityID: 'player-entity-2', ownerPlayerId: 'player-2', currentPos: 4, isPlayer1: false, userName: 'Opponent' },
      { entityID: 'card-active', ownerPlayerId: 'player-1', currentGamePos: 15, mainFragmentCard: true, damageCounters: 3, cardSourceID: 'sv-test-1', attachedEnergy: [{ entityID: 'attached-energy' }] },
      { entityID: 'attached-energy', ownerPlayerId: 'player-1', currentGamePos: 15, currentParentEntityID: 'card-active', cardSourceID: 'sv-energy' },
      { entityID: 'card-bench', ownerPlayerId: 'player-2', currentGamePos: 14, mainFragmentCard: true, cardSourceID: 'sv-test-2' },
      ...Array.from({ length: 6 }, (_, index) => ({ entityID: `prize-${index}`, ownerPlayerId: 'player-1', currentGamePos: 19, cardSourceID: `hidden-${index}` })),
    ],
  },
};

const review = new LiveReviewAssembler(catalog).ingest(operation);
assert.ok(review);
assert.equal(review.source, 'live-network');
assert.equal(review.localPlayer, 'Isaiah');
assert.equal(review.opponent, 'Opponent');
assert.equal(review.turns.length, 2);
assert.equal(review.turns[1].snapshot.players.Isaiah.active?.name, 'Dragapult ex');
assert.equal(review.turns[1].snapshot.players.Isaiah.active?.damage, 30);
assert.equal(review.turns[1].snapshot.players.Isaiah.active?.maxHp, 320);
assert.equal(review.turns[1].snapshot.players.Isaiah.active?.cardId, 'sv-test-1');
assert.deepEqual(review.turns[1].snapshot.players.Isaiah.active?.energies, ['Basic Darkness Energy']);
assert.equal(review.turns[1].canonical?.state.players[0].active?.card.name, 'Dragapult ex');
assert.equal(review.turns[1].canonical?.state.players[0].active?.card.imageUrl, '');
assert.deepEqual(review.turns[1].canonical?.state.players[0].active?.attachedEnergy.map((card) => card.name), ['Basic Darkness Energy']);
assert.equal(review.turns[1].snapshot.players.Opponent.bench[0]?.name, 'Munkidori');
assert.match(review.turns[1].events[0].text, /placed Dragapult ex/);

const lateCatalogReview = new LiveReviewAssembler(new Map()).ingest({
  ...operation,
  operationId: 'late-catalog-board',
  messageIndex: 2,
  operation: {
    matchBoard: {
      player1: { entityID: 'late-player-1', ownerPlayerId: 'player-1', currentPos: 3, isPlayer1: true, userName: 'Isaiah' },
      player2: { entityID: 'late-player-2', ownerPlayerId: 'player-2', currentPos: 4, isPlayer1: false, userName: 'Opponent' },
      p1Deck: [], p2Deck: [], p1Hand: [], p2Hand: [], p1Discard: [],
      p2Discard: [{ entityID: 'late-boss', ownerPlayerId: 'player-2', currentGamePos: 10, cardSourceID: 'sv2_248' }],
      p1LostZone: [], p2LostZone: [], p1Prize: [], p2Prize: [], p1Bench: [], p2Bench: [],
      p1Active: null, p2Active: null,
    },
  },
});
const lateCatalogCard = lateCatalogReview?.turns.at(-1)?.canonical?.state.players
  .flatMap((player) => player.discard)
  .find((card) => card.id === 'late-boss');
assert.ok(lateCatalogCard);
assert.equal(lateCatalogCard.name, 'sv2_248');
assert.equal(cardSourceIdFromReviewCard(lateCatalogCard), 'sv2_248', 'replay reconstruction must retain unresolved source IDs');

const toolAssembler = new LiveReviewAssembler(catalog);
toolAssembler.ingest({
  ...operation,
  operationId: 'tool-seed',
  messageIndex: 10,
  operation: {
    updatedEntities: [
      { entityID: 'tool-player-1', ownerPlayerId: 'player-1', currentPos: 3, isPlayer1: true, userName: 'Isaiah' },
      { entityID: 'tool-player-2', ownerPlayerId: 'player-2', currentPos: 4, isPlayer1: false, userName: 'Opponent' },
      { entityID: 'tool-target', ownerPlayerId: 'player-1', currentGamePos: 15, cardSourceID: 'sv-test-1' },
      { entityID: 'tool-card', ownerPlayerId: 'player-1', currentGamePos: 11, cardSourceID: 'sv-tool' },
    ],
  },
});
const toolReview = toolAssembler.ingest({
  ...operation,
  operationId: 'tool-attach',
  messageIndex: 11,
  operation: {
    operationNumber: 2,
    playerOperation: { operationType: 4, accountID: 'player-1', originEntityID: 'tool-card', targetID: 'tool-target' },
    updatedEntities: [
      { entityID: 'tool-target', ownerPlayerId: 'player-1', currentGamePos: 15, cardSourceID: 'sv-test-1', attachedTools: [{ entityID: 'tool-card', ownerPlayerId: 'player-1', currentGamePos: 15, currentParentEntityID: 'tool-target', cardSourceID: 'sv-tool' }] },
      { entityID: 'tool-card', ownerPlayerId: 'player-1', currentGamePos: 15, currentParentEntityID: 'tool-target', cardSourceID: 'sv-tool' },
    ],
  },
});
assert.equal(toolReview?.turns[1].events[0].kind, 'tool');
assert.match(toolReview?.turns[1].events[0].text || '', /attached Handheld Fan to Dragapult ex/);
assert.equal(toolReview?.turns[1].choiceLabel, 'Attached a Pokémon Tool');
assert.deepEqual(toolReview?.turns[1].snapshot.players.Isaiah.active?.toolCards?.map((card) => card.name), ['Handheld Fan']);
assert.deepEqual(toolReview?.turns[1].canonical?.state.players[0].active?.attachedTools.map((card) => card.name), ['Handheld Fan']);

const stadiumAssembler = new LiveReviewAssembler(catalog);
stadiumAssembler.ingest({
  ...operation,
  operationId: 'stadium-seed',
  messageIndex: 12,
  operation: {
    updatedEntities: [
      { entityID: 'stadium-player-1', ownerPlayerId: 'player-1', currentPos: 3, isPlayer1: true, userName: 'Isaiah' },
      { entityID: 'stadium-player-2', ownerPlayerId: 'player-2', currentPos: 4, isPlayer1: false, userName: 'Opponent' },
      { entityID: 'stadium-card', ownerPlayerId: 'player-1', currentGamePos: 11, cardSourceID: 'sv-stadium' },
    ],
  },
});
const stadiumReview = stadiumAssembler.ingest({
  ...operation,
  operationId: 'stadium-play',
  messageIndex: 13,
  operation: {
    operationNumber: 3,
    playerOperation: { accountID: 'player-1', originEntityID: 'stadium-card' },
    actionModifications: [{
      $type: 'MatchLogic.MoveCardsModification, MatchLogic',
      actionModificationID: 'stadium-to-board',
      moveCardDeltas: [{
        fromCardAddress: { entityID: 'stadium-card', pos: 11 },
        toCardAddress: { entityID: 'stadium-card', pos: 2 },
      }],
    }],
    updatedEntities: [{ entityID: 'stadium-card', ownerPlayerId: 'player-1', previousGamePos: 11, currentGamePos: 2, cardSourceID: 'sv-stadium' }],
  },
});
assert.equal(stadiumReview?.turns[1].events[0].kind, 'stadium');
assert.match(stadiumReview?.turns[1].events[0].text || '', /played Spikemuth Gym/);

const benchAssembler = new LiveReviewAssembler(catalog);
benchAssembler.ingest({
  ...operation,
  operationId: 'bench-seed',
  messageIndex: 14,
  operation: {
    updatedEntities: [
      { entityID: 'bench-player-1', ownerPlayerId: 'player-1', currentPos: 3, isPlayer1: true, userName: 'Isaiah' },
      { entityID: 'bench-player-2', ownerPlayerId: 'player-2', currentPos: 4, isPlayer1: false, userName: 'Opponent' },
      { entityID: 'bench-dreepy', ownerPlayerId: 'player-1', currentGamePos: 11, mainFragmentCard: true, cardSourceID: 'sv-dreepy' },
    ],
  },
});
const benchReview = benchAssembler.ingest({
  ...operation,
  operationId: 'bench-dreepy',
  messageIndex: 15,
  operation: {
    operationNumber: 4,
    playerOperation: { operationType: 1, accountID: 'player-1', originEntityID: 'bench-dreepy' },
    actionModifications: [{
      $type: 'MatchLogic.MoveCardsModification, MatchLogic',
      actionModificationID: 'dreepy-to-bench',
      moveCardDeltas: [{
        fromCardAddress: { entityID: 'bench-dreepy', pos: 11 },
        toCardAddress: { entityID: 'bench-dreepy', pos: 13 },
      }],
    }],
    updatedEntities: [{
      entityID: 'bench-dreepy',
      ownerPlayerId: 'player-1',
      previousGamePos: 11,
      currentGamePos: 13,
      mainFragmentCard: true,
      cardSourceID: 'sv-dreepy',
    }],
  },
});
assert.equal(benchReview?.turns[1].events[0].text, 'Isaiah: Benched Dreepy');
assert.equal(benchReview?.turns[1].choiceLabel, 'Benched Dreepy');
assert.equal(benchReview?.turns[1].snapshot.players.Isaiah.bench[0]?.name, 'Dreepy');

const discardAttachAssembler = new LiveReviewAssembler(catalog);
discardAttachAssembler.ingest({
  ...operation,
  operationId: 'discard-attach-seed',
  messageIndex: 16,
  operation: {
    matchBoard: {
      player1: { entityID: 'discard-player-1', ownerPlayerId: 'player-1', currentPos: 3, isPlayer1: true, userName: 'Isaiah' },
      player2: { entityID: 'discard-player-2', ownerPlayerId: 'player-2', currentPos: 4, isPlayer1: false, userName: 'Opponent' },
      p1Deck: [], p2Deck: [], p1Hand: [], p2Hand: [], p1Discard: [],
      p2Discard: [
        { entityID: 'discard-energy-a', ownerPlayerId: 'player-2', currentGamePos: 10, cardSourceID: 'sv-energy' },
        { entityID: 'discard-energy-b', ownerPlayerId: 'player-2', currentGamePos: 10, cardSourceID: 'sv-energy' },
      ],
      p1LostZone: [], p2LostZone: [], p1Prize: [], p2Prize: [], p1Bench: [], p2Bench: [],
      p1Active: null,
      p2Active: { entityID: 'discard-target', ownerPlayerId: 'player-2', currentGamePos: 16, cardSourceID: 'sv-test-1' },
    },
  },
});
const discardAttachReview = discardAttachAssembler.ingest({
  ...operation,
  operationId: 'discard-attach-resolution',
  messageIndex: 17,
  operation: {
    operationNumber: 5,
    playerOperation: { operationType: 1, accountID: 'player-2', originEntityID: 'discard-target' },
    actionModifications: [{
      $type: 'MatchLogic.AttachCardsModification, MatchLogic',
      actionModificationID: 'attach-from-discard',
      attachCardDeltas: [{
        fromCardAddress: { entityID: 'discard-energy-a', pos: 10 },
        toCardAddress: { entityID: 'discard-energy-a', parentEntityID: 'discard-target', pos: 16 },
      }],
    }],
    updatedEntities: [
      {
        entityID: 'discard-target', ownerPlayerId: 'player-2', currentGamePos: 16, cardSourceID: 'sv-test-1',
        attachedEnergy: [{ entityID: 'discard-energy-a' }],
      },
      {
        entityID: 'discard-energy-a', ownerPlayerId: 'player-2', previousGamePos: 10, currentGamePos: 16,
        currentParentEntityID: 'discard-target', cardSourceID: 'sv-energy',
      },
    ],
  },
});
assert.deepEqual(discardAttachReview?.turns.at(-1)?.snapshot.players.Opponent.discard, ['Basic Darkness Energy']);
assert.ok(!discardAttachReview?.turns.at(-1)?.snapshot.players.Opponent.discard.includes('Unknown card'), 'attaching from a public discard must not manufacture anonymous cards');
assert.deepEqual(discardAttachReview?.turns.at(-1)?.snapshot.players.Opponent.active?.energies, ['Basic Darkness Energy']);
const redactedDeckReturnReview = discardAttachAssembler.ingest({
  ...operation,
  operationId: 'redacted-deck-return',
  messageIndex: 18,
  operation: {
    operationNumber: 6,
    playerOperation: { operationType: 1, accountID: 'player-2', originEntityID: 'discard-target' },
    actionModifications: [{
      $type: 'MatchLogic.MoveCardsModification, MatchLogic',
      actionModificationID: 'discard-to-redacted-deck',
      moveCardDeltas: [{
        fromCardAddress: { entityID: 'discard-energy-b', pos: 10 },
        toCardAddress: { entityID: 'discard-energy-b' },
      }],
    }],
    updatedEntities: [{
      entityID: 'discard-energy-b', ownerPlayerId: 'player-2', previousGamePos: 10,
      currentGamePos: 8, cardSourceID: 'sv-energy',
    }],
  },
});
assert.deepEqual(redactedDeckReturnReview?.turns.at(-1)?.snapshot.players.Opponent.discard, [], 'a redacted deck destination must still remove the known card from Discard');
assert.equal(redactedDeckReturnReview?.turns.at(-1)?.snapshot.players.Opponent.deckCount, 1);

const coinAssembler = new LiveReviewAssembler(catalog);
coinAssembler.ingest({
  ...operation,
  operationId: 'coin-seed',
  messageIndex: 20,
  operation: {
    operationNumber: 1,
    updatedEntities: [
      { entityID: 'coin-player-1', ownerPlayerId: 'player-1', currentPos: 3, isPlayer1: true, userName: 'Isaiah' },
      { entityID: 'coin-player-2', ownerPlayerId: 'player-2', currentPos: 4, isPlayer1: false, userName: 'Opponent' },
      { entityID: 'hammer-heads', ownerPlayerId: 'player-1', currentGamePos: 11, cardSourceID: 'sv-hammer' },
      { entityID: 'hammer-tails', ownerPlayerId: 'player-1', currentGamePos: 11, cardSourceID: 'sv-hammer' },
      { entityID: 'hammer-target', ownerPlayerId: 'player-2', currentGamePos: 14, cardSourceID: 'sv-test-2', attachedEnergy: [{ entityID: 'hammer-target-energy' }] },
      { entityID: 'hammer-target-energy', ownerPlayerId: 'player-2', currentGamePos: 14, currentParentEntityID: 'hammer-target', cardSourceID: 'sv-energy' },
    ],
  },
});
const headsReview = coinAssembler.ingest({
  ...operation,
  operationId: 'hammer-heads-operation',
  messageIndex: 21,
  operation: {
    operationNumber: 2,
    playerOperation: { operationType: 1, accountID: 'player-1', originEntityID: 'hammer-heads' },
    actionModifications: [
      {
        $type: 'MatchLogic.CoinFlipModification, MatchLogic',
        actionModificationID: 'coin-heads',
        finalFlipResults: '1',
        headsCount: 1,
        headsCountWasUsed: true,
        isFinal: true,
      },
      {
        $type: 'MatchLogic.MoveCardsModification, MatchLogic',
        actionModificationID: 'hammer-successful-discard',
        moveCardDeltas: [
          { fromCardAddress: { entityID: 'hammer-heads', pos: 11 }, toCardAddress: { entityID: 'hammer-heads', pos: 9 } },
          { fromCardAddress: { entityID: 'hammer-target-energy', parentEntityID: 'hammer-target', pos: 14 }, toCardAddress: { entityID: 'hammer-target-energy', pos: 10 } },
        ],
      },
    ],
    updatedEntities: [
      { entityID: 'hammer-heads', ownerPlayerId: 'player-1', currentGamePos: 9, cardSourceID: 'sv-hammer' },
      { entityID: 'hammer-target-energy', ownerPlayerId: 'player-2', currentGamePos: 10, cardSourceID: 'sv-energy' },
    ],
  },
});
assert.deepEqual(headsReview?.turns[2].events.map((event) => event.kind), ['trainer', 'coin']);
assert.equal(headsReview?.turns[2].events[1].coinResult, 'heads');
assert.match(headsReview?.turns[2].events[1].text || '', /Crushing Hammer — Heads/);
const headsFacts = headsReview?.turns[2].events[1].facts || [];
assert.ok(headsFacts.some((fact) => fact.label === 'Coin flip' && fact.value === 'Heads'));
assert.ok(headsFacts.some((fact) => fact.label === 'Card moved' && /Crushing Hammer: Isaiah's Hand → Isaiah's Discard/.test(fact.value)));
assert.ok(headsFacts.some((fact) => fact.label === 'Card moved' && /Basic Darkness Energy: attached to Munkidori → Opponent's Discard/.test(fact.value)));
assert.deepEqual(headsReview?.turns[2].snapshot.players.Opponent.bench[0]?.energies, [], 'discarded Energy must disappear from its former Pokémon immediately');
assert.deepEqual(headsReview?.turns[2].canonical?.state.players[1].bench[0]?.attachedEnergy, [], 'canonical board must not retain a stale attachment reference');
assert.ok(headsReview?.turns[2].snapshot.players.Opponent.discard.includes('Basic Darkness Energy'));
assert.equal(headsReview?.turns[2].events[1].protocolChanges, 2);
assert.equal(headsReview?.turns[2].events[1].internalChanges, 0);
assert.deepEqual(headsReview?.turns[2].events[1].protocolGroups?.map((group) => [group.label, group.count, group.readableCount]), [
  ['Card movement', 1, 1],
  ['Coin flip', 1, 1],
]);

const tailsReview = coinAssembler.ingest({
  ...operation,
  operationId: 'hammer-tails-operation',
  messageIndex: 22,
  operation: {
    operationNumber: 3,
    playerOperation: { operationType: 1, accountID: 'player-1', originEntityID: 'hammer-tails' },
    actionModifications: [{
      $type: 'MatchLogic.CoinFlipModification, MatchLogic',
      actionModificationID: 'coin-tails',
      finalFlipResults: '0',
      headsCountWasUsed: true,
      isFinal: true,
    }],
    updatedEntities: [{ entityID: 'hammer-tails', ownerPlayerId: 'player-1', currentGamePos: 9, cardSourceID: 'sv-hammer' }],
  },
});
assert.equal(tailsReview?.turns[3].events[1].coinResult, 'tails');
assert.match(tailsReview?.turns[3].events[1].text || '', /Crushing Hammer — Tails/);

const privateDrawAssembler = new LiveReviewAssembler(catalog);
privateDrawAssembler.ingest({
  ...operation,
  operationId: 'private-draw-seed',
  messageIndex: 30,
  operation: {
    updatedEntities: [
      { entityID: 'private-draw-player-1', ownerPlayerId: 'player-1', currentPos: 3, isPlayer1: true, userName: 'Isaiah' },
      { entityID: 'private-draw-player-2', ownerPlayerId: 'player-2', currentPos: 4, isPlayer1: false, userName: 'OrangeManiac' },
      { entityID: 'private-draw-attacker', ownerPlayerId: 'player-1', currentGamePos: 15, cardSourceID: 'sv-test-1' },
      {
        entityID: 'private-draw-target', ownerPlayerId: 'player-2', currentGamePos: 16, cardSourceID: 'sv-honchkrow',
        attachedTools: [{ entityID: 'private-draw-helmet' }],
      },
      { entityID: 'private-draw-helmet', ownerPlayerId: 'player-2', currentGamePos: 16, currentParentEntityID: 'private-draw-target', cardSourceID: 'sv-lucky-helmet' },
      ...Array.from({ length: 8 }, (_, index) => ({ entityID: `private-draw-hand-${index}`, ownerPlayerId: 'player-2', currentGamePos: 12 })),
      ...Array.from({ length: 4 }, (_, index) => ({ entityID: `private-draw-deck-${index}`, ownerPlayerId: 'player-2', currentGamePos: 8 })),
    ],
  },
});
const privateDrawReview = privateDrawAssembler.ingest({
  ...operation,
  operationId: 'private-draw-attack',
  messageIndex: 31,
  operation: {
    operationNumber: 56,
    playerOperation: {
      operationType: 1,
      accountID: 'player-1',
      originEntityID: 'private-draw-attacker',
      targetID: 'private-draw-target',
    },
    actionModifications: [
      {
        $type: 'MatchLogic.ApplyDamageModification, MatchLogic',
        actionModificationID: 'private-draw-damage',
        isFinal: true,
        appliedDamageDeltas: [{ cardAddress: { entityID: 'private-draw-target', pos: 16 }, damageAmount: 200 }],
      },
      {
        $type: 'MatchLogic.SetMetaDataModification, MatchLogic',
        actionModificationID: 'private-draw-attack-name',
        setMetaDataDeltas: [{ metaDataKey: 22, value: '[Phantom Dive]' }],
      },
      {
        $type: 'MatchLogic.MoveCardsModification, MatchLogic',
        actionModificationID: 'private-draw-lucky-helmet',
        actionOriginEntityID: 'private-draw-helmet',
        moveCardDeltas: [
          { fromCardAddress: { pos: 8 }, toCardAddress: { index: 8, pos: 12 } },
          { fromCardAddress: { index: 1, pos: 8 }, toCardAddress: { index: 9, pos: 12 } },
        ],
      },
    ],
    updatedEntities: [
      { entityID: 'private-draw-target', ownerPlayerId: 'player-2', currentGamePos: 16, damageCounters: 20, cardSourceID: 'sv-honchkrow' },
      { previousGamePos: 8, previousPos: 8, currentGamePos: 12, currentPos: 12 },
      { previousGamePos: 8, previousPos: 8, currentGamePos: 12, currentPos: 12 },
    ],
  },
});
assert.ok(privateDrawReview);
const privateDrawTurn = privateDrawReview.turns.at(-1)!;
assert.deepEqual(privateDrawTurn.events.map((event) => event.kind), ['attack', 'damage', 'draw']);
assert.equal(privateDrawTurn.events[2].actor, 'OrangeManiac');
assert.equal(privateDrawTurn.events[2].sourceEntityId, 'private-draw-helmet');
assert.equal(privateDrawTurn.events[2].text, 'Lucky Helmet triggered — OrangeManiac drew 2 cards');
assert.ok(privateDrawTurn.events[2].facts?.some((fact) =>
  fact.label === 'Cards drawn' && fact.value === 'Lucky Helmet: OrangeManiac drew 2 hidden cards'
));
assert.equal(privateDrawTurn.snapshot.players.OrangeManiac.handCount, 10, 'private draws must increase the opponent hand count');
assert.equal(privateDrawTurn.snapshot.players.OrangeManiac.deckCount, 2, 'private draws must decrease the opponent deck count');
assert.equal(privateDrawTurn.canonical?.state.players[1].hand.length, 10, 'canonical review state must include the two hidden drawn cards');
assert.equal(privateDrawTurn.canonical?.state.players[1].deck.length, 2, 'canonical review state must remove the two hidden drawn cards from deck');

const privateHandResetAssembler = new LiveReviewAssembler(catalog);
privateHandResetAssembler.ingest({
  ...operation,
  operationId: 'private-hand-reset-seed',
  messageIndex: 32,
  operation: {
    updatedEntities: [
      { entityID: 'private-reset-player-1', ownerPlayerId: 'player-1', currentPos: 3, isPlayer1: true, userName: 'Isaiah' },
      { entityID: 'private-reset-player-2', ownerPlayerId: 'player-2', currentPos: 4, isPlayer1: false, userName: 'DestinyRivals' },
      { entityID: 'private-reset-stamp', ownerPlayerId: 'player-1', currentGamePos: 11, cardSourceID: 'sv-stamp' },
      ...Array.from({ length: 5 }, (_, index) => ({
        entityID: `private-reset-known-${index}`,
        ownerPlayerId: 'player-2',
        currentGamePos: 12,
        cardSourceID: index % 2 ? 'sv-test-2' : 'sv-energy',
      })),
    ],
  },
});
const privateHandResetReview = privateHandResetAssembler.ingest({
  ...operation,
  operationId: 'private-hand-reset-stamp',
  messageIndex: 33,
  operation: {
    operationNumber: 2,
    playerOperation: { operationType: 1, accountID: 'player-1', originEntityID: 'private-reset-stamp' },
    actionModifications: [
      {
        $type: 'MatchLogic.MoveCardsModification, MatchLogic',
        actionModificationID: 'private-reset-shuffle',
        actionOriginEntityID: 'private-reset-stamp',
        moveCardDeltas: Array.from({ length: 5 }, (_, index) => ({
          fromCardAddress: { pos: 12, index },
          toCardAddress: { pos: 8, index: 4 - index },
        })),
      },
      {
        $type: 'MatchLogic.MoveCardsModification, MatchLogic',
        actionModificationID: 'private-reset-draw',
        actionOriginEntityID: 'private-reset-stamp',
        moveCardDeltas: Array.from({ length: 2 }, (_, index) => ({
          fromCardAddress: { pos: 8, index },
          toCardAddress: { pos: 12, index },
        })),
      },
    ],
  },
});
assert.ok(privateHandResetReview);
const privateHandResetTurn = privateHandResetReview.turns.at(-1)!;
assert.equal(privateHandResetTurn.snapshot.players.DestinyRivals.handCount, 2, 'a private full-hand reset must use the authoritative post-effect count');
assert.deepEqual(privateHandResetTurn.snapshot.players.DestinyRivals.knownHand, [], 'cards known before a private shuffle must not remain in the new hand');
assert.equal(privateHandResetTurn.canonical?.state.players[1].hand.length, 2, 'canonical state must contain exactly the two hidden cards drawn by Unfair Stamp');
assert.deepEqual(privateHandResetTurn.canonical?.state.players[1].hand.map((card) => card.name), ['Hidden card', 'Hidden card']);

const phased = new LiveReviewAssembler(catalog);
phased.ingest({
  ...operation,
  accountId: 'player-2',
  operationId: 'seed-operation',
  messageIndex: 175,
  operation: {
    operationNumber: 75,
    playerOperation: { operationType: 2, accountID: 'player-2', originEntityID: 'dragapult' },
    updatedEntities: [
      { entityID: 'player-entity-1', ownerPlayerId: 'player-1', currentPos: 3, isPlayer1: true, userName: 'Opponent', battleFlagCounts: { PrizeCardsTaken: 1 } },
      { entityID: 'player-entity-2', ownerPlayerId: 'player-2', currentPos: 4, isPlayer1: false, userName: 'Isaiah', battleFlagCounts: { PrizeCardsTaken: 2 } },
      { entityID: 'grimmsnarl', ownerPlayerId: 'player-1', currentGamePos: 15, cardSourceID: 'sv-test-3' },
      { entityID: 'dragapult', ownerPlayerId: 'player-2', currentGamePos: 16, damageCounters: 16, cardSourceID: 'sv-test-1', battleFlagCounts: { CardEntityTimesKnockedOut: 0 } },
      { entityID: 'promotion-target', ownerPlayerId: 'player-2', currentGamePos: 14, cardSourceID: 'sv-test-2' },
    ],
  },
});

const attackPhase: CapturedOperation = {
  ...operation,
  accountId: 'player-2',
  operationId: 'phased-operation',
  messageIndex: 176,
  operation: {
    operationNumber: 76,
    playerOperation: { operationType: 1, accountID: 'player-1', originEntityID: 'grimmsnarl' },
    actionModifications: [{
      $type: 'MatchLogic.ApplyDamageModification, MatchLogic',
      actionModificationID: 'damage-pending',
      appliedDamageDeltas: [{ cardAddress: { entityID: 'dragapult' }, damageAmount: 180 }],
    }],
    updatedEntities: [{ entityID: 'dragapult', currentGamePos: 16, damageCounters: 16 }],
  },
};
phased.ingest(attackPhase);

phased.ingest({
  ...attackPhase,
  messageIndex: 178,
  operation: {
    operationNumber: 76,
    playerOperation: { operationType: 1, accountID: 'player-1', originEntityID: 'grimmsnarl' },
    actionModifications: [
      {
        $type: 'MatchLogic.ApplyDamageModification, MatchLogic',
        actionModificationID: 'damage-final',
        isFinal: true,
        appliedDamageDeltas: [{ cardAddress: { entityID: 'dragapult' }, damageAmount: 180, finalDamageAmount: 340 }],
      },
      {
        $type: 'MatchLogic.SetMetaDataModification, MatchLogic',
        actionModificationID: 'attack-name',
        setMetaDataDeltas: [{ metaDataKey: 22, value: '[Shadow Bullet]' }],
      },
    ],
    updatedEntities: [{
      entityID: 'dragapult', ownerPlayerId: 'player-2', cardSourceID: 'sv-test-1',
      currentGamePos: 10, previousGamePos: 16,
      battleFlagCounts: { CardEntityTimesKnockedOut: 1, CardEntityTotalDamageReceived: 340 },
    }],
  },
});

phased.ingest({
  ...attackPhase,
  messageIndex: 179,
  operation: {
    operationNumber: 76,
    playerOperation: { operationType: 1, accountID: 'player-1', originEntityID: 'grimmsnarl' },
    playerSelection: {
      selectionID: 'promotion-selection', selectingPlayerID: 'player-2',
      variableSelection: {
        $type: 'MatchLogic.EntitySelection, MatchLogic', selectionMethod: 13,
        allOptions: [{ entityID: 'promotion-target', pos: 14 }],
        allValidOptions: [{ entityID: 'promotion-target', pos: 14 }],
        selectionGroups: [{ minAmount: 1, maxAmount: 1, validOptions: [{ cardAddress: { entityID: 'promotion-target', pos: 14 } }] }],
        totalMinAmount: 1, totalMaxAmount: 1,
      },
    },
  },
});

phased.ingest({
  ...attackPhase,
  messageIndex: 180,
  operation: {
    operationNumber: 76,
    playerOperation: { operationType: 1, accountID: 'player-1', originEntityID: 'grimmsnarl' },
    completedSelections: ['promotion-selection'],
    actionModifications: [{
      $type: 'MatchLogic.MoveCardsModification, MatchLogic',
      actionModificationID: 'promote-after-knockout',
      moveCardDeltas: [{
        fromCardAddress: { entityID: 'promotion-target', pos: 14 },
        toCardAddress: { entityID: 'promotion-target', pos: 16 },
      }],
    }],
    updatedEntities: [{ entityID: 'promotion-target', ownerPlayerId: 'player-2', previousGamePos: 14, currentGamePos: 16, cardSourceID: 'sv-test-2' }],
  },
});

const prizePhase: CapturedOperation = {
  ...attackPhase,
  messageIndex: 181,
  operation: {
    operationNumber: 76,
    playerOperation: { operationType: 1, accountID: 'player-1', originEntityID: 'grimmsnarl' },
    updatedEntities: [{ entityID: 'player-entity-1', battleFlagCounts: { PrizeCardsTaken: 3 } }],
  },
};
const phasedReview = phased.ingest(prizePhase);
assert.ok(phasedReview);
assert.equal(phasedReview.localPlayer, 'Isaiah');
assert.equal(phasedReview.turns.length, 4, 'attack resolution and the forced promotion must be separate replay frames');
assert.equal(phasedReview.turns[2].label, 'Turn 1 · Action 2');
assert.equal(phasedReview.turns[2].gameOperationNumber, 76);
assert.equal(phasedReview.turns[2].player, 'Opponent');
assert.equal(phasedReview.turns[2].choiceLabel, 'Attacked with Shadow Bullet', 'secondary resolutions must never replace the attack as the action title');
assert.deepEqual(phasedReview.turns[2].events.map((event) => event.kind), ['attack', 'damage', 'knockout', 'prize']);
assert.match(phasedReview.turns[2].events[0].text, /Shadow Bullet/);
assert.match(phasedReview.turns[2].events[1].text, /180 damage.*Dragapult ex/);
assert.match(phasedReview.turns[2].events[2].text, /Dragapult ex was Knocked Out.*Grimmsnarl ex/);
assert.match(phasedReview.turns[2].events[3].text, /Opponent took 2 Prize cards/);
assert.equal(phasedReview.turns[2].events[1].targetEntityId, 'dragapult');
assert.equal(phasedReview.turns[2].events[2].targetEntityId, 'dragapult');
assert.deepEqual(phasedReview.turns[2].choiceCards?.map((card) => [card.name, card.choiceRole]), [["Marnie's Grimmsnarl ex", 'action']]);
assert.ok(phasedReview.turns[2].events[0].facts?.some((fact) => fact.label === 'Damage dealt' && fact.value === '180 to Dragapult ex'));
assert.ok(phasedReview.turns[2].events[0].facts?.some((fact) => fact.label === 'Promoted to Active' && fact.value === 'Munkidori'));
assert.equal(phasedReview.turns[2].events[0].protocolChanges, 4);
assert.equal(phasedReview.turns[2].events[0].internalChanges, 0);
assert.ok(phasedReview.turns[2].events[0].facts?.some((fact) => fact.label === 'Damage calculated' && fact.value === '180 to Dragapult ex'));
assert.ok(phasedReview.turns[2].events[0].facts?.some((fact) => fact.label === 'Attack selected' && fact.value === 'Shadow Bullet'));
assert.equal(phasedReview.turns[2].snapshot.players.Isaiah.active?.name, 'Dragapult ex', 'the KO frame keeps the defeated Pokémon in its slot');
assert.equal(phasedReview.turns[3].label, 'Turn 1 · Promotion');
assert.equal(phasedReview.turns[3].player, 'Isaiah');
assert.match(phasedReview.turns[3].events[0].text, /Isaiah: promoted Munkidori to the Active Spot/);
assert.equal(phasedReview.turns[3].events[0].actor, 'Isaiah');
assert.deepEqual(phasedReview.turns[3].choiceCards?.map((card) => [card.name, card.choiceRole]), [['Munkidori', 'promoted']]);
assert.equal(phasedReview.turns[3].snapshot.players.Isaiah.active?.name, 'Munkidori');
assert.ok(phasedReview.turns[3].snapshot.players.Isaiah.discard.includes('Dragapult ex'));

const beforeDuplicate = JSON.stringify(phasedReview);
const afterDuplicate = phased.ingest({ ...prizePhase, receivedAt: 'duplicate-delivery-time' });
assert.equal(JSON.stringify(afterDuplicate), beforeDuplicate, 'repeated delivery of one message must be idempotent');

const completed = new LiveReviewAssembler(catalog);
completed.ingest(operation);
const final = completed.ingest({
  ...operation,
  operationId: 'operation-2',
  messageIndex: 2,
  operation: {
    operationNumber: 2,
    playerOperation: { operationType: 8, accountID: 'player-1' },
    actionModifications: [{
      $type: 'MatchLogic.EndGameModification, MatchLogic',
      winner: 2,
      winGameEndReasonLocID: 'match_results_victory_reason_opponent_concede',
    }],
  },
});
assert.equal(final?.winner, 'Opponent');
assert.equal(final?.turns[2].label, 'Turn 1 · Action 2');
assert.equal(final?.turns[2].gameOperationNumber, 2);
assert.match(final?.turns[2].events[0].text || '', /Game over.*Opponent won.*concession/);

console.log('live-operation-reducer: multi-phase damage, knockout, prizes, and endgame reconstructed successfully');

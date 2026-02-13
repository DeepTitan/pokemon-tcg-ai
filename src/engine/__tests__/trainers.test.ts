/**
 * Charizard Deck — Trainer DSL Tests
 *
 * Tests every trainer card from the Charizard deck using the EffectDSL system.
 * Trainers: Dawn, Iono, Boss's Orders, Briar, Buddy-Buddy Poffin, Nest Ball,
 * Prime Catcher, Super Rod, Night Stretcher, Ultra Ball, Area Zero Underdepths, Rare Candy.
 *
 * Many trainers now use the PendingChoice system — when there are more matching cards
 * than needed, the engine pauses and generates ChooseCard actions for the AI to pick.
 * Tests verify both the PendingChoice creation and the resolution flow.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GameState,
  PlayerState,
  PokemonInPlay,
  PokemonCard,
  Card,
  CardType,
  EnergyType,
  EnergyCard,
  EnergySubtype,
  GamePhase,
  ActionType,
  TrainerCard,
  TrainerType,
  PokemonStage,
  GameFlag,
} from '../types.js';
import { EffectExecutor, EffectDSL } from '../effects.js';
import { GameEngine } from '../game-engine.js';
import { buildCharizardDeck } from '../charizard-deck.js';
import {
  createRealState,
  putPokemonAsActive,
  setupMainPhase,
  makeEnergy,
} from './test-helpers.js';

// ============================================================================
// Helper: find trainer card object from deck
// ============================================================================

function findTrainerInDeck(name: string): TrainerCard {
  const deck = buildCharizardDeck();
  const card = deck.find(c => c.name === name && c.cardType === CardType.Trainer);
  if (!card) throw new Error(`Trainer "${name}" not found in Charizard deck`);
  return card as TrainerCard;
}

function putTrainerInHand(state: GameState, playerIndex: 0 | 1, trainerName: string): GameState {
  const trainer = findTrainerInDeck(trainerName);
  const player = state.players[playerIndex];
  const newPlayer = { ...player, hand: [...player.hand, { ...trainer, id: `test-${trainer.id}` }] };
  const players = [...state.players] as [PlayerState, PlayerState];
  players[playerIndex] = newPlayer;
  return { ...state, players };
}

// ============================================================================
// Trainer DSL Tests
// ============================================================================

describe('Charizard Deck — Trainers', () => {
  // ---------- Dawn ----------
  // "Search your deck for a Basic Pokemon, a Stage 1 Pokemon, and a Stage 2 Pokemon or Pokemon ex, reveal them, and put them into your hand. Then, shuffle your deck."
  it('Dawn: creates PendingChoice for each stage search', () => {
    const state = createRealState();
    const trainer = findTrainerInDeck('Dawn');
    assert.ok(trainer.effects, 'Dawn should have DSL effects');

    const handBefore = state.players[0].hand.length;

    // Execute Dawn — first search (Basic) should create a PendingChoice
    let after = EffectExecutor.executeTrainer(state, trainer.effects!, 0, 'Dawn');

    assert.ok(after.pendingChoice, 'Should create PendingChoice for Basic search');
    assert.equal(after.pendingChoice!.choiceType, 'searchCard');
    assert.ok(after.pendingChoice!.options.length > 0, 'Should have Basic Pokemon options');

    // Pick the first option (simulate AI choice)
    const firstOption = after.pendingChoice!.options[0];
    after = GameEngine.applyAction(after, {
      type: ActionType.ChooseCard,
      player: 0 as 0 | 1,
      payload: { choiceId: firstOption.id, label: firstOption.label },
    });

    // After picking Basic, Stage1 search should create another PendingChoice
    // (via remainingEffects → resumeEffects)
    if (after.pendingChoice) {
      assert.equal(after.pendingChoice.choiceType, 'searchCard');
      const stage1Option = after.pendingChoice.options[0];
      after = GameEngine.applyAction(after, {
        type: ActionType.ChooseCard,
        player: 0 as 0 | 1,
        payload: { choiceId: stage1Option.id, label: stage1Option.label },
      });
    }

    // After picking Stage1, Stage2/ex search should create another PendingChoice
    if (after.pendingChoice) {
      assert.equal(after.pendingChoice.choiceType, 'searchCard');
      const stage2Option = after.pendingChoice.options[0];
      after = GameEngine.applyAction(after, {
        type: ActionType.ChooseCard,
        player: 0 as 0 | 1,
        payload: { choiceId: stage2Option.id, label: stage2Option.label },
      });
    }

    // All choices resolved — hand should have grown
    assert.ok(after.players[0].hand.length > handBefore, 'Hand should have gained cards');
    assert.equal(after.pendingChoice, undefined, 'No pending choice should remain');
  });

  // ---------- Iono ----------
  // "Each player shuffles their hand into their deck. Then, each player draws a card for each of their remaining Prize cards."
  it('Iono: both players shuffle hand into deck, draw by prize count', () => {
    const state = createRealState();
    const trainer = findTrainerInDeck('Iono');
    assert.ok(trainer.effects, 'Iono should have DSL effects');

    const p0PrizesRemaining = state.players[0].prizeCardsRemaining;
    const p1PrizesRemaining = state.players[1].prizeCardsRemaining;
    const p0DeckBefore = state.players[0].deck.length + state.players[0].hand.length; // total cards

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    // Player 0 should have drawn cards equal to their prize count
    assert.equal(after.players[0].hand.length, Math.min(p0PrizesRemaining, p0DeckBefore));
    // Player 1 should have drawn cards equal to their prize count
    const p1TotalBefore = state.players[1].deck.length + state.players[1].hand.length;
    assert.equal(after.players[1].hand.length, Math.min(p1PrizesRemaining, p1TotalBefore));
  });

  it('Iono: with fewer prizes, draws fewer cards', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Iono');
    // Simulate player 0 having taken 4 prizes (only 2 remaining)
    state.players[0].prizeCardsRemaining = 2;
    state.players[1].prizeCardsRemaining = 4;

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    assert.equal(after.players[0].hand.length, 2);
    assert.equal(after.players[1].hand.length, 4);
  });

  // ---------- Boss's Orders ----------
  // "Your opponent switches their Active Pokemon with 1 of their Benched Pokemon."
  it("Boss's Orders: opponent active swaps with bench Pokemon", () => {
    const state = createRealState();
    const trainer = findTrainerInDeck("Boss's Orders");
    assert.ok(trainer.effects, "Boss's Orders should have DSL effects");
    assert.ok(state.players[1].bench.length > 0, 'Opponent needs bench Pokemon');

    const oppActiveBefore = state.players[1].active!.card.name;
    const oppBenchFirstBefore = state.players[1].bench[0].card.name;

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    // Active should have changed
    const oppActiveAfter = after.players[1].active!.card.name;
    assert.notEqual(oppActiveAfter, oppActiveBefore, 'Opponent active should change');
    // Old active should now be on bench
    const oldActiveOnBench = after.players[1].bench.some(p => p.card.name === oppActiveBefore);
    assert.ok(oldActiveOnBench, 'Old active should be on bench');
  });

  // ---------- Briar ----------
  // "You can use this card only if your opponent has exactly 2 Prize cards remaining."
  // "If your Tera Pokemon Knocks Out your opponent's Active Pokemon during this turn, take 1 more Prize card."
  it('Briar: adds briarExtraPrize game flag', () => {
    const state = createRealState();
    const trainer = findTrainerInDeck('Briar');
    assert.ok(trainer.effects, 'Briar should have DSL effects');
    assert.ok(trainer.playCondition, 'Briar should have a play condition');
    const flagsBefore = state.gameFlags.length;

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    assert.equal(after.gameFlags.length, flagsBefore + 1);
    assert.equal(after.gameFlags[after.gameFlags.length - 1].flag, 'briarExtraPrize');
    assert.equal(after.gameFlags[after.gameFlags.length - 1].duration, 'nextTurn');
  });

  it('Briar: cannot be played when opponent has != 2 prizes remaining', () => {
    let state = createRealState();
    state = setupMainPhase(state, 0);
    state = putTrainerInHand(state, 0, 'Briar');
    // Opponent has 6 prizes (default) — should NOT be playable
    assert.equal(state.players[1].prizeCardsRemaining, 6);

    const actions = GameEngine.getLegalActions(state);
    const briarActions = actions.filter(a =>
      a.type === ActionType.PlayTrainer &&
      (state.players[0].hand[a.payload.handIndex] as TrainerCard).name === 'Briar'
    );
    assert.equal(briarActions.length, 0, 'Briar should not be playable when opponent has 6 prizes');
  });

  it('Briar: can be played when opponent has exactly 2 prizes remaining', () => {
    let state = createRealState();
    state = setupMainPhase(state, 0);
    state = putTrainerInHand(state, 0, 'Briar');
    // Set opponent to exactly 2 prizes remaining
    state.players[1] = { ...state.players[1], prizeCardsRemaining: 2, prizes: state.players[1].prizes.slice(0, 2) };

    const actions = GameEngine.getLegalActions(state);
    const briarActions = actions.filter(a =>
      a.type === ActionType.PlayTrainer &&
      (state.players[0].hand[a.payload.handIndex] as TrainerCard).name === 'Briar'
    );
    assert.equal(briarActions.length, 1, 'Briar should be playable when opponent has exactly 2 prizes');
  });

  it('Briar: Tera Pokemon KO grants extra prize card', () => {
    let state = createRealState();
    // Put Terapagos ex as player 0's active (it has isTera: true)
    state = putPokemonAsActive(state, 0, 'Terapagos ex');
    // Set to AttackPhase so Attack action is legal
    state = { ...state, currentPlayer: 0 as 0 | 1, phase: GamePhase.AttackPhase };
    // Set up opponent active with low HP for easy KO
    const oppActive = state.players[1].active!;
    state.players[1] = {
      ...state.players[1],
      active: { ...oppActive, currentHp: 1 },
    };

    // Set Briar flag for player 0
    state.gameFlags = [{
      flag: 'briarExtraPrize',
      duration: 'nextTurn' as const,
      setOnTurn: state.turnNumber,
      setByPlayer: 0 as 0 | 1,
    }];

    // Player 0 should have 6 prizes at start
    const prizesBefore = state.players[0].prizeCardsRemaining;

    // Ensure enough energy for Unified Beatdown (Colorless, Colorless)
    state.players[0] = {
      ...state.players[0],
      active: {
        ...state.players[0].active!,
        attachedEnergy: [
          { id: 'e1', name: 'Fire Energy', cardType: CardType.Energy, imageUrl: '', cardNumber: '', energySubtype: EnergySubtype.Basic, energyType: EnergyType.Fire, provides: [EnergyType.Fire] },
          { id: 'e2', name: 'Fire Energy', cardType: CardType.Energy, imageUrl: '', cardNumber: '', energySubtype: EnergySubtype.Basic, energyType: EnergyType.Fire, provides: [EnergyType.Fire] },
        ],
      },
    };

    const action = {
      type: ActionType.Attack,
      player: 0 as 0 | 1,
      payload: { attackIndex: 0 },
    };
    const after = GameEngine.applyAction(state, action);

    // Opponent's active should be KO'd (1 HP, 30 base damage KOs)
    const basePrizes = oppActive.card.prizeCards;
    const expectedPrizesTaken = basePrizes + 1; // +1 from Briar
    assert.equal(
      after.players[0].prizeCardsRemaining,
      Math.max(0, prizesBefore - expectedPrizesTaken),
      `Should take ${expectedPrizesTaken} prizes (${basePrizes} base + 1 Briar bonus)`
    );
    // Briar flag should be consumed
    assert.equal(
      after.gameFlags.filter(f => f.flag === 'briarExtraPrize').length,
      0,
      'Briar flag should be consumed after KO'
    );
  });

  it('Briar: no extra prize without Tera Pokemon', () => {
    let state = createRealState();
    // Put a non-Tera Pokemon as active (e.g., Charizard ex — has isTera undefined)
    state = putPokemonAsActive(state, 0, 'Charizard ex');
    // Set to AttackPhase so Attack action is legal
    state = { ...state, currentPlayer: 0 as 0 | 1, phase: GamePhase.AttackPhase };
    // Set up opponent active with low HP
    const oppActive = state.players[1].active!;
    state.players[1] = {
      ...state.players[1],
      active: { ...oppActive, currentHp: 1 },
    };

    // Set Briar flag for player 0
    state.gameFlags = [{
      flag: 'briarExtraPrize',
      duration: 'nextTurn' as const,
      setOnTurn: state.turnNumber,
      setByPlayer: 0 as 0 | 1,
    }];

    const prizesBefore = state.players[0].prizeCardsRemaining;

    // Ensure enough energy for Charizard ex's Burning Darkness (Fire, Fire, Colorless)
    state.players[0] = {
      ...state.players[0],
      active: {
        ...state.players[0].active!,
        attachedEnergy: [
          { id: 'e1', name: 'Fire Energy', cardType: CardType.Energy, imageUrl: '', cardNumber: '', energySubtype: EnergySubtype.Basic, energyType: EnergyType.Fire, provides: [EnergyType.Fire] },
          { id: 'e2', name: 'Fire Energy', cardType: CardType.Energy, imageUrl: '', cardNumber: '', energySubtype: EnergySubtype.Basic, energyType: EnergyType.Fire, provides: [EnergyType.Fire] },
          { id: 'e3', name: 'Fire Energy', cardType: CardType.Energy, imageUrl: '', cardNumber: '', energySubtype: EnergySubtype.Basic, energyType: EnergyType.Fire, provides: [EnergyType.Fire] },
        ],
      },
    };

    const action = {
      type: ActionType.Attack,
      player: 0 as 0 | 1,
      payload: { attackIndex: 0 },
    };
    const after = GameEngine.applyAction(state, action);

    // Should take normal prizes only (no Briar bonus since Charizard ex is NOT Tera)
    const basePrizes = oppActive.card.prizeCards;
    assert.equal(
      after.players[0].prizeCardsRemaining,
      Math.max(0, prizesBefore - basePrizes),
      `Should take only ${basePrizes} prizes (no Briar bonus without Tera Pokemon)`
    );
    // Briar flag should NOT be consumed (Tera condition not met)
    assert.equal(
      after.gameFlags.filter(f => f.flag === 'briarExtraPrize').length,
      1,
      'Briar flag should remain since no Tera Pokemon attacked'
    );
  });

  // ---------- Buddy-Buddy Poffin ----------
  // "Search your deck for up to 2 Basic Pokemon with 70 HP or less, and put them onto your Bench."
  it('Buddy-Buddy Poffin: creates PendingChoice for up to 2 Basic HP<=70', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Buddy-Buddy Poffin');
    assert.ok(trainer.effects, 'Buddy-Buddy Poffin should have DSL effects');

    const benchBefore = state.players[0].bench.length;

    // Execute — should create PendingChoice since deck has many eligible Basics
    let after = EffectExecutor.executeTrainer(state, trainer.effects!, 0, 'Buddy-Buddy Poffin');

    assert.ok(after.pendingChoice, 'Should create PendingChoice for bench search');
    assert.equal(after.pendingChoice!.choiceType, 'searchCard');
    assert.equal(after.pendingChoice!.destination, 'bench');
    assert.equal(after.pendingChoice!.selectionsRemaining, 2);
    assert.ok(after.pendingChoice!.canSkip, 'Should be skippable (up to 2)');

    // All options should be Basic with HP <= 70
    for (const opt of after.pendingChoice!.options) {
      assert.ok(opt.card, 'Option should have a card');
      const pokemon = opt.card as PokemonCard;
      assert.equal(pokemon.stage, PokemonStage.Basic);
      assert.ok(pokemon.hp <= 70, `${pokemon.name} HP ${pokemon.hp} should be <= 70`);
    }

    // Pick first option
    const firstOption = after.pendingChoice!.options[0];
    after = GameEngine.applyAction(after, {
      type: ActionType.ChooseCard,
      player: 0 as 0 | 1,
      payload: { choiceId: firstOption.id, label: firstOption.label },
    });

    // Should still have a PendingChoice for second pick
    if (after.pendingChoice) {
      assert.equal(after.pendingChoice.selectionsRemaining, 1);
      const secondOption = after.pendingChoice.options[0];
      after = GameEngine.applyAction(after, {
        type: ActionType.ChooseCard,
        player: 0 as 0 | 1,
        payload: { choiceId: secondOption.id, label: secondOption.label },
      });
    }

    // Bench should have grown
    assert.ok(after.players[0].bench.length > benchBefore, 'Bench should have added Pokemon');
    assert.equal(after.pendingChoice, undefined, 'No pending choice should remain');
  });

  // ---------- Nest Ball ----------
  // "Search your deck for a Basic Pokemon and put it onto your Bench."
  it('Nest Ball: creates PendingChoice for Basic search to bench', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Nest Ball');
    assert.ok(trainer.effects, 'Nest Ball should have DSL effects');

    const benchBefore = state.players[0].bench.length;

    let after = EffectExecutor.executeTrainer(state, trainer.effects!, 0, 'Nest Ball');

    // Should create a PendingChoice since deck has many Basic Pokemon
    assert.ok(after.pendingChoice, 'Should create PendingChoice for Nest Ball');
    assert.equal(after.pendingChoice!.choiceType, 'searchCard');
    assert.equal(after.pendingChoice!.destination, 'bench');
    assert.equal(after.pendingChoice!.selectionsRemaining, 1);

    // All options should be Basic Pokemon
    for (const opt of after.pendingChoice!.options) {
      assert.ok(opt.card, 'Option should have a card');
      const pokemon = opt.card as PokemonCard;
      assert.equal(pokemon.stage, PokemonStage.Basic, `${pokemon.name} should be Basic`);
    }

    // Pick the first option
    const option = after.pendingChoice!.options[0];
    after = GameEngine.applyAction(after, {
      type: ActionType.ChooseCard,
      player: 0 as 0 | 1,
      payload: { choiceId: option.id, label: option.label },
    });

    // Bench should have grown by 1
    if (benchBefore < 5) {
      assert.equal(after.players[0].bench.length, benchBefore + 1);
      const placed = after.players[0].bench[after.players[0].bench.length - 1];
      assert.equal(placed.card.stage, PokemonStage.Basic);
    }
    assert.equal(after.pendingChoice, undefined, 'No pending choice should remain');
  });

  // ---------- Prime Catcher ----------
  // "Switch in 1 of your opponent's Benched Pokemon to the Active Spot."
  it('Prime Catcher: opponent active swaps with bench Pokemon', () => {
    const state = createRealState();
    const trainer = findTrainerInDeck('Prime Catcher');
    assert.ok(trainer.effects, 'Prime Catcher should have DSL effects');
    assert.ok(state.players[1].bench.length > 0);

    const oppActiveBefore = state.players[1].active!.card.name;

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    assert.notEqual(after.players[1].active!.card.name, oppActiveBefore);
  });

  // ---------- Super Rod ----------
  // "Put up to 3 in any combination of Pokemon and basic Energy cards from your discard pile into your deck. Then, shuffle your deck."
  it('Super Rod: up to 3 Pokemon/Energy recovered from discard to deck', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Super Rod');
    assert.ok(trainer.effects, 'Super Rod should have DSL effects');

    // Put some cards in discard
    const charmander = state.players[0].deck.find(c => c.name === 'Charmander')!;
    const fireEnergy = state.players[0].deck.find(c => c.name === 'Fire Energy')!;
    const iono = state.players[0].deck.find(c => c.name === 'Iono')!;
    state.players[0].discard = [charmander, fireEnergy, iono];
    state.players[0].deck = state.players[0].deck.filter(c => c !== charmander && c !== fireEnergy && c !== iono);

    const deckBefore = state.players[0].deck.length;
    const discardBefore = state.players[0].discard.length;

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    // Should recover charmander and fireEnergy (not Iono since it's a Trainer, not Pokemon/basicEnergy)
    assert.equal(after.players[0].discard.length, 1, 'Only Iono should remain in discard');
    assert.equal(after.players[0].deck.length, deckBefore + 2, 'Deck should gain 2 cards');
    assert.equal(after.players[0].discard[0].name, 'Iono', 'Iono (Trainer) should stay in discard');
  });

  // ---------- Night Stretcher ----------
  // "Put a Pokemon or a basic Energy card from your discard pile into your hand."
  it('Night Stretcher: 1 Pokemon recovered from discard to hand', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Night Stretcher');
    assert.ok(trainer.effects, 'Night Stretcher should have DSL effects');

    // Put a Pokemon in discard
    const charmander = state.players[0].deck.find(c => c.name === 'Charmander')!;
    state.players[0].discard = [charmander];
    state.players[0].deck = state.players[0].deck.filter(c => c !== charmander);
    const handBefore = state.players[0].hand.length;

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    assert.equal(after.players[0].hand.length, handBefore + 1);
    assert.equal(after.players[0].discard.length, 0);
    // The recovered card should be Charmander
    const recovered = after.players[0].hand[after.players[0].hand.length - 1];
    assert.equal(recovered.name, 'Charmander');
  });

  it('Night Stretcher: recovers basic Energy from discard to hand', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Night Stretcher');

    const fireEnergy = state.players[0].deck.find(c => c.name === 'Fire Energy')!;
    state.players[0].discard = [fireEnergy];
    state.players[0].deck = state.players[0].deck.filter(c => c !== fireEnergy);
    const handBefore = state.players[0].hand.length;

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    assert.equal(after.players[0].hand.length, handBefore + 1);
    assert.equal(after.players[0].discard.length, 0);
    assert.equal(after.players[0].hand[after.players[0].hand.length - 1].name, 'Fire Energy');
  });

  it('Night Stretcher: does not recover special Energy or Trainers', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Night Stretcher');

    // Put only Jet Energy (special) and Iono (trainer) in discard
    const jetEnergy = state.players[0].deck.find(c => c.name === 'Jet Energy')!;
    const iono = state.players[0].deck.find(c => c.name === 'Iono')!;
    state.players[0].discard = [jetEnergy, iono];
    state.players[0].deck = state.players[0].deck.filter(c => c !== jetEnergy && c !== iono);
    const handBefore = state.players[0].hand.length;

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    // Neither should be recovered (Jet Energy is Special, not Basic)
    assert.equal(after.players[0].hand.length, handBefore);
    assert.equal(after.players[0].discard.length, 2);
  });

  // ---------- Ultra Ball ----------
  // "Discard 2 cards from your hand. Search your deck for a Pokemon, reveal it, and put it into your hand. Then, shuffle your deck."
  it('Ultra Ball: creates discard PendingChoice then search PendingChoice', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Ultra Ball');
    assert.ok(trainer.effects, 'Ultra Ball should have DSL effects');

    const handBefore = state.players[0].hand.length;

    // Execute — should create PendingChoice for discard first (if hand > 2)
    let after = EffectExecutor.executeTrainer(state, trainer.effects!, 0, 'Ultra Ball');

    if (after.pendingChoice && after.pendingChoice.choiceType === 'discardCard') {
      // Discard 2 cards
      assert.equal(after.pendingChoice.selectionsRemaining, 2);
      assert.ok(!after.pendingChoice.canSkip, 'Must discard exactly 2');

      const disc1 = after.pendingChoice.options[0];
      after = GameEngine.applyAction(after, {
        type: ActionType.ChooseCard,
        player: 0 as 0 | 1,
        payload: { choiceId: disc1.id, label: disc1.label },
      });

      assert.ok(after.pendingChoice, 'Still need to discard 1 more');
      const disc2 = after.pendingChoice!.options[0];
      after = GameEngine.applyAction(after, {
        type: ActionType.ChooseCard,
        player: 0 as 0 | 1,
        payload: { choiceId: disc2.id, label: disc2.label },
      });
    }

    // After discard, search should create PendingChoice
    if (after.pendingChoice && after.pendingChoice.choiceType === 'searchCard') {
      assert.equal(after.pendingChoice.destination, 'hand');
      const searchOption = after.pendingChoice.options[0];
      after = GameEngine.applyAction(after, {
        type: ActionType.ChooseCard,
        player: 0 as 0 | 1,
        payload: { choiceId: searchOption.id, label: searchOption.label },
      });
    }

    // Verify: hand lost 2 (discard) + gained 1 (search) = net -1
    assert.ok(after.players[0].discard.length >= 2, 'Should have discarded at least 2 cards');
    assert.equal(after.pendingChoice, undefined, 'No pending choice should remain');
  });

  // ---------- Area Zero Underdepths ----------
  // "If you have a Tera Pokemon in play, the maximum number of Benched Pokemon for each player is 8."
  it('Area Zero Underdepths: noop (passive stadium, state unchanged)', () => {
    const state = createRealState();
    const trainer = findTrainerInDeck('Area Zero Underdepths');
    assert.ok(trainer.effects, 'Area Zero should have DSL effects');

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    // State should be unchanged (noop)
    assert.equal(after.players[0].hand.length, state.players[0].hand.length);
    assert.equal(after.players[0].deck.length, state.players[0].deck.length);
    assert.equal(after.players[0].bench.length, state.players[0].bench.length);
  });

  // ---------- Engine Pipeline: PlayTrainer action ----------
  it('Dawn via PlayTrainer action: creates PendingChoice for search', () => {
    let state = createRealState();
    state = setupMainPhase(state, 0);
    state = putTrainerInHand(state, 0, 'Dawn');

    const dawnIndex = state.players[0].hand.findIndex(c => c.name === 'Dawn');
    assert.ok(dawnIndex >= 0, 'Dawn should be in hand');

    const action = {
      type: ActionType.PlayTrainer,
      player: 0 as 0 | 1,
      payload: { handIndex: dawnIndex },
    };
    const after = GameEngine.applyAction(state, action);

    // Dawn should have been discarded and created a PendingChoice for the first search
    assert.ok(after.pendingChoice, 'Should create PendingChoice for Dawn search');
    assert.equal(after.pendingChoice!.choiceType, 'searchCard');
    assert.ok(after.players[0].supporterPlayedThisTurn, 'Dawn is a Supporter — should mark as played');
  });

  it('Iono via PlayTrainer action: resets both hands by prize count', () => {
    let state = createRealState();
    state = setupMainPhase(state, 0);
    state = putTrainerInHand(state, 0, 'Iono');

    const ionoIndex = state.players[0].hand.findIndex(c => c.name === 'Iono');
    const action = {
      type: ActionType.PlayTrainer,
      player: 0 as 0 | 1,
      payload: { handIndex: ionoIndex },
    };

    const p0Prizes = state.players[0].prizeCardsRemaining;
    const after = GameEngine.applyAction(state, action);

    // After Iono, player 0 draws cards equal to prize count
    assert.equal(after.players[0].hand.length, p0Prizes);
  });

  it("Boss's Orders via PlayTrainer action: forces opponent switch", () => {
    let state = createRealState();
    state = setupMainPhase(state, 0);
    state = putTrainerInHand(state, 0, "Boss's Orders");
    // Mark supporter not yet played
    state.players[0].supporterPlayedThisTurn = false;
    assert.ok(state.players[1].bench.length > 0);

    const oppActiveBefore = state.players[1].active!.card.name;
    const bossIndex = state.players[0].hand.findIndex(c => c.name === "Boss's Orders");

    const action = {
      type: ActionType.PlayTrainer,
      player: 0 as 0 | 1,
      payload: { handIndex: bossIndex },
    };
    const after = GameEngine.applyAction(state, action);

    assert.notEqual(after.players[1].active!.card.name, oppActiveBefore);
    assert.ok(after.players[0].supporterPlayedThisTurn, 'Should mark supporter as played');
  });

  it('Nest Ball via PlayTrainer action: creates PendingChoice', () => {
    let state = createRealState();
    state = setupMainPhase(state, 0);
    state = putTrainerInHand(state, 0, 'Nest Ball');

    const nestIndex = state.players[0].hand.findIndex(c => c.name === 'Nest Ball');
    const action = {
      type: ActionType.PlayTrainer,
      player: 0 as 0 | 1,
      payload: { handIndex: nestIndex },
    };
    const after = GameEngine.applyAction(state, action);

    // Nest Ball should create a PendingChoice for Basic search to bench
    assert.ok(after.pendingChoice, 'Should create PendingChoice for Nest Ball search');
    assert.equal(after.pendingChoice!.choiceType, 'searchCard');
    assert.equal(after.pendingChoice!.destination, 'bench');

    // getLegalActions should only return ChooseCard actions
    const legalActions = GameEngine.getLegalActions(after);
    assert.ok(legalActions.length > 0, 'Should have ChooseCard actions');
    assert.ok(legalActions.every(a => a.type === ActionType.ChooseCard), 'All actions should be ChooseCard');
  });

  // ==========================================================================
  // PendingChoice System Tests
  // ==========================================================================

  it("Boss's Orders with 3 bench: generates 3 ChooseCard actions", () => {
    let state = createRealState();
    // Add more Pokemon to opponent's bench (default has 1)
    const oppPlayer = state.players[1];
    const benchPokemon = oppPlayer.deck.filter(c =>
      c.cardType === CardType.Pokemon && (c as PokemonCard).stage === PokemonStage.Basic
    ).slice(0, 2) as PokemonCard[];
    const newBench = [...oppPlayer.bench];
    for (const p of benchPokemon) {
      if (newBench.length < 3) {
        newBench.push({
          card: p,
          currentHp: p.hp,
          attachedEnergy: [],
          statusConditions: [],
          damageCounters: 0,
          attachedTools: [],
          isEvolved: false,
          turnPlayed: 0,
          damageShields: [],
          cannotRetreat: false,
        });
      }
    }
    state.players[1] = { ...oppPlayer, bench: newBench };

    const trainer = findTrainerInDeck("Boss's Orders");
    let after = EffectExecutor.executeTrainer(state, trainer.effects!, 0, "Boss's Orders");

    // Should create PendingChoice with switchTarget
    assert.ok(after.pendingChoice, 'Should create PendingChoice with 3 bench');
    assert.equal(after.pendingChoice!.choiceType, 'switchTarget');
    assert.equal(after.pendingChoice!.options.length, newBench.length, 'One option per bench Pokemon');

    // getLegalActions should generate ChooseCard actions
    const actions = GameEngine.getLegalActions(after);
    assert.equal(actions.length, newBench.length, 'One ChooseCard action per bench Pokemon');
    assert.ok(actions.every(a => a.type === ActionType.ChooseCard), 'All should be ChooseCard');
  });

  it("Boss's Orders with 1 bench: auto-selects (no pending choice)", () => {
    const state = createRealState();
    assert.equal(state.players[1].bench.length, 1);

    const trainer = findTrainerInDeck("Boss's Orders");
    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0, "Boss's Orders");

    assert.equal(after.pendingChoice, undefined, 'Should auto-select with 1 bench');
    assert.notEqual(after.players[1].active!.card.name, state.players[1].active!.card.name);
  });

  it('ChooseCard skip: stops multi-pick early for "up to N" effects', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Buddy-Buddy Poffin');

    let after = EffectExecutor.executeTrainer(state, trainer.effects!, 0, 'Buddy-Buddy Poffin');
    assert.ok(after.pendingChoice, 'Should create PendingChoice');
    assert.ok(after.pendingChoice!.canSkip, 'Should allow skipping (up to 2)');

    const benchBefore = after.players[0].bench.length;

    // Pick 1, then skip
    const firstOption = after.pendingChoice!.options[0];
    after = GameEngine.applyAction(after, {
      type: ActionType.ChooseCard,
      player: 0 as 0 | 1,
      payload: { choiceId: firstOption.id, label: firstOption.label },
    });

    assert.ok(after.pendingChoice, 'Should still have PendingChoice for second pick');

    // Skip the second pick
    after = GameEngine.applyAction(after, {
      type: ActionType.ChooseCard,
      player: 0 as 0 | 1,
      payload: { choiceId: 'skip', label: 'Done' },
    });

    assert.equal(after.players[0].bench.length, benchBefore + 1, 'Only 1 added after skip');
    assert.equal(after.pendingChoice, undefined, 'No pending choice should remain');
  });

  // ---------- Rare Candy DSL ----------
  it('Rare Candy DSL: evolves Basic directly to Stage 2', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Rare Candy');
    assert.ok(trainer.effects, 'Rare Candy should have DSL effects');

    // Set up: Charmander as active, Charizard ex in hand, turn > 1
    state = putPokemonAsActive(state, 0, 'Charmander');
    state = { ...state, turnNumber: 3 };
    const charizardEx = state.players[0].deck.find(c => c.name === 'Charizard ex');
    if (charizardEx) {
      state.players[0].hand = [...state.players[0].hand, charizardEx];
      state.players[0].deck = state.players[0].deck.filter(c => c !== charizardEx);
    }
    state.players[0].bench = [];

    let after = EffectExecutor.executeTrainer(state, trainer.effects!, 0, 'Rare Candy');

    // Resolve choice if needed
    if (after.pendingChoice) {
      const option = after.pendingChoice.options[0];
      after = GameEngine.applyAction(after, {
        type: ActionType.ChooseCard,
        player: 0 as 0 | 1,
        payload: { choiceId: option.id, label: option.label },
      });
    }

    assert.equal(after.players[0].active!.card.name, 'Charizard ex', 'Should evolve to Charizard ex');
    assert.ok(after.players[0].active!.isEvolved, 'Should be marked as evolved');
  });

  it('Rare Candy DSL: does not evolve turn 1', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Rare Candy');
    state = { ...state, turnNumber: 1 };
    state = putPokemonAsActive(state, 0, 'Charmander');
    const charizardEx = state.players[0].deck.find(c => c.name === 'Charizard ex');
    if (charizardEx) {
      state.players[0].hand = [...state.players[0].hand, charizardEx];
      state.players[0].deck = state.players[0].deck.filter(c => c !== charizardEx);
    }

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0, 'Rare Candy');

    assert.equal(after.players[0].active!.card.name, 'Charmander', 'Should not evolve turn 1');
    assert.equal(after.pendingChoice, undefined, 'No pending choice on turn 1');
  });

  it('Super Rod: auto-selects when matches <= count (no PendingChoice)', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Super Rod');

    const charmander = state.players[0].deck.find(c => c.name === 'Charmander')!;
    const fireEnergy = state.players[0].deck.find(c => c.name === 'Fire Energy')!;
    state.players[0].discard = [charmander, fireEnergy];
    state.players[0].deck = state.players[0].deck.filter(c => c !== charmander && c !== fireEnergy);

    const deckBefore = state.players[0].deck.length;
    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0, 'Super Rod');

    assert.equal(after.pendingChoice, undefined, 'Should auto-select when matches <= count');
    assert.equal(after.players[0].discard.length, 0, 'All eligible cards recovered');
    assert.equal(after.players[0].deck.length, deckBefore + 2, 'Deck gains 2 cards');
  });

  it('Night Stretcher: auto-selects when only 1 match (no PendingChoice)', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Night Stretcher');

    const charmander = state.players[0].deck.find(c => c.name === 'Charmander')!;
    state.players[0].discard = [charmander];
    state.players[0].deck = state.players[0].deck.filter(c => c !== charmander);
    const handBefore = state.players[0].hand.length;

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0, 'Night Stretcher');

    assert.equal(after.pendingChoice, undefined, 'Should auto-select with 1 match');
    assert.equal(after.players[0].hand.length, handBefore + 1);
    assert.equal(after.players[0].discard.length, 0);
  });
});

/**
 * Charizard Deck — Trainer DSL Tests
 *
 * Tests every trainer card from the Charizard deck using the EffectDSL system.
 * Trainers: Dawn, Iono, Boss's Orders, Briar, Buddy-Buddy Poffin, Nest Ball,
 * Prime Catcher, Super Rod, Night Stretcher, Ultra Ball, Area Zero Underdepths.
 * Rare Candy stays legacy (tested in game-engine.test.ts).
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
  it('Dawn: searches 1 Basic + 1 Stage1 + 1 Stage2/ex from deck to hand', () => {
    const state = createRealState();
    const trainer = findTrainerInDeck('Dawn');
    assert.ok(trainer.effects, 'Dawn should have DSL effects');

    // Count cards matching each stage in deck before
    const player = state.players[0];
    const basicsInDeck = player.deck.filter(c => c.cardType === CardType.Pokemon && (c as PokemonCard).stage === PokemonStage.Basic).length;
    const stage1InDeck = player.deck.filter(c => c.cardType === CardType.Pokemon && (c as PokemonCard).stage === PokemonStage.Stage1).length;
    const stage2exInDeck = player.deck.filter(c => c.cardType === CardType.Pokemon && ((c as PokemonCard).stage === PokemonStage.Stage2 || (c as PokemonCard).stage === PokemonStage.ex)).length;

    const handBefore = player.hand.length;
    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    const expectedCards = Math.min(1, basicsInDeck) + Math.min(1, stage1InDeck) + Math.min(1, stage2exInDeck);
    assert.equal(after.players[0].hand.length, handBefore + expectedCards);
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
  // "If your Tera Pokemon Knocks Out your opponent's Active Pokemon during this turn, take 1 more Prize card."
  it('Briar: adds briarExtraPrize game flag', () => {
    const state = createRealState();
    const trainer = findTrainerInDeck('Briar');
    assert.ok(trainer.effects, 'Briar should have DSL effects');
    const flagsBefore = state.gameFlags.length;

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    assert.equal(after.gameFlags.length, flagsBefore + 1);
    assert.equal(after.gameFlags[after.gameFlags.length - 1].flag, 'briarExtraPrize');
    assert.equal(after.gameFlags[after.gameFlags.length - 1].duration, 'nextTurn');
  });

  // ---------- Buddy-Buddy Poffin ----------
  // "Search your deck for up to 2 Basic Pokemon with 70 HP or less, and put them onto your Bench."
  it('Buddy-Buddy Poffin: up to 2 Basic HP<=70 placed on bench from deck', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Buddy-Buddy Poffin');
    assert.ok(trainer.effects, 'Buddy-Buddy Poffin should have DSL effects');

    // Count eligible Pokemon in deck
    const eligibleInDeck = state.players[0].deck.filter(c =>
      c.cardType === CardType.Pokemon &&
      (c as PokemonCard).stage === PokemonStage.Basic &&
      (c as PokemonCard).hp <= 70
    ).length;
    const benchBefore = state.players[0].bench.length;
    const deckBefore = state.players[0].deck.length;

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    const benchSpace = 5 - benchBefore;
    const expectedAdded = Math.min(2, eligibleInDeck, benchSpace);
    assert.equal(after.players[0].bench.length, benchBefore + expectedAdded);
    assert.equal(after.players[0].deck.length, deckBefore - expectedAdded);

    // Verify placed Pokemon are Basic with HP <= 70
    for (let i = benchBefore; i < after.players[0].bench.length; i++) {
      const placed = after.players[0].bench[i];
      assert.equal(placed.card.stage, PokemonStage.Basic);
      assert.ok(placed.card.hp <= 70, `Placed Pokemon ${placed.card.name} HP ${placed.card.hp} should be <= 70`);
      assert.equal(placed.currentHp, placed.card.hp, 'Should be at full HP');
    }
  });

  // ---------- Nest Ball ----------
  // "Search your deck for a Basic Pokemon and put it onto your Bench."
  it('Nest Ball: 1 Basic Pokemon placed on bench from deck', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Nest Ball');
    assert.ok(trainer.effects, 'Nest Ball should have DSL effects');

    const basicsInDeck = state.players[0].deck.filter(c =>
      c.cardType === CardType.Pokemon && (c as PokemonCard).stage === PokemonStage.Basic
    ).length;
    const benchBefore = state.players[0].bench.length;

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    if (basicsInDeck > 0 && benchBefore < 5) {
      assert.equal(after.players[0].bench.length, benchBefore + 1);
      const placed = after.players[0].bench[after.players[0].bench.length - 1];
      assert.equal(placed.card.stage, PokemonStage.Basic);
      assert.equal(placed.currentHp, placed.card.hp);
    }
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
  it('Ultra Ball: discard 2 from hand, search 1 Pokemon from deck to hand', () => {
    let state = createRealState();
    const trainer = findTrainerInDeck('Ultra Ball');
    assert.ok(trainer.effects, 'Ultra Ball should have DSL effects');

    const handBefore = state.players[0].hand.length;
    const deckBefore = state.players[0].deck.length;
    const pokemonInDeck = state.players[0].deck.filter(c => c.cardType === CardType.Pokemon).length;

    const after = EffectExecutor.executeTrainer(state, trainer.effects!, 0);

    // Hand: -2 (discard cost) +1 (searched Pokemon) = net -1
    const expectedPokemon = Math.min(1, pokemonInDeck);
    assert.equal(after.players[0].hand.length, handBefore - 2 + expectedPokemon);
    assert.equal(after.players[0].discard.length, 2, 'Should have discarded 2 cards');
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
  it('Dawn via PlayTrainer action: searches cards from deck', () => {
    let state = createRealState();
    state = setupMainPhase(state, 0);
    state = putTrainerInHand(state, 0, 'Dawn');
    const handBefore = state.players[0].hand.length;

    const dawnIndex = state.players[0].hand.findIndex(c => c.name === 'Dawn');
    assert.ok(dawnIndex >= 0, 'Dawn should be in hand');

    const action = {
      type: ActionType.PlayTrainer,
      player: 0 as 0 | 1,
      payload: { handIndex: dawnIndex },
    };
    const after = GameEngine.applyAction(state, action);

    // Dawn was removed from hand (-1), then cards were searched (+up to 3)
    // Net: hand >= handBefore - 1 (Dawn discarded) and hand <= handBefore + 2 (Dawn discarded + 3 found)
    assert.ok(after.players[0].hand.length >= handBefore - 1, 'Hand should not decrease by more than 1');
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

  it('Nest Ball via PlayTrainer action: places Basic on bench', () => {
    let state = createRealState();
    state = setupMainPhase(state, 0);
    state = putTrainerInHand(state, 0, 'Nest Ball');
    const benchBefore = state.players[0].bench.length;

    const nestIndex = state.players[0].hand.findIndex(c => c.name === 'Nest Ball');
    const action = {
      type: ActionType.PlayTrainer,
      player: 0 as 0 | 1,
      payload: { handIndex: nestIndex },
    };
    const after = GameEngine.applyAction(state, action);

    if (benchBefore < 5) {
      assert.ok(after.players[0].bench.length > benchBefore, 'Should have added to bench');
    }
  });
});

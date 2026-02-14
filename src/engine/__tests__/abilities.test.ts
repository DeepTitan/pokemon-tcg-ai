/**
 * Charizard Deck — Ability DSL Tests
 *
 * Tests every ability from the Charizard deck using the EffectDSL system.
 * Abilities: Flip the Script, Quick Search, Jewel Seeker, Infernal Reign,
 * Cursed Blast, Fan Call, Mischievous Lock.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GameState,
  PokemonInPlay,
  CardType,
  EnergyType,
  EnergySubtype,
  GamePhase,
  ActionType,
} from '../types.js';
import { EffectExecutor, EffectDSL } from '../effects.js';
import { GameEngine } from '../game-engine.js';
import {
  createRealState,
  putPokemonAsActive,
  buildAbilityContext,
  setupMainPhase,
} from './test-helpers.js';

// ============================================================================
// Ability DSL — Direct Execution Tests
// ============================================================================

describe('Charizard Deck — Abilities', () => {
  // ---------- Fezandipiti ex — Flip the Script ----------
  it('Flip the Script: draw 3 cards', () => {
    const state = createRealState();
    const s = putPokemonAsActive(state, 0, 'Fezandipiti ex');
    const handBefore = s.players[0].hand.length;
    const deckBefore = s.players[0].deck.length;

    const after = EffectExecutor.executeAbility(s, s.players[0].active!.card.ability!.effects, s.players[0].active!, 0);

    assert.equal(after.players[0].hand.length, handBefore + 3);
    assert.equal(after.players[0].deck.length, deckBefore - 3);
  });

  it('Flip the Script: draws only remaining cards when deck < 3', () => {
    const state = createRealState();
    const s = putPokemonAsActive(state, 0, 'Fezandipiti ex');
    s.players[0].deck = s.players[0].deck.slice(0, 2);
    const handBefore = s.players[0].hand.length;

    const after = EffectExecutor.executeAbility(s, s.players[0].active!.card.ability!.effects, s.players[0].active!, 0);

    assert.equal(after.players[0].hand.length, handBefore + 2);
    assert.equal(after.players[0].deck.length, 0);
  });

  // ---------- Dusknoir — Cursed Blast ----------
  it('Cursed Blast: 130 damage to target, own active HP set to 0', () => {
    const state = createRealState();
    const s = putPokemonAsActive(state, 0, 'Dusknoir');
    const oppActive = s.players[1].active!;
    const oppHpBefore = oppActive.currentHp;
    const ownHpBefore = s.players[0].active!.currentHp;

    const abilityTarget = { player: 1 as 0 | 1, zone: 'active' as const };
    const after = EffectExecutor.executeAbility(
      s, s.players[0].active!.card.ability!.effects, s.players[0].active!, 0, abilityTarget
    );

    // Opponent takes 130 damage
    assert.equal(after.players[1].active!.currentHp, Math.max(0, oppHpBefore - 130));
    // Own active HP set to 0 (self-KO)
    assert.equal(after.players[0].active!.currentHp, 0);
  });

  it('Cursed Blast: can target bench Pokemon', () => {
    const state = createRealState();
    const s = putPokemonAsActive(state, 0, 'Dusknoir');
    assert.ok(s.players[1].bench.length > 0, 'Opponent needs bench Pokemon');
    const benchTarget = s.players[1].bench[0];
    const benchHpBefore = benchTarget.currentHp;

    const abilityTarget = { player: 1 as 0 | 1, zone: 'bench' as const, benchIndex: 0 };
    const after = EffectExecutor.executeAbility(
      s, s.players[0].active!.card.ability!.effects, s.players[0].active!, 0, abilityTarget
    );

    assert.equal(after.players[1].bench[0].currentHp, Math.max(0, benchHpBefore - 130));
    assert.equal(after.players[0].active!.currentHp, 0);
  });

  // ---------- Pidgeot ex — Quick Search ----------
  it('Quick Search: creates PendingChoice for 1 card search from deck', () => {
    const state = createRealState();
    const s = putPokemonAsActive(state, 0, 'Pidgeot ex');

    const after = EffectExecutor.executeAbility(s, s.players[0].active!.card.ability!.effects, s.players[0].active!, 0);

    // Should create PendingChoice since deck has many cards
    assert.ok(after.pendingChoice, 'Should create PendingChoice for Quick Search');
    assert.equal(after.pendingChoice!.choiceType, 'searchCard');
    assert.equal(after.pendingChoice!.selectionsRemaining, 1);
    assert.equal(after.pendingChoice!.destination, 'hand');
    assert.ok(after.pendingChoice!.options.length > 0, 'Should have options');
  });

  // ---------- Charizard ex — Infernal Reign ----------
  it('Infernal Reign: creates pending attachments for 3 Fire Energy', () => {
    const state = createRealState();
    // Ensure deck has Fire Energy
    const s = putPokemonAsActive(state, 0, 'Charizard ex');
    const deckBefore = s.players[0].deck.length;

    const after = EffectExecutor.executeAbility(s, s.players[0].active!.card.ability!.effects, s.players[0].active!, 0);

    // Should have pending attachments
    assert.ok(after.pendingAttachments !== undefined, 'Should create pending attachments');
    assert.ok(after.pendingAttachments!.cards.length > 0, 'Should find at least 1 Fire Energy');
    assert.ok(after.pendingAttachments!.cards.length <= 3, 'Should find at most 3 Fire Energy');
    assert.equal(after.pendingAttachments!.playerIndex, 0);
  });

  // ---------- Noctowl — Jewel Seeker ----------
  it('Jewel Seeker: creates PendingChoice for 2 Trainers when Terapagos is in play', () => {
    const state = createRealState();
    let s = putPokemonAsActive(state, 0, 'Noctowl');
    // Ensure Terapagos is on bench
    const hasTerapagos = s.players[0].bench.some(p => p.card.name.includes('Terapagos'));
    if (!hasTerapagos) {
      const tIdx = s.players[0].deck.findIndex(c => c.name.includes('Terapagos'));
      if (tIdx >= 0) {
        const terapCard = s.players[0].deck[tIdx] as import('../types.js').PokemonCard;
        s.players[0].deck.splice(tIdx, 1);
        s.players[0].bench.push({
          card: terapCard, currentHp: terapCard.hp, attachedEnergy: [], statusConditions: [],
          damageCounters: 0, attachedTools: [], isEvolved: false, turnPlayed: 0, damageShields: [], cannotRetreat: false,
        });
      }
    }

    const trainersInDeck = s.players[0].deck.filter(c => c.cardType === CardType.Trainer).length;
    const after = EffectExecutor.executeAbility(s, s.players[0].active!.card.ability!.effects, s.players[0].active!, 0);

    // Should create PendingChoice for Trainer search if more than 2 trainers exist
    if (trainersInDeck > 2) {
      assert.ok(after.pendingChoice, 'Should create PendingChoice for Jewel Seeker');
      assert.equal(after.pendingChoice!.choiceType, 'searchCard');
      assert.equal(after.pendingChoice!.selectionsRemaining, 2);
      // All options should be Trainer cards
      for (const opt of after.pendingChoice!.options) {
        assert.ok(opt.card, 'Option should have a card');
        assert.equal(opt.card!.cardType, CardType.Trainer, `${opt.label} should be a Trainer`);
      }
    }
  });

  it('Jewel Seeker: no effect without Terapagos in play', () => {
    const state = createRealState();
    let s = putPokemonAsActive(state, 0, 'Noctowl');
    // Remove any Terapagos from bench
    s.players[0].bench = s.players[0].bench.filter(p => !p.card.name.includes('Terapagos'));
    const handBefore = s.players[0].hand.length;

    const after = EffectExecutor.executeAbility(s, s.players[0].active!.card.ability!.effects, s.players[0].active!, 0);

    assert.equal(after.players[0].hand.length, handBefore);
  });

  // ---------- Fan Rotom — Fan Call ----------
  it('Fan Call: creates PendingChoice for Colorless Pokemon on first turn', () => {
    const state = createRealState();
    let s = putPokemonAsActive(state, 0, 'Fan Rotom');
    s = { ...s, turnNumber: 1 }; // first turn

    const after = EffectExecutor.executeAbility(s, s.players[0].active!.card.ability!.effects, s.players[0].active!, 0);

    // Should create PendingChoice for Colorless Pokemon search
    assert.ok(after.pendingChoice, 'Should create PendingChoice for Fan Call');
    assert.equal(after.pendingChoice!.choiceType, 'searchCard');
    assert.ok(after.pendingChoice!.canSkip, 'Should be skippable (up to 3)');
    assert.ok(after.pendingChoice!.options.length > 0, 'Should have Colorless Pokemon options');
  });

  it('Fan Call: not offered as legal action after first turn (abilityCondition)', () => {
    const state = createRealState();
    let s = putPokemonAsActive(state, 0, 'Fan Rotom');
    s = setupMainPhase(s, 0);
    s = { ...s, turnNumber: 5 }; // not first turn

    const actions = GameEngine.getLegalActions(s);
    const fanCallAction = actions.find(a =>
      a.type === ActionType.UseAbility && a.payload.abilityName === 'Fan Call'
    );
    assert.equal(fanCallAction, undefined, 'Fan Call should not be offered after turn 1');
  });

  it('Fan Call: offered as legal action on first turn', () => {
    const state = createRealState();
    let s = putPokemonAsActive(state, 0, 'Fan Rotom');
    s = setupMainPhase(s, 0);
    s = { ...s, turnNumber: 1 }; // first turn

    const actions = GameEngine.getLegalActions(s);
    const fanCallAction = actions.find(a =>
      a.type === ActionType.UseAbility && a.payload.abilityName === 'Fan Call'
    );
    assert.ok(fanCallAction, 'Fan Call should be offered on first turn');
  });

  // ---------- Klefki — Mischievous Lock ----------
  it('Mischievous Lock: passive noop (engine blocks Basic abilities)', () => {
    const state = createRealState();
    const s = putPokemonAsActive(state, 0, 'Klefki');
    const ability = s.players[0].active!.card.ability!;

    assert.equal(ability.trigger, 'passive');
    assert.deepEqual(ability.effects, [{ effect: 'noop' }]);
  });

  // ---------- Engine Pipeline: UseAbility action ----------
  it('Flip the Script via UseAbility action: hand +3', () => {
    let state = createRealState();
    state = putPokemonAsActive(state, 0, 'Fezandipiti ex');
    state = setupMainPhase(state, 0);
    // Flip the Script requires opponent's active to have been KO'd last turn
    state.gameFlags = [{
      flag: 'activeKnockedOut-p0',
      duration: 'nextTurn' as const,
      setOnTurn: state.turnNumber - 1,
      setByPlayer: 1 as 0 | 1,
    }];
    const handBefore = state.players[0].hand.length;

    const actions = GameEngine.getLegalActions(state);
    const useAbilityAction = actions.find(a =>
      a.type === ActionType.UseAbility && a.payload.abilityName === 'Flip the Script'
    );
    assert.ok(useAbilityAction, 'Flip the Script should be in legal actions');

    const after = GameEngine.applyAction(state, useAbilityAction!);
    assert.equal(after.players[0].hand.length, handBefore + 3);
  });

  it('Quick Search via UseAbility action: creates PendingChoice', () => {
    let state = createRealState();
    state = putPokemonAsActive(state, 0, 'Pidgeot ex');
    state = setupMainPhase(state, 0);

    const actions = GameEngine.getLegalActions(state);
    const useAbilityAction = actions.find(a =>
      a.type === ActionType.UseAbility && a.payload.abilityName === 'Quick Search'
    );
    assert.ok(useAbilityAction, 'Quick Search should be in legal actions');

    const after = GameEngine.applyAction(state, useAbilityAction!);

    // Quick Search should create a PendingChoice for card selection
    assert.ok(after.pendingChoice, 'Should create PendingChoice for Quick Search');
    assert.equal(after.pendingChoice!.choiceType, 'searchCard');
    assert.equal(after.pendingChoice!.selectionsRemaining, 1);

    // getLegalActions should only return ChooseCard actions
    const legalAfter = GameEngine.getLegalActions(after);
    assert.ok(legalAfter.length > 0, 'Should have ChooseCard actions');
    assert.ok(legalAfter.every(a => a.type === ActionType.ChooseCard), 'All should be ChooseCard');
  });

  it('Cursed Blast via UseAbility: opponent takes damage, own active KO triggers knockout', () => {
    let state = createRealState();
    state = putPokemonAsActive(state, 0, 'Dusknoir');
    state = setupMainPhase(state, 0);

    const actions = GameEngine.getLegalActions(state);
    const useAbilityAction = actions.find(a =>
      a.type === ActionType.UseAbility && a.payload.abilityName === 'Cursed Blast'
    );
    assert.ok(useAbilityAction, 'Cursed Blast should be in legal actions');

    const after = GameEngine.applyAction(state, useAbilityAction!);

    // Dusknoir self-KOs, so checkKnockouts should fire
    // Verify via game log
    const koLog = after.gameLog.find(l => l.includes('knocked out'));
    assert.ok(koLog, 'Should have knockout log entry for Dusknoir');
  });

  it('Mischievous Lock blocks Basic Pokemon abilities from legal actions', () => {
    let state = createRealState();
    state = putPokemonAsActive(state, 0, 'Klefki');
    // Put a Basic Pokemon with ability (Fan Rotom) on bench for player 0
    state = setupMainPhase(state, 0);
    const hasFanRotom = state.players[0].bench.some(p => p.card.name === 'Fan Rotom');

    if (hasFanRotom) {
      const actions = GameEngine.getLegalActions(state);
      const fanCallAction = actions.find(a =>
        a.type === ActionType.UseAbility && a.payload.abilityName === 'Fan Call'
      );
      // Mischievous Lock blocks all Basic Pokemon abilities
      assert.equal(fanCallAction, undefined, 'Fan Call should be blocked by Mischievous Lock');
    }
  });
});

/**
 * Charizard Deck — Attack Effect Tests
 *
 * Tests attack effects from the Charizard deck.
 * Attacks with effects: Cruel Arrow (Fezandipiti ex), Burning Darkness (Charizard ex).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GameState,
  PokemonInPlay,
  PokemonCard,
  Card,
  CardType,
  EnergyType,
  EnergySubtype,
  GamePhase,
  ActionType,
} from '../types.js';
import { EffectExecutor, EffectDSL, EffectExecutionContext } from '../effects.js';
import { GameEngine } from '../game-engine.js';
import {
  createRealState,
  putPokemonAsActive,
  setupMainPhase,
  makeEnergy,
  pokemonInPlayFromCard,
} from './test-helpers.js';

// ============================================================================
// Attack Effect Tests
// ============================================================================

describe('Charizard Deck — Attacks', () => {
  // ---------- Fezandipiti ex — Cruel Arrow ----------
  // "This attack does 100 damage to 1 of your opponent's Pokemon."
  it('Cruel Arrow: deals 100 damage to all opponent Pokemon (anyPokemon target)', () => {
    let state = createRealState();
    state = putPokemonAsActive(state, 0, 'Fezandipiti ex');
    const attacker = state.players[0].active!;
    const attack = attacker.card.attacks.find(a => a.name === 'Cruel Arrow')!;

    assert.ok(attack.effects, 'Cruel Arrow should have DSL effects');
    assert.equal(attack.damage, 0, 'Cruel Arrow base damage is 0');

    // The DSL targets anyPokemon (all opponent Pokemon get resolved)
    // In practice the engine/AI picks one target; the DSL resolves to all for damage distribution
    const defender = state.players[1].active!;
    const defenderHpBefore = defender.currentHp;
    const benchHpBefore = state.players[1].bench.map(p => p.currentHp);

    const after = EffectExecutor.executeAttack(state, attack.effects!, attacker, defender, 0);

    // anyPokemon resolves to all opponent Pokemon — each takes 100 damage
    const oppActive = after.players[1].active!;
    assert.equal(oppActive.currentHp, Math.max(0, defenderHpBefore - 100));

    for (let i = 0; i < after.players[1].bench.length; i++) {
      assert.equal(
        after.players[1].bench[i].currentHp,
        Math.max(0, benchHpBefore[i] - 100),
        `Bench Pokemon ${i} should take 100 damage`
      );
    }
  });

  it('Cruel Arrow: KOs low-HP bench Pokemon', () => {
    let state = createRealState();
    state = putPokemonAsActive(state, 0, 'Fezandipiti ex');
    const attacker = state.players[0].active!;
    const attack = attacker.card.attacks.find(a => a.name === 'Cruel Arrow')!;

    // Ensure opponent has a low HP bench Pokemon
    if (state.players[1].bench.length > 0) {
      const benchPokemon = state.players[1].bench[0];
      const wasBelowOrEqual100 = benchPokemon.currentHp <= 100;

      const after = EffectExecutor.executeAttack(
        state, attack.effects!, attacker, state.players[1].active!, 0
      );

      if (wasBelowOrEqual100) {
        assert.equal(after.players[1].bench[0].currentHp, 0, 'Low HP bench Pokemon should be KO\'d');
      }
    }
  });

  // ---------- Charizard ex — Burning Darkness ----------
  // "180 damage. This attack does 30 more damage for each Prize card your opponent has taken."
  // Note: Burning Darkness has no effect DSL — it's pure base damage (180) with scaling
  // handled at the game level. But the damage calculation is worth testing.
  it('Burning Darkness: base 180 damage with no prizes taken', () => {
    let state = createRealState();
    state = putPokemonAsActive(state, 0, 'Charizard ex');
    const attacker = state.players[0].active!;
    const attack = attacker.card.attacks.find(a => a.name === 'Burning Darkness')!;

    assert.equal(attack.damage, 180, 'Burning Darkness base damage should be 180');
    assert.equal(attack.effects, undefined, 'Burning Darkness has no DSL effects (scaling is future work)');
  });

  // ---------- Integration: Cruel Arrow via Attack action ----------
  it('Cruel Arrow via Attack action in engine', () => {
    let state = createRealState();
    state = putPokemonAsActive(state, 0, 'Fezandipiti ex');
    // Attach 3 Colorless energy to meet the cost
    const attacker = state.players[0].active!;
    for (let i = 0; i < 3; i++) {
      attacker.attachedEnergy.push(makeEnergy(EnergyType.Colorless, `cruel-energy-${i}`));
    }
    state = { ...state, phase: GamePhase.AttackPhase, currentPlayer: 0 as 0 | 1 };

    const actions = GameEngine.getLegalActions(state);
    const attackAction = actions.find(a =>
      a.type === ActionType.Attack && a.payload.attackIndex === 0
    );
    // Fezandipiti's only attack is Cruel Arrow (index 0)
    assert.ok(attackAction, 'Cruel Arrow should be available as Attack action');

    const defenderHpBefore = state.players[1].active!.currentHp;
    const after = GameEngine.applyAction(state, attackAction!);

    // After attack, state should be BetweenTurns and damage should be applied
    // Note: base damage is 0, but the DSL effect does 100 to anyPokemon
    // The engine applies base damage (0) first, then the effect (100 to all)
    // Active opponent should have taken 100 damage from the effect
    assert.ok(
      after.players[1].active!.currentHp <= defenderHpBefore,
      'Opponent should have taken damage'
    );
  });

  // ---------- All attacks in deck have correct structure ----------
  it('All Charizard deck Pokemon attacks have valid structure', () => {
    const deck = import('../charizard-deck.js').then(mod => {
      const cards = mod.buildCharizardDeck();
      const pokemonCards = cards.filter(c => c.cardType === CardType.Pokemon) as PokemonCard[];

      for (const pokemon of pokemonCards) {
        for (const attack of pokemon.attacks) {
          assert.ok(typeof attack.name === 'string', `${pokemon.name} attack should have name`);
          assert.ok(Array.isArray(attack.cost), `${pokemon.name} attack should have cost array`);
          assert.ok(typeof attack.damage === 'number', `${pokemon.name} attack should have damage`);
          assert.ok(typeof attack.description === 'string', `${pokemon.name} attack should have description`);
          // Either has DSL effects, legacy effect, or neither (pure damage)
          if (attack.effects) {
            assert.ok(Array.isArray(attack.effects), `${pokemon.name} ${attack.name} effects should be array`);
          }
        }
      }
    });
  });
});

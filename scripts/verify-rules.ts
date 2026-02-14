#!/usr/bin/env node
/**
 * Pokemon TCG AI — Game Engine Rule Verification Script
 *
 * Runs simulations and audits every state transition for rule violations.
 * Combines automated invariant checks with verbose game transcripts
 * for manual reasoning about edge cases.
 *
 * Usage:
 *   npx tsx scripts/verify-rules.ts                    # run 20 seeds
 *   npx tsx scripts/verify-rules.ts --seeds 50         # run 50 seeds
 *   npx tsx scripts/verify-rules.ts --seed 42          # single seed, full transcript
 *   npx tsx scripts/verify-rules.ts --verbose          # full transcripts for all seeds
 */

import { GameEngine } from '../src/engine/game-engine.js';
import {
  GameState,
  GamePhase,
  ActionType,
  Action,
  PokemonInPlay,
  CardType,
  EnergyType,
  EnergyCard,
  PokemonCard,
  PokemonStage,
  TrainerCard,
  TrainerType,
  Card,
} from '../src/engine/types.js';
import { buildCharizardDeck } from '../src/engine/charizard-deck.js';
import { heuristicSelectAction } from '../src/ai/heuristic.js';

// ============================================================================
// TYPES
// ============================================================================

interface Violation {
  seed: number;
  turn: number;
  phase: string;
  category: string;
  message: string;
}

interface GameResult {
  seed: number;
  turns: number;
  winner: number | null;
  winCondition: string;
  violations: Violation[];
  transcript: string[];
}

// ============================================================================
// CONFIG
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    seedCount: 20,
    singleSeed: null as number | null,
    verbose: false,
    maxTurns: 60,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seeds' && args[i + 1]) config.seedCount = parseInt(args[++i], 10);
    if (args[i] === '--seed' && args[i + 1]) {
      config.singleSeed = parseInt(args[++i], 10);
      config.verbose = true;
    }
    if (args[i] === '--verbose') config.verbose = true;
    if (args[i] === '--turns' && args[i + 1]) config.maxTurns = parseInt(args[++i], 10);
  }

  return config;
}

// ============================================================================
// INVARIANT CHECKS
// ============================================================================

function countPokemonCards(pokemon: PokemonInPlay): number {
  // Count the Pokemon card itself, its attached energy, tools, and previousStage Pokemon cards.
  // When a Pokemon evolves, attachedEnergy/tools carry forward to the evolved form,
  // but previousStage still references the old PokemonInPlay which has the SAME energy/tools.
  // So we only count previousStage's Pokemon card(s), NOT its energy/tools (they're already counted).
  let count = 1; // the Pokemon card
  count += pokemon.attachedEnergy.length;
  count += pokemon.attachedTools.length;
  if (pokemon.previousStage) {
    count += countPreviousStagePokemonCards(pokemon.previousStage);
  }
  return count;
}

function countPreviousStagePokemonCards(pokemon: PokemonInPlay): number {
  // Only count the Pokemon card itself (not energy/tools — those belong to the evolved form)
  let count = 1;
  if (pokemon.previousStage) {
    count += countPreviousStagePokemonCards(pokemon.previousStage);
  }
  return count;
}

function countAllCards(state: GameState, playerIndex: 0 | 1): { total: number; breakdown: string } {
  const p = state.players[playerIndex];
  const hand = p.hand.length;
  const deck = p.deck.length;
  const discard = p.discard.length;
  const prizes = p.prizes.length;
  const lostZone = p.lostZone.length;

  // Count Pokemon in play including their attached energy/tools and previousStage cards
  let inPlay = 0;
  if (p.active) inPlay += countPokemonCards(p.active);
  for (const b of p.bench) inPlay += countPokemonCards(b);

  // Count pending attachments (cards removed from deck but not yet attached)
  let pending = 0;
  if (state.pendingAttachments && state.pendingAttachments.playerIndex === playerIndex) {
    pending = state.pendingAttachments.cards.length;
  }

  // Count stadium card if it belongs to this player (check card ID prefix)
  let stadium = 0;
  if (state.stadium && state.stadium.id.startsWith(`p${playerIndex}-`)) {
    stadium = 1;
  }

  const total = hand + deck + discard + prizes + lostZone + inPlay + pending + stadium;
  const breakdown = `hand=${hand} deck=${deck} discard=${discard} prizes=${prizes} inPlay=${inPlay} lost=${lostZone} pending=${pending} stadium=${stadium}`;
  return { total, breakdown };
}

function checkInvariants(state: GameState, seed: number, context: string): Violation[] {
  const violations: Violation[] = [];
  const v = (category: string, message: string) => {
    violations.push({ seed, turn: state.turnNumber, phase: state.phase, category, message: `[${context}] ${message}` });
  };

  // 1. Card conservation
  for (const pi of [0, 1] as const) {
    const { total, breakdown } = countAllCards(state, pi);
    if (total !== 60) {
      v('CARD_CONSERVATION', `P${pi} has ${total} cards (expected 60). ${breakdown}`);
    }
  }

  // 2. HP bounds
  for (const pi of [0, 1] as const) {
    const p = state.players[pi];
    if (p.active) {
      if (p.active.currentHp > p.active.card.hp) {
        v('HP_BOUNDS', `P${pi} active ${p.active.card.name} has HP ${p.active.currentHp} > max ${p.active.card.hp}`);
      }
      if (p.active.currentHp < 0) {
        v('HP_BOUNDS', `P${pi} active ${p.active.card.name} has HP ${p.active.currentHp} < 0`);
      }
    }
    for (const b of p.bench) {
      if (b.currentHp > b.card.hp) {
        v('HP_BOUNDS', `P${pi} bench ${b.card.name} has HP ${b.currentHp} > max ${b.card.hp}`);
      }
      if (b.currentHp < 0) {
        v('HP_BOUNDS', `P${pi} bench ${b.card.name} has HP ${b.currentHp} < 0`);
      }
    }
  }

  // 3. Prize accounting
  for (const pi of [0, 1] as const) {
    const p = state.players[pi];
    if (p.prizeCardsRemaining !== p.prizes.length) {
      v('PRIZE_ACCOUNTING', `P${pi} prizeCardsRemaining=${p.prizeCardsRemaining} but prizes.length=${p.prizes.length}`);
    }
  }

  // 4. No duplicate card IDs within a player
  for (const pi of [0, 1] as const) {
    const p = state.players[pi];
    const allIds: string[] = [];
    p.hand.forEach(c => allIds.push(c.id));
    p.deck.forEach(c => allIds.push(c.id));
    p.discard.forEach(c => allIds.push(c.id));
    p.prizes.forEach(c => allIds.push(c.id));
    if (p.active) {
      allIds.push(p.active.card.id);
      p.active.attachedEnergy.forEach(e => allIds.push(e.id));
    }
    for (const b of p.bench) {
      allIds.push(b.card.id);
      b.attachedEnergy.forEach(e => allIds.push(e.id));
    }

    const seen = new Set<string>();
    for (const id of allIds) {
      if (seen.has(id)) {
        v('DUPLICATE_ID', `P${pi} has duplicate card ID: ${id}`);
      }
      seen.add(id);
    }
  }

  // 5. Active Pokemon with 0 HP should have been knocked out
  for (const pi of [0, 1] as const) {
    const p = state.players[pi];
    if (p.active && p.active.currentHp <= 0 && state.phase !== GamePhase.BetweenTurns) {
      // Allow during BetweenTurns since knockout check happens there
      v('ZOMBIE_POKEMON', `P${pi} active ${p.active.card.name} has ${p.active.currentHp} HP but is still active in phase ${state.phase}`);
    }
  }

  // 6. Bench size
  for (const pi of [0, 1] as const) {
    if (state.players[pi].bench.length > 5) {
      v('BENCH_OVERFLOW', `P${pi} has ${state.players[pi].bench.length} bench Pokemon (max 5)`);
    }
  }

  return violations;
}

// ============================================================================
// ATTACK AUDIT
// ============================================================================

function auditAttack(
  stateBefore: GameState,
  stateAfter: GameState,
  action: Action,
  seed: number
): { violations: Violation[]; log: string } {
  const violations: Violation[] = [];
  const pi = action.player;
  const oi = pi === 0 ? 1 : 0;
  const attacker = stateBefore.players[pi].active;
  const defender = stateBefore.players[oi].active;

  if (!attacker || !defender) return { violations, log: '' };

  const attack = attacker.card.attacks[action.payload.attackIndex];
  if (!attack) return { violations, log: '' };

  const defenderAfter = stateAfter.players[oi].active;
  const hpBefore = defender.currentHp;
  const hpAfter = defenderAfter ? defenderAfter.currentHp : 0;
  const actualDamage = hpBefore - hpAfter;

  // Calculate expected damage
  let expectedDamage = attack.damage;

  // Apply weakness based on attacker's Pokemon TYPE (not attack cost)
  if (defender.card.weakness === attacker.card.type) {
    expectedDamage *= 2;
  }

  // Apply resistance based on attacker's Pokemon TYPE
  if (defender.card.resistance === attacker.card.type) {
    const reduction = defender.card.resistanceValue || 20;
    expectedDamage = Math.max(0, expectedDamage - reduction);
  }

  const log = `  ATTACK: P${pi} ${attacker.card.name} uses ${attack.name} (base ${attack.damage}) → P${oi} ${defender.card.name} [HP ${hpBefore}→${hpAfter}, dmg=${actualDamage}, expected=${expectedDamage}]`;

  // Check: Weakness/resistance applied correctly?
  // NOTE: The current engine uses attack COST for weakness check, not Pokemon type.
  // We flag when these differ.
  const attackerType = attacker.card.type;
  const costTypes = new Set(attack.cost);
  const weaknessViaType = defender.card.weakness === attackerType;
  const weaknessViaCost = defender.card.weakness ? costTypes.has(defender.card.weakness) : false;
  // Check what the engine actually did — if weakness was applied, damage should be >= base*2
  if (weaknessViaType !== weaknessViaCost) {
    violations.push({
      seed, turn: stateBefore.turnNumber, phase: stateBefore.phase,
      category: 'WEAKNESS_MISMATCH',
      message: `${attacker.card.name}(type=${attackerType}) vs ${defender.card.name}(weak=${defender.card.weakness}). By type: weakness=${weaknessViaType}. By cost: weakness=${weaknessViaCost}. Cost types=[${[...costTypes]}]`,
    });
  }

  // Check: Burning Darkness bonus damage
  if (attack.name === 'Burning Darkness') {
    const prizesTaken = 6 - stateBefore.players[oi].prizeCardsRemaining;
    const expectedBonus = prizesTaken * 30;
    const expectedTotal = expectedDamage + expectedBonus;
    if (prizesTaken > 0 && actualDamage !== expectedTotal && actualDamage === expectedDamage) {
      violations.push({
        seed, turn: stateBefore.turnNumber, phase: stateBefore.phase,
        category: 'BURNING_DARKNESS_NO_BONUS',
        message: `Burning Darkness did ${actualDamage} but opponent took ${prizesTaken} prizes → expected ${expectedTotal} (base ${attack.damage} + weakness + ${expectedBonus} bonus)`,
      });
    }
  }

  // Check: Unified Beatdown bench scaling
  if (attack.name === 'Unified Beatdown') {
    const benchCount = stateBefore.players[pi].bench.length;
    const expectedBenchDamage = 30 + (30 * benchCount);
    if (benchCount > 0 && actualDamage !== expectedBenchDamage && actualDamage === expectedDamage) {
      violations.push({
        seed, turn: stateBefore.turnNumber, phase: stateBefore.phase,
        category: 'UNIFIED_BEATDOWN_NO_SCALING',
        message: `Unified Beatdown did ${actualDamage} but attacker has ${benchCount} bench → expected ${expectedBenchDamage} (30 base + ${benchCount}×30)`,
      });
    }
  }

  // Check: Blustering Gale should target bench, not active
  if (attack.name === 'Blustering Gale') {
    if (actualDamage > 0) {
      violations.push({
        seed, turn: stateBefore.turnNumber, phase: stateBefore.phase,
        category: 'BLUSTERING_GALE_WRONG_TARGET',
        message: `Blustering Gale dealt ${actualDamage} damage to ACTIVE Pokemon. Card text says it should target a BENCHED Pokemon.`,
      });
    }
  }

  // Check: Assault Landing should do nothing without opponent stadium
  if (attack.name === 'Assault Landing') {
    if (!stateBefore.stadium && actualDamage > 0) {
      violations.push({
        seed, turn: stateBefore.turnNumber, phase: stateBefore.phase,
        category: 'ASSAULT_LANDING_NO_STADIUM',
        message: `Assault Landing dealt ${actualDamage} damage but no Stadium in play. Card says "does nothing" without opponent's Stadium.`,
      });
    }
  }

  // Check: Shadow Bind retreat prevention
  if (attack.name === 'Shadow Bind') {
    const defAfter = stateAfter.players[oi].active;
    if (defAfter && !defAfter.cannotRetreat) {
      violations.push({
        seed, turn: stateBefore.turnNumber, phase: stateBefore.phase,
        category: 'SHADOW_BIND_NO_RETREAT_LOCK',
        message: `Shadow Bind hit but defender ${defAfter.card.name} can still retreat (cannotRetreat=${defAfter.cannotRetreat}). Card says "defending Pokemon cannot retreat."`,
      });
    }
  }

  return { violations, log };
}

// ============================================================================
// RETREAT AUDIT
// ============================================================================

function auditRetreat(
  stateBefore: GameState,
  stateAfter: GameState,
  action: Action,
  seed: number
): { violations: Violation[]; log: string } {
  const violations: Violation[] = [];
  const pi = action.player;
  const activeBefore = stateBefore.players[pi].active;

  if (!activeBefore) return { violations, log: '' };

  const retreatCost = activeBefore.card.retreatCost;
  const energyBefore = activeBefore.attachedEnergy.length;

  // Check if energy was added to discard pile
  const discardBefore = stateBefore.players[pi].discard.length;
  const discardAfter = stateAfter.players[pi].discard.length;
  const discardedCount = discardAfter - discardBefore;

  if (retreatCost > 0 && discardedCount === 0) {
    violations.push({
      seed, turn: stateBefore.turnNumber, phase: stateBefore.phase,
      category: 'RETREAT_ENERGY_LOST',
      message: `P${pi} retreated ${activeBefore.card.name} (cost=${retreatCost}) but discard pile didn't grow (${discardBefore}→${discardAfter}). Energy vanished from game.`,
    });
  }

  const log = `  RETREAT: P${pi} ${activeBefore.card.name} (cost=${retreatCost}, energy=${energyBefore}) → bench #${action.payload.benchIndex}. Discard: ${discardBefore}→${discardAfter}`;
  return { violations, log };
}

// ============================================================================
// GAME SIMULATION
// ============================================================================

function runGame(seed: number, maxTurns: number, verbose: boolean): GameResult {
  const deck1 = buildCharizardDeck();
  const deck2 = buildCharizardDeck();

  let state = GameEngine.createGame(deck1, deck2, seed);
  const violations: Violation[] = [];
  const transcript: string[] = [];

  const log = (msg: string) => {
    if (verbose) console.log(msg);
    transcript.push(msg);
  };

  log(`\n=== GAME SEED ${seed} ===`);
  log(`  First player: P${state.currentPlayer}`);

  // Check initial state
  violations.push(...checkInvariants(state, seed, 'initial'));

  let turnCount = 0;
  let lastTurnNumber = 0;

  while (!GameEngine.isGameOver(state) && turnCount < maxTurns * 2) {
    // Draw phase
    if (state.phase === GamePhase.DrawPhase) {
      const prevLogLen = state.gameLog.length;
      state = GameEngine.startTurn(state);

      if (state.turnNumber !== lastTurnNumber) {
        lastTurnNumber = state.turnNumber;
        log(`\n--- Turn ${state.turnNumber}, P${state.currentPlayer} ---`);

        // Log board state at start of turn
        for (const pi of [0, 1] as const) {
          const p = state.players[pi];
          const activeName = p.active ? `${p.active.card.name}(${p.active.currentHp}/${p.active.card.hp})` : 'none';
          const benchNames = p.bench.map(b => `${b.card.name}(${b.currentHp}/${b.card.hp})`).join(', ');
          log(`  P${pi}: Active=${activeName} Bench=[${benchNames}] Hand=${p.hand.length} Deck=${p.deck.length} Prizes=${p.prizeCardsRemaining}`);
        }
      }

      if (GameEngine.isGameOver(state)) break;
      violations.push(...checkInvariants(state, seed, 'after-draw'));
    }

    // Action loop
    let actionCount = 0;
    while (
      !GameEngine.isGameOver(state) &&
      state.phase !== GamePhase.DrawPhase &&
      state.phase !== GamePhase.BetweenTurns &&
      actionCount < 200
    ) {
      const actions = GameEngine.getLegalActions(state);
      if (actions.length === 0) break;

      const action = heuristicSelectAction(state, actions);
      const stateBefore = state;

      state = GameEngine.applyAction(state, action);
      actionCount++;

      // Audit specific action types
      if (action.type === ActionType.Attack) {
        const audit = auditAttack(stateBefore, state, action, seed);
        violations.push(...audit.violations);
        if (audit.log) log(audit.log);
      } else if (action.type === ActionType.Retreat) {
        const audit = auditRetreat(stateBefore, state, action, seed);
        violations.push(...audit.violations);
        if (audit.log) log(audit.log);
      } else if (action.type === ActionType.PlayTrainer) {
        const card = stateBefore.players[action.player].hand[action.payload.handIndex];
        if (card) {
          log(`  TRAINER: P${action.player} plays ${card.name}`);
        }
      } else if (action.type === ActionType.PlayPokemon) {
        const card = stateBefore.players[action.player].hand[action.payload.handIndex];
        if (card) {
          if (action.payload.targetZone) {
            log(`  EVOLVE: P${action.player} evolves ${action.payload.targetZone} into ${card.name}`);
          } else {
            log(`  BENCH: P${action.player} plays ${card.name} to bench`);
          }
        }
      } else if (action.type === ActionType.UseAbility) {
        log(`  ABILITY: P${action.player} uses ${action.payload.abilityName}`);
      } else if (action.type === ActionType.AttachEnergy) {
        const card = stateBefore.players[action.player].hand[action.payload.handIndex];
        log(`  ENERGY: P${action.player} attaches ${card?.name || '?'} to ${action.payload.target}${action.payload.benchIndex !== undefined ? ` #${action.payload.benchIndex}` : ''}`);
      } else if (action.type === ActionType.ChooseCard) {
        log(`  CHOICE: P${action.player} picks ${action.payload.label}`);
      }

      // Check invariants after every action
      const postViolations = checkInvariants(state, seed, `after-${action.type}`);
      violations.push(...postViolations);
    }

    // Between turns
    if (state.phase === GamePhase.BetweenTurns) {
      state = GameEngine.endTurn(state);
      violations.push(...checkInvariants(state, seed, 'after-endTurn'));
    }

    turnCount++;
  }

  // Determine win condition
  let winCondition = 'max_turns';
  const winner = GameEngine.getWinner(state);
  if (winner !== null) {
    if (state.players[winner].prizeCardsRemaining <= 0) {
      winCondition = 'prizes';
    } else {
      const loser = winner === 0 ? 1 : 0;
      if (!state.players[loser].active && state.players[loser].bench.length === 0) {
        winCondition = 'no_pokemon';
      } else if (state.players[loser].deck.length === 0) {
        winCondition = 'deck_out';
      }
    }
  }

  log(`\n  RESULT: ${winner !== null ? `P${winner} wins (${winCondition})` : `Draw (${maxTurns} turns)`} after ${state.turnNumber} turns`);

  // Log any new game log entries
  if (state.gameLog.length > 0) {
    log(`  Last game log entries:`);
    for (const entry of state.gameLog.slice(-5)) {
      log(`    ${entry}`);
    }
  }

  return {
    seed,
    turns: state.turnNumber,
    winner,
    winCondition,
    violations,
    transcript,
  };
}

// ============================================================================
// MAIN
// ============================================================================

const config = parseArgs();

const seeds: number[] = config.singleSeed !== null
  ? [config.singleSeed]
  : Array.from({ length: config.seedCount }, (_, i) => i);

console.log(`\nPokemon TCG AI — Rule Verification`);
console.log(`Running ${seeds.length} game(s)...\n`);

const allResults: GameResult[] = [];
const violationCounts: Record<string, number> = {};
let totalViolations = 0;

for (const seed of seeds) {
  const result = runGame(seed, config.maxTurns, config.verbose);
  allResults.push(result);

  for (const v of result.violations) {
    violationCounts[v.category] = (violationCounts[v.category] || 0) + 1;
    totalViolations++;
  }

  if (!config.verbose && result.violations.length > 0) {
    console.log(`  Seed ${seed}: ${result.violations.length} violation(s) — ${result.winCondition} in ${result.turns} turns`);
    for (const v of result.violations.slice(0, 5)) {
      console.log(`    [${v.category}] T${v.turn}: ${v.message}`);
    }
    if (result.violations.length > 5) {
      console.log(`    ... and ${result.violations.length - 5} more`);
    }
  } else if (!config.verbose) {
    console.log(`  Seed ${seed}: OK — ${result.winCondition} in ${result.turns} turns`);
  }
}

// Summary
console.log(`\n${'='.repeat(60)}`);
console.log(`SUMMARY: ${seeds.length} games, ${totalViolations} total violations`);
console.log(`${'='.repeat(60)}`);

if (totalViolations > 0) {
  console.log(`\nViolation breakdown:`);
  const sorted = Object.entries(violationCounts).sort((a, b) => b[1] - a[1]);
  for (const [category, count] of sorted) {
    console.log(`  ${category}: ${count}`);
  }

  // Print first occurrence of each category
  console.log(`\nFirst occurrence of each violation type:`);
  const seen = new Set<string>();
  for (const result of allResults) {
    for (const v of result.violations) {
      if (!seen.has(v.category)) {
        seen.add(v.category);
        console.log(`  [${v.category}] Seed ${v.seed}, Turn ${v.turn}: ${v.message}`);
      }
    }
  }
} else {
  console.log(`\nAll games passed all invariant checks.`);
}

// Game stats
const wins = [0, 0];
const winConditions: Record<string, number> = {};
for (const r of allResults) {
  if (r.winner !== null) wins[r.winner]++;
  winConditions[r.winCondition] = (winConditions[r.winCondition] || 0) + 1;
}
console.log(`\nGame statistics:`);
console.log(`  P0 wins: ${wins[0]}, P1 wins: ${wins[1]}, Draws: ${seeds.length - wins[0] - wins[1]}`);
console.log(`  Win conditions: ${JSON.stringify(winConditions)}`);
console.log(`  Avg turns: ${(allResults.reduce((s, r) => s + r.turns, 0) / allResults.length).toFixed(1)}`);
console.log('');

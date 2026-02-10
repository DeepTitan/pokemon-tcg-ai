#!/usr/bin/env node
/**
 * Pokemon TCG AI - Play Script
 *
 * Runs a real Charizard mirror match simulation using the game engine.
 * Outputs a turn-by-turn play-by-play in the terminal.
 *
 * Usage:
 *   npx tsx scripts/play.ts                    # AI vs AI (random)
 *   npx tsx scripts/play.ts --seed 42          # deterministic seed
 *   npx tsx scripts/play.ts --turns 30         # max turns
 *   npx tsx scripts/play.ts --verbose          # show every action
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
  PokemonCard,
} from '../src/engine/types.js';
import { buildCharizardDeck } from '../src/engine/charizard-deck.js';

// ============================================================================
// CONFIG
// ============================================================================

interface PlayConfig {
  seed: number;
  maxTurns: number;
  verbose: boolean;
  delayMs: number;
}

function parseArgs(): PlayConfig {
  const args = process.argv.slice(2);
  const config: PlayConfig = {
    seed: Math.floor(Math.random() * 100000),
    maxTurns: 50,
    verbose: false,
    delayMs: 0,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed' && args[i + 1]) config.seed = parseInt(args[++i], 10);
    if (args[i] === '--turns' && args[i + 1]) config.maxTurns = parseInt(args[++i], 10);
    if (args[i] === '--verbose') config.verbose = true;
    if (args[i] === '--delay' && args[i + 1]) config.delayMs = parseInt(args[++i], 10);
  }

  return config;
}

// ============================================================================
// DISPLAY HELPERS
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m',
};

function c(color: string, text: string): string {
  return `${color}${text}${COLORS.reset}`;
}

function hpBar(current: number, max: number, width: number = 20): string {
  const ratio = Math.max(0, current / max);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const color = ratio > 0.5 ? COLORS.green : ratio > 0.25 ? COLORS.yellow : COLORS.red;
  return `${color}${'█'.repeat(filled)}${COLORS.dim}${'░'.repeat(empty)}${COLORS.reset} ${current}/${max}`;
}

function formatPokemon(pokemon: PokemonInPlay | null, label: string): string {
  if (!pokemon) return `  ${label}: ${c(COLORS.dim, '(empty)')}\n`;

  const name = pokemon.card.isRulebox
    ? c(COLORS.bright + COLORS.yellow, pokemon.card.name)
    : c(COLORS.bright, pokemon.card.name);
  const hp = hpBar(pokemon.currentHp, pokemon.card.hp);
  const energy = pokemon.attachedEnergy.length > 0
    ? ` [${pokemon.attachedEnergy.map(e => e.energyType[0]).join('')}]`
    : '';
  const status = pokemon.statusConditions.length > 0
    ? ` ${c(COLORS.red, pokemon.statusConditions.join(', '))}`
    : '';
  const prizes = pokemon.card.prizeCards > 1
    ? c(COLORS.magenta, ` (${pokemon.card.prizeCards} prizes)`)
    : '';

  return `  ${label}: ${name}${prizes}${energy}${status}\n    HP: ${hp}\n`;
}

function printBoard(state: GameState): void {
  const p0 = state.players[0];
  const p1 = state.players[1];

  console.log(c(COLORS.bright, '\n╔══════════════════════════════════════════════════╗'));
  console.log(c(COLORS.bright, `║  Turn ${state.turnNumber}  |  Phase: ${state.phase}  |  Player ${state.currentPlayer + 1}'s turn`));
  console.log(c(COLORS.bright, '╠══════════════════════════════════════════════════╣'));

  // Player 1 (top)
  console.log(c(COLORS.cyan, `║ PLAYER 1  Prizes: ${'◆'.repeat(p0.prizeCardsRemaining)}${'◇'.repeat(6 - p0.prizeCardsRemaining)}  Hand: ${p0.hand.length}  Deck: ${p0.deck.length}`));
  process.stdout.write(formatPokemon(p0.active, 'Active'));
  if (p0.bench.length > 0) {
    const benchNames = p0.bench.map(b =>
      `${b.card.name}(${b.currentHp}/${b.card.hp})`
    ).join(', ');
    console.log(`  Bench: ${benchNames}`);
  }

  console.log(c(COLORS.dim, '║─────────────── vs ───────────────'));

  // Player 2 (bottom)
  console.log(c(COLORS.magenta, `║ PLAYER 2  Prizes: ${'◆'.repeat(p1.prizeCardsRemaining)}${'◇'.repeat(6 - p1.prizeCardsRemaining)}  Hand: ${p1.hand.length}  Deck: ${p1.deck.length}`));
  process.stdout.write(formatPokemon(p1.active, 'Active'));
  if (p1.bench.length > 0) {
    const benchNames = p1.bench.map(b =>
      `${b.card.name}(${b.currentHp}/${b.card.hp})`
    ).join(', ');
    console.log(`  Bench: ${benchNames}`);
  }

  console.log(c(COLORS.bright, '╚══════════════════════════════════════════════════╝'));
}

function printAction(action: Action, state: GameState): void {
  const player = `P${action.player + 1}`;

  switch (action.type) {
    case ActionType.PlayPokemon: {
      const card = state.players[action.player].hand[action.payload.handIndex];
      const name = card ? card.name : '???';
      if (action.payload.targetZone) {
        const target = action.payload.targetZone === 'active' ? 'Active Pokemon' : 'bench Pokemon';
        console.log(c(COLORS.green, `  ${player} evolves ${target} into ${name}`));
      } else {
        console.log(c(COLORS.green, `  ${player} plays ${name} to bench`));
      }
      break;
    }
    case ActionType.UseAbility: {
      const zone = action.payload.zone;
      const pokemon = zone === 'active'
        ? state.players[action.player].active
        : state.players[action.player].bench[action.payload.benchIndex];
      const abilityName = action.payload.abilityName || '???';
      console.log(c(COLORS.magenta, `  ${player} uses ${pokemon?.card.name || '???'}'s ability: ${abilityName}`));
      break;
    }
    case ActionType.AttachEnergy: {
      const card = state.players[action.player].hand[action.payload.handIndex];
      const target = action.payload.target === 'active' ? 'active' : `bench #${action.payload.benchIndex}`;
      console.log(c(COLORS.yellow, `  ${player} attaches energy to ${target}`));
      break;
    }
    case ActionType.Attack: {
      const active = state.players[action.player].active;
      const attackName = active?.card.attacks[action.payload.attackIndex]?.name || '???';
      const damage = active?.card.attacks[action.payload.attackIndex]?.damage || 0;
      console.log(c(COLORS.red, `  ${player} attacks with ${attackName} for ${damage} damage!`));
      break;
    }
    case ActionType.Retreat: {
      const benchPokemon = state.players[action.player].bench[action.payload.benchIndex];
      console.log(c(COLORS.blue, `  ${player} retreats to ${benchPokemon?.card.name || '???'}`));
      break;
    }
    case ActionType.PlayTrainer: {
      const card = state.players[action.player].hand[action.payload.handIndex];
      console.log(c(COLORS.cyan, `  ${player} plays trainer: ${card?.name || '???'}`));
      break;
    }
    case ActionType.Pass: {
      console.log(c(COLORS.dim, `  ${player} passes`));
      break;
    }
    default:
      console.log(c(COLORS.dim, `  ${player} does ${action.type}`));
  }
}

// ============================================================================
// AI PLAYER (Random with priorities)
// ============================================================================

/**
 * Improved heuristic AI with strategic priorities:
 * 1. Use once-per-turn abilities (Pidgeot ex Quick Search, etc.)
 * 2. Play trainer cards strategically (Rare Candy for evolution, search cards, Boss)
 * 3. Evolve Pokemon (prioritize Charizard ex line)
 * 4. Play Basic Pokemon to bench
 * 5. Attach energy to Pokemon that need it most
 * 6. Retreat if active is weak and bench has better attacker
 * 7. Attack with highest damage
 */
function selectAction(state: GameState, actions: Action[]): Action {
  const player = state.players[state.currentPlayer];

  // In attack phase: attack if possible, otherwise pass
  if (state.phase === GamePhase.AttackPhase) {
    const attacks = actions.filter(a => a.type === ActionType.Attack);
    if (attacks.length > 0) {
      const active = player.active;
      if (active) {
        // Pick highest damage attack that we can use
        const best = attacks.reduce((bestA, a) => {
          const dmgA = active.card.attacks[a.payload.attackIndex]?.damage ?? 0;
          const dmgB = active.card.attacks[bestA.payload.attackIndex]?.damage ?? 0;
          return dmgA > dmgB ? a : bestA;
        });
        return best;
      }
      return attacks[0];
    }
    return actions.find(a => a.type === ActionType.Pass) || actions[0];
  }

  // In main phase: strategic priority system
  const playPokemon = actions.filter(a => a.type === ActionType.PlayPokemon);
  const attachEnergy = actions.filter(a => a.type === ActionType.AttachEnergy);
  const playTrainer = actions.filter(a => a.type === ActionType.PlayTrainer);
  const useAbility = actions.filter(a => a.type === ActionType.UseAbility);
  const retreat = actions.filter(a => a.type === ActionType.Retreat);

  // 1. Use abilities first (Pidgeot ex Quick Search is incredibly powerful)
  if (useAbility.length > 0) {
    // Prefer Quick Search over other abilities
    const quickSearch = useAbility.find(a => a.payload.abilityName === 'Quick Search');
    if (quickSearch) return quickSearch;
    // Use Flip the Script if available
    const flipScript = useAbility.find(a => a.payload.abilityName === 'Flip the Script');
    if (flipScript) return flipScript;
    // Don't auto-use Cursed Blast (too dangerous, only use strategically)
    const dusknoirAbility = useAbility.find(a => a.payload.abilityName === 'Cursed Blast');
    if (dusknoirAbility) {
      // Only use if it would KO opponent's active and we have bench Pokemon
      const opponent = state.players[state.currentPlayer === 0 ? 1 : 0];
      if (opponent.active && opponent.active.currentHp <= 130 && player.bench.length >= 2) {
        return dusknoirAbility;
      }
    }
  }

  // 2. Play search/draw trainers early (Ultra Ball, Nest Ball, Buddy-Buddy Poffin)
  if (playTrainer.length > 0) {
    for (const trainerAction of playTrainer) {
      const card = player.hand[trainerAction.payload.handIndex];
      if (!card) continue;
      // Priority trainers that search/draw
      if (card.name === 'Rare Candy') {
        // Only play if we have a Stage 2 in hand AND a matching Basic in play
        const hasStage2 = player.hand.some(c =>
          c.cardType === CardType.Pokemon &&
          ((c as PokemonCard).stage === 'Stage2' || ((c as PokemonCard).stage === 'ex' && (c as PokemonCard).evolvesFrom))
        );
        if (hasStage2 && state.turnNumber > 1) return trainerAction;
        continue; // Skip if no valid target
      }
      if (card.name === 'Buddy-Buddy Poffin' && player.bench.length < 5) return trainerAction;
      if (card.name === 'Nest Ball' && player.bench.length < 5) return trainerAction;
      if (card.name === 'Ultra Ball') return trainerAction;
    }
  }

  // 3. Evolve Pokemon (highest priority: Charizard ex line, Pidgeot ex line)
  if (playPokemon.length > 0) {
    // Prioritize evolutions over basic placement
    const evolutions = playPokemon.filter(a => a.payload.targetZone);
    if (evolutions.length > 0) {
      // Prioritize Charizard ex and Pidgeot ex evolutions
      const charizardEvo = evolutions.find(a => {
        const card = player.hand[a.payload.handIndex];
        return card && (card.name === 'Charizard ex' || card.name === 'Charmeleon');
      });
      if (charizardEvo) return charizardEvo;
      const pidgeotEvo = evolutions.find(a => {
        const card = player.hand[a.payload.handIndex];
        return card && (card.name === 'Pidgeot ex' || card.name === 'Pidgeotto');
      });
      if (pidgeotEvo) return pidgeotEvo;
      return evolutions[0];
    }
    // Play basics to bench
    if (player.bench.length < 5) {
      return playPokemon[0];
    }
  }

  // 4. Play supporter trainers (Dawn, Iono, Boss's Orders)
  if (playTrainer.length > 0) {
    for (const trainerAction of playTrainer) {
      const card = player.hand[trainerAction.payload.handIndex];
      if (!card) continue;
      if (card.name === 'Dawn') return trainerAction;
      // Play Boss's Orders if opponent has damaged bench Pokemon
      if (card.name === "Boss's Orders") {
        const opponent = state.players[state.currentPlayer === 0 ? 1 : 0];
        if (opponent.bench.some(p => p.currentHp < p.card.hp * 0.5)) return trainerAction;
      }
      if (card.name === 'Iono') return trainerAction;
    }
  }

  // 5. Attach energy strategically
  if (attachEnergy.length > 0) {
    // Prefer attaching to active if it can attack
    const toActive = attachEnergy.filter(a => a.payload.target === 'active');
    if (toActive.length > 0) {
      // Prefer fire energy to active if it's a fire type
      if (player.active?.card.type === EnergyType.Fire) {
        const fireToActive = toActive.find(a => {
          const card = player.hand[a.payload.handIndex];
          return card && card.cardType === CardType.Energy && (card as any).energyType === EnergyType.Fire;
        });
        if (fireToActive) return fireToActive;
      }
      return toActive[0];
    }
    // Attach to bench Pokemon that are close to attacking
    return attachEnergy[0];
  }

  // 6. Retreat if active is in danger and bench has better options
  if (retreat.length > 0 && player.active) {
    const activeHpRatio = player.active.currentHp / player.active.card.hp;
    if (activeHpRatio < 0.3 && player.active.card.prizeCards >= 2) {
      // Active is a high-value target about to be KO'd - retreat
      // Pick bench Pokemon with best attack potential
      const bestBench = retreat.reduce((best, a) => {
        const pokemon = player.bench[a.payload.benchIndex];
        const bestPokemon = player.bench[best.payload.benchIndex];
        if (!pokemon || !bestPokemon) return best;
        // Prefer Pokemon with energy attached
        return pokemon.attachedEnergy.length > bestPokemon.attachedEnergy.length ? a : best;
      });
      return bestBench;
    }
  }

  // 7. Play remaining trainers
  if (playTrainer.length > 0) {
    // Play item cards that don't need specific targets
    for (const trainerAction of playTrainer) {
      const card = player.hand[trainerAction.payload.handIndex];
      if (!card) continue;
      if (card.name === 'Super Rod' || card.name === 'Night Stretcher') return trainerAction;
      if (card.name === 'Prime Catcher') {
        const opponent = state.players[state.currentPlayer === 0 ? 1 : 0];
        if (opponent.bench.length > 0) return trainerAction;
      }
    }
    // Play any remaining trainer
    return playTrainer[0];
  }

  // 8. Pass to attack phase
  return actions.find(a => a.type === ActionType.Pass) || actions[0];
}

// ============================================================================
// GAME LOOP
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runGame(config: PlayConfig): Promise<void> {
  console.log(c(COLORS.bright + COLORS.yellow, '\n🎴 Pokemon TCG AI — Charizard Mirror Match'));
  console.log(c(COLORS.dim, `   Seed: ${config.seed} | Max turns: ${config.maxTurns}\n`));

  // Build two identical Charizard decks
  const deck1 = buildCharizardDeck();
  const deck2 = buildCharizardDeck();

  console.log(`  P1 deck: ${deck1.length} cards (Charizard ex / Pidgeot ex / Dusknoir)`);
  console.log(`  P2 deck: ${deck2.length} cards (Charizard ex / Pidgeot ex / Dusknoir)`);
  console.log('');

  let state = GameEngine.createGame(deck1, deck2, config.seed);
  console.log(c(COLORS.green, `  Setup complete. Player ${state.currentPlayer + 1} goes first.\n`));

  // Print initial board
  printBoard(state);

  let turnCount = 0;
  const gameLog: string[] = [];

  while (!GameEngine.isGameOver(state) && turnCount < config.maxTurns) {
    // Draw phase
    if (state.phase === GamePhase.DrawPhase) {
      state = GameEngine.startTurn(state);
      if (GameEngine.isGameOver(state)) break;

      if (config.verbose) {
        console.log(c(COLORS.dim, `\n--- Turn ${state.turnNumber}, Player ${state.currentPlayer + 1} ---`));
      }
    }

    // Play actions
    let actionCount = 0;
    const maxActions = 100;

  while (
      !GameEngine.isGameOver(state) &&
      state.phase !== GamePhase.DrawPhase &&
      state.phase !== GamePhase.BetweenTurns &&
      actionCount < maxActions
    ) {
      const actions = GameEngine.getLegalActions(state);
      if (actions.length === 0) break;

      const action = selectAction(state, actions);

      if (config.verbose) {
        printAction(action, state);
      }

      state = GameEngine.applyAction(state, action);
      actionCount++;

      if (config.delayMs > 0) await sleep(config.delayMs);
    }

    // Between turns
    if (state.phase === GamePhase.BetweenTurns) {
      state = GameEngine.endTurn(state);
    }

    // Print board state at end of each full turn
    if (!config.verbose && turnCount % 2 === 0) {
      printBoard(state);
    } else if (config.verbose) {
      printBoard(state);
    }

    turnCount++;
  }

  // Final result
  console.log(c(COLORS.bright, '\n╔══════════════════════════════════════════════════╗'));
  console.log(c(COLORS.bright, '║                  GAME OVER                       ║'));
  console.log(c(COLORS.bright, '╚══════════════════════════════════════════════════╝'));

  printBoard(state);

  const winner = GameEngine.getWinner(state);
  if (winner !== null) {
    console.log(c(COLORS.bright + COLORS.green, `\n  🏆 Player ${winner + 1} wins!`));
    const loser = winner === 0 ? 1 : 0;
    console.log(`  P${winner + 1} prizes remaining: ${state.players[winner].prizeCardsRemaining}`);
    console.log(`  P${loser + 1} prizes remaining: ${state.players[loser].prizeCardsRemaining}`);
  } else {
    console.log(c(COLORS.yellow, `\n  Draw — max turns (${config.maxTurns}) reached`));
  }

  console.log(`  Total turns: ${state.turnNumber}`);
  console.log(`  Game log entries: ${state.gameLog.length}`);

  // Print last few log entries
  if (state.gameLog.length > 0) {
    console.log(c(COLORS.dim, '\n  Last events:'));
    const lastEntries = state.gameLog.slice(-10);
    for (const entry of lastEntries) {
      console.log(c(COLORS.dim, `    ${entry}`));
    }
  }

  console.log('');
}

// ============================================================================
// MAIN
// ============================================================================

const config = parseArgs();
runGame(config).catch((err) => {
  console.error('Game crashed:', err);
  process.exit(1);
});

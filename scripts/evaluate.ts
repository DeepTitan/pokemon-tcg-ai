/**
 * Evaluate trained model vs heuristic AI.
 *
 * Loads trained weights and plays games using the neural network
 * (greedy policy, no ISMCTS) against the heuristic AI.
 * Prints per-game summaries with turn count, prize progression, and KO timeline.
 *
 * Usage: node --import tsx scripts/evaluate.ts [--weights models/latest_weights.json] [--games 100]
 */

import { GameEngine } from '../src/engine/game-engine.js';
import { buildCharizardDeck } from '../src/engine/charizard-deck.js';
import { heuristicSelectAction } from '../src/ai/heuristic.js';
import { encodeAction } from '../src/ai/training/action-encoding.js';
import { NetworkISMCTSAdapter } from '../src/ai/training/network-adapter.js';
import { loadWeightsFromFile } from '../src/ai/training/weight-loader.js';
import { ISMCTS } from '../src/ai/ismcts/ismcts.js';
import { GamePhase } from '../src/engine/types.js';
import type { GameState, Action } from '../src/engine/types.js';

interface KnockoutEvent {
  turn: number;
  attacker: 0 | 1;      // player who scored the KO
  pokemon: string;       // name of KO'd pokemon
  prizesTaken: number;
}

interface GameResult {
  winner: 0 | 1 | null;
  turns: number;
  neuralPlayer: 0 | 1;
  prizesRemaining: [number, number];
  knockouts: KnockoutEvent[];
  winReason: string;
}

function selectNetworkAction(
  adapter: NetworkISMCTSAdapter,
  state: GameState,
  actions: Action[],
): Action {
  adapter.setContext(state, actions);
  const encoded = GameEngine.encodeState(state, state.currentPlayer as 0 | 1);
  const { policy } = adapter.predictSync(encoded);

  // Greedy: pick action with highest probability
  let bestAction = actions[0];
  let bestProb = -Infinity;

  for (const action of actions) {
    const key = JSON.stringify(action);
    const prob = policy.get(key) ?? 0;
    if (prob > bestProb) {
      bestProb = prob;
      bestAction = action;
    }
  }

  return bestAction;
}

async function selectISMCTSAction(
  ismcts: ISMCTS,
  adapter: NetworkISMCTSAdapter,
  state: GameState,
): Promise<Action> {
  const result = await ismcts.search(
    state,
    adapter,
    (s: GameState) => GameEngine.getLegalActions(s),
    (s: GameState, a: Action) => GameEngine.applyAction(s, a),
    state.currentPlayer as 0 | 1,
    (s: GameState, p: 0 | 1) => GameEngine.determinize(s, p),
  );
  return result.action;
}

/** Parse game log entries to extract knockout events with turn context */
function extractKnockouts(gameLog: string[], turnNumber: number): KnockoutEvent[] {
  const knockouts: KnockoutEvent[] = [];
  // Track current turn as we scan through the log
  let currentTurn = 0;

  for (const entry of gameLog) {
    // Track turn progression from draw messages
    const drawMatch = entry.match(/^Player \d draws a card/);
    if (drawMatch) {
      currentTurn++;
    }

    // Match: "Player X's PokemonName is knocked out. Player Y takes N prize card(s)."
    const koMatch = entry.match(
      /^Player (\d)'s (.+?) is knocked out\. Player (\d) takes (\d+) prize card/
    );
    if (koMatch) {
      const koPlayer = parseInt(koMatch[1]) as 0 | 1;
      const pokemon = koMatch[2];
      const attacker = parseInt(koMatch[3]) as 0 | 1;
      const prizesTaken = parseInt(koMatch[4]);
      knockouts.push({
        turn: currentTurn,
        attacker,
        pokemon,
        prizesTaken,
      });
    }
  }

  return knockouts;
}

/** Determine win reason from game log */
function extractWinReason(gameLog: string[]): string {
  for (let i = gameLog.length - 1; i >= Math.max(0, gameLog.length - 10); i--) {
    const entry = gameLog[i];
    if (entry.includes('wins by taking all prize cards')) return 'prizes';
    if (entry.includes('cannot draw')) return 'deck-out';
    if (entry.includes('Opponent has no Pokemon')) return 'no-pokemon';
  }
  return 'unknown';
}

async function playGame(
  adapter: NetworkISMCTSAdapter,
  seed: number,
  neuralPlayer: 0 | 1,
  useISMCTS: boolean = false,
  ismcts?: ISMCTS,
): Promise<GameResult> {
  const deck1 = buildCharizardDeck();
  const deck2 = buildCharizardDeck();
  let state = GameEngine.createGame(deck1, deck2, seed);
  let turnCount = 0;
  const MAX_TURNS = 200;

  while (!GameEngine.isGameOver(state) && turnCount < MAX_TURNS) {
    if (state.phase === GamePhase.DrawPhase) {
      state = GameEngine.startTurn(state);
      if (GameEngine.isGameOver(state)) break;
    }

    let actionCount = 0;
    while (
      !GameEngine.isGameOver(state) &&
      state.phase !== GamePhase.DrawPhase &&
      state.phase !== GamePhase.BetweenTurns &&
      actionCount < 200
    ) {
      const actions = GameEngine.getLegalActions(state);
      if (actions.length === 0) break;

      let chosenAction: Action;
      if (state.currentPlayer === neuralPlayer) {
        if (actions.length === 1) {
          chosenAction = actions[0];
        } else if (useISMCTS && ismcts) {
          chosenAction = await selectISMCTSAction(ismcts, adapter, state);
        } else {
          chosenAction = selectNetworkAction(adapter, state, actions);
        }
      } else {
        chosenAction = heuristicSelectAction(state, actions);
      }

      state = GameEngine.applyAction(state, chosenAction);
      actionCount++;
    }

    if (state.phase === GamePhase.BetweenTurns) {
      state = GameEngine.endTurn(state);
    }

    turnCount++;
  }

  const knockouts = extractKnockouts(state.gameLog, state.turnNumber);
  const winReason = state.winner !== null ? extractWinReason(state.gameLog) : 'draw';

  return {
    winner: state.winner as 0 | 1 | null,
    turns: state.turnNumber,
    neuralPlayer,
    prizesRemaining: [
      state.players[0].prizes.length,
      state.players[1].prizes.length,
    ],
    knockouts,
    winReason,
  };
}

/** Format a single game result as a compact one-line summary */
function formatGameSummary(gameNum: number, result: GameResult): string {
  const np = result.neuralPlayer;
  const hp = np === 0 ? 1 : 0;
  const neuralWon = result.winner === np;
  const heuristicWon = result.winner === hp;
  const outcome = neuralWon ? 'WIN ' : heuristicWon ? 'LOSS' : 'DRAW';

  // Prize counts: how many prizes were taken (6 - remaining)
  const neuralPrizesTaken = 6 - result.prizesRemaining[np];
  const heuristicPrizesTaken = 6 - result.prizesRemaining[hp];

  // KO timeline — show KOs scored by the neural player with ">" and heuristic with "<"
  const koSummary = result.knockouts
    .map(ko => {
      const marker = ko.attacker === np ? '>' : '<';
      return `T${ko.turn}${marker}${ko.pokemon}(${ko.prizesTaken})`;
    })
    .join(' ');

  const reason = result.winReason !== 'prizes' && result.winReason !== 'unknown'
    ? ` [${result.winReason}]`
    : '';

  return `  G${String(gameNum).padStart(2)} Neural(P${np}) ${outcome} | ${String(result.turns).padStart(3)} turns | Prizes ${neuralPrizesTaken}-${heuristicPrizesTaken} | ${koSummary}${reason}`;
}

async function main() {
  const args = process.argv.slice(2);
  let weightsPath = 'models/latest_weights.json';
  let numGames = 100;
  let useISMCTS = false;
  let determinizations = 3;
  let simulations = 50;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--weights' && args[i + 1]) weightsPath = args[i + 1];
    if (args[i] === '--games' && args[i + 1]) numGames = parseInt(args[i + 1]);
    if (args[i] === '--ismcts') useISMCTS = true;
    if (args[i] === '--determinizations' && args[i + 1]) determinizations = parseInt(args[i + 1]);
    if (args[i] === '--simulations' && args[i + 1]) simulations = parseInt(args[i + 1]);
  }

  console.log(`Loading weights from ${weightsPath}...`);
  const weights = await loadWeightsFromFile(weightsPath);
  const adapter = new NetworkISMCTSAdapter(weights);
  console.log(`Weights loaded. Mode: ${useISMCTS ? `ISMCTS (${determinizations}×${simulations})` : 'greedy'}`);

  let ismcts: ISMCTS | undefined;
  if (useISMCTS) {
    ismcts = new ISMCTS({
      determinizations,
      simulationsPerDeterminization: simulations,
      explorationConstant: 1.41,
      network: adapter,
    });
  }

  let neuralWins = 0;
  let heuristicWins = 0;
  let draws = 0;
  let totalTurns = 0;
  let totalNeuralPrizes = 0;
  let totalHeuristicPrizes = 0;
  const startTime = performance.now();

  for (let g = 0; g < numGames; g++) {
    // Alternate which player is neural
    const neuralPlayer = (g % 2) as 0 | 1;
    const result = await playGame(adapter, g * 7777 + 13, neuralPlayer, useISMCTS, ismcts);
    const hp = neuralPlayer === 0 ? 1 : 0;

    totalTurns += result.turns;
    totalNeuralPrizes += 6 - result.prizesRemaining[neuralPlayer];
    totalHeuristicPrizes += 6 - result.prizesRemaining[hp];

    if (result.winner === neuralPlayer) neuralWins++;
    else if (result.winner !== null) heuristicWins++;
    else draws++;

    // Print per-game summary
    console.log(formatGameSummary(g + 1, result));

    // Print running totals every 20 games
    if ((g + 1) % 20 === 0) {
      const total = g + 1;
      const wr = ((neuralWins / total) * 100).toFixed(1);
      console.log(
        `  --- ${total}/${numGames} | Neural: ${neuralWins} (${wr}%) | Heuristic: ${heuristicWins} | Draws: ${draws} | Avg turns: ${(totalTurns / total).toFixed(1)}`
      );
    }
  }

  const elapsed = (performance.now() - startTime) / 1000;
  const winRate = ((neuralWins / numGames) * 100).toFixed(1);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results (${numGames} games):`);
  console.log(`  Neural wins:    ${neuralWins} (${winRate}%)`);
  console.log(`  Heuristic wins: ${heuristicWins} (${((heuristicWins / numGames) * 100).toFixed(1)}%)`);
  console.log(`  Draws:          ${draws}`);
  console.log(`  Avg turns/game: ${(totalTurns / numGames).toFixed(1)}`);
  console.log(`  Avg neural prizes taken:    ${(totalNeuralPrizes / numGames).toFixed(1)}/6`);
  console.log(`  Avg heuristic prizes taken: ${(totalHeuristicPrizes / numGames).toFixed(1)}/6`);
  console.log(`  Time: ${elapsed.toFixed(1)}s`);
}

main().catch(console.error);

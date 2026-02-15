/**
 * Evaluate trained model vs heuristic AI.
 *
 * Loads trained weights and plays games using the neural network
 * (greedy policy, no ISMCTS) against the heuristic AI.
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

async function playGame(
  adapter: NetworkISMCTSAdapter,
  seed: number,
  neuralPlayer: 0 | 1,
  useISMCTS: boolean = false,
  ismcts?: ISMCTS,
): Promise<{ winner: 0 | 1 | null; moves: number }> {
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

  return { winner: state.winner as 0 | 1 | null, moves: turnCount };
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
  let totalMoves = 0;
  const startTime = performance.now();

  for (let g = 0; g < numGames; g++) {
    // Alternate which player is neural
    const neuralPlayer = (g % 2) as 0 | 1;
    const { winner, moves } = await playGame(adapter, g * 7777 + 13, neuralPlayer, useISMCTS, ismcts);
    totalMoves += moves;

    if (winner === neuralPlayer) neuralWins++;
    else if (winner !== null) heuristicWins++;
    else draws++;

    if ((g + 1) % 20 === 0) {
      const total = g + 1;
      const wr = ((neuralWins / total) * 100).toFixed(1);
      console.log(
        `  ${total}/${numGames} | Neural: ${neuralWins} (${wr}%) | Heuristic: ${heuristicWins} | Draws: ${draws}`
      );
    }
  }

  const elapsed = (performance.now() - startTime) / 1000;
  const winRate = ((neuralWins / numGames) * 100).toFixed(1);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results (${numGames} games):`);
  console.log(`  Neural wins:    ${neuralWins} (${winRate}%)`);
  console.log(`  Heuristic wins: ${heuristicWins} (${((heuristicWins / numGames) * 100).toFixed(1)}%)`);
  console.log(`  Draws:          ${draws}`);
  console.log(`  Avg moves/game: ${(totalMoves / numGames).toFixed(1)}`);
  console.log(`  Time: ${elapsed.toFixed(1)}s`);
}

main().catch(console.error);

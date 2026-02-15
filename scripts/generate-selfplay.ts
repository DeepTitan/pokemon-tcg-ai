/**
 * Generate self-play training data using ISMCTS with neural network.
 *
 * Plays games using ISMCTS guided by the trained neural network,
 * recording MCTS visit-count policies as training targets.
 *
 * Usage: node --import tsx scripts/generate-selfplay.ts \
 *   --weights models/latest_weights.json \
 *   --games 50 --output data/selfplay/ \
 *   --determinizations 3 --simulations 50
 */

import { GameEngine } from '../src/engine/game-engine.js';
import { buildCharizardDeck } from '../src/engine/charizard-deck.js';
import { ISMCTS } from '../src/ai/ismcts/ismcts.js';
import { encodeAction, ACTION_ENCODING_SIZE } from '../src/ai/training/action-encoding.js';
import { NetworkISMCTSAdapter } from '../src/ai/training/network-adapter.js';
import { loadWeightsFromFile } from '../src/ai/training/weight-loader.js';
import { GamePhase } from '../src/engine/types.js';
import type { GameState, Action } from '../src/engine/types.js';
import * as fs from 'fs';
import * as path from 'path';

const STATE_SIZE = 501;

interface TrainingStep {
  state: Float32Array;
  actionFeatures: Float32Array[];
  policyTarget: Float32Array;
  valueTarget: number;
}

function evaluateTerminal(state: GameState, currentPlayer: 0 | 1): number {
  if (state.winner === null) return 0;
  return state.winner === currentPlayer ? 1 : -1;
}

let deterministicSeed = 0;

async function playGameAndCollect(
  seed: number,
  adapter: NetworkISMCTSAdapter | null,
  numDet: number,
  numSim: number,
): Promise<{ steps: TrainingStep[]; winner: 0 | 1 }> {
  const deck1 = buildCharizardDeck();
  const deck2 = buildCharizardDeck();
  let state = GameEngine.createGame(deck1, deck2, seed);

  const steps: TrainingStep[] = [];
  const playerSteps: Map<0 | 1, number[]> = new Map([[0, []], [1, []]]);
  let turnCount = 0;
  let decisionCount = 0; // Track decision points for temperature annealing
  const MAX_TURNS = 200;

  while (!GameEngine.isGameOver(state) && turnCount < MAX_TURNS) {
    // DrawPhase → startTurn → MainPhase
    if (state.phase === GamePhase.DrawPhase) {
      state = GameEngine.startTurn(state);
      if (GameEngine.isGameOver(state)) break;
    }

    // Action loop: MainPhase + AttackPhase
    let actionCount = 0;
    while (
      !GameEngine.isGameOver(state) &&
      state.phase !== GamePhase.DrawPhase &&
      state.phase !== GamePhase.BetweenTurns &&
      actionCount < 200
    ) {
      const actions = GameEngine.getLegalActions(state);
      if (actions.length === 0) break;

      if (actions.length > 1) {
        const currentPlayer = state.currentPlayer as 0 | 1;
        const encoded = GameEngine.encodeState(state, currentPlayer);
        const stateVec = encoded.buffer;
        const actionFeats = actions.map(a => encodeAction(a, state));

        // Temperature: explore early (T=1.0), exploit later (T=0.2)
        const temperature = decisionCount < 20 ? 1.0 : 0.2;
        decisionCount++;

        // Run ISMCTS search with Dirichlet noise for root exploration
        const ismcts = new ISMCTS({
          numDeterminizations: numDet,
          numSimulations: numSim,
          temperatureStart: temperature,
          dirichletAlpha: 0.3,
          dirichletEpsilon: 0.25,
          encodeStateFn: GameEngine.encodeState.bind(GameEngine),
          evaluateTerminalFn: evaluateTerminal,
        });

        const result = await ismcts.search(
          state,
          adapter ?? undefined,
          GameEngine.getLegalActions.bind(GameEngine),
          GameEngine.applyAction.bind(GameEngine),
          currentPlayer,
          (s, p) => GameEngine.determinize(s, p, deterministicSeed++),
        );

        // Build policy target from MCTS visit counts
        const policyTarget = new Float32Array(actions.length);
        for (let i = 0; i < actions.length; i++) {
          const key = JSON.stringify(actions[i]);
          policyTarget[i] = result.policy.get(key) ?? 0;
        }

        // Normalize
        let sum = 0;
        for (let i = 0; i < policyTarget.length; i++) sum += policyTarget[i];
        if (sum > 0) {
          for (let i = 0; i < policyTarget.length; i++) policyTarget[i] /= sum;
        }

        const stepIdx = steps.length;
        steps.push({
          state: stateVec,
          actionFeatures: actionFeats,
          policyTarget,
          valueTarget: 0,
        });
        playerSteps.get(currentPlayer)!.push(stepIdx);

        state = GameEngine.applyAction(state, result.action);
      } else {
        state = GameEngine.applyAction(state, actions[0]);
      }
      actionCount++;
    }

    // BetweenTurns → endTurn → DrawPhase
    if (state.phase === GamePhase.BetweenTurns) {
      state = GameEngine.endTurn(state);
    }

    turnCount++;
  }

  const winner = state.winner as 0 | 1 | null;
  if (winner !== null) {
    for (const idx of playerSteps.get(winner)!) {
      steps[idx].valueTarget = 1.0;
    }
    const loser = (winner === 0 ? 1 : 0) as 0 | 1;
    for (const idx of playerSteps.get(loser)!) {
      steps[idx].valueTarget = -1.0;
    }
  }

  return { steps, winner: winner ?? 0 };
}

function writeTrajectoryBinary(steps: TrainingStep[], filepath: string) {
  let totalSize = 4;
  for (const step of steps) {
    totalSize += STATE_SIZE * 4;
    totalSize += 4;
    totalSize += step.actionFeatures.length * ACTION_ENCODING_SIZE * 4;
    totalSize += step.actionFeatures.length * 4;
    totalSize += 4;
  }

  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  buffer.writeUInt32LE(steps.length, offset);
  offset += 4;

  for (const step of steps) {
    for (let i = 0; i < STATE_SIZE; i++) {
      buffer.writeFloatLE(step.state[i], offset);
      offset += 4;
    }
    const numActions = step.actionFeatures.length;
    buffer.writeUInt32LE(numActions, offset);
    offset += 4;
    for (const feat of step.actionFeatures) {
      for (let i = 0; i < ACTION_ENCODING_SIZE; i++) {
        buffer.writeFloatLE(feat[i], offset);
        offset += 4;
      }
    }
    for (let i = 0; i < numActions; i++) {
      buffer.writeFloatLE(step.policyTarget[i], offset);
      offset += 4;
    }
    buffer.writeFloatLE(step.valueTarget, offset);
    offset += 4;
  }

  fs.writeFileSync(filepath, buffer);
}

async function main() {
  const args = process.argv.slice(2);
  let numGames = 50;
  let outDir = 'data/selfplay';
  let weightsPath = 'models/latest_weights.json';
  let numDet = 3;
  let numSim = 50;
  let gameOffset = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--games' && args[i + 1]) numGames = parseInt(args[i + 1]);
    if (args[i] === '--output' && args[i + 1]) outDir = args[i + 1];
    if (args[i] === '--weights' && args[i + 1]) weightsPath = args[i + 1];
    if (args[i] === '--determinizations' && args[i + 1]) numDet = parseInt(args[i + 1]);
    if (args[i] === '--simulations' && args[i + 1]) numSim = parseInt(args[i + 1]);
    if (args[i] === '--game-offset' && args[i + 1]) gameOffset = parseInt(args[i + 1]);
  }

  const resolvedDir = path.resolve(outDir);
  fs.mkdirSync(resolvedDir, { recursive: true });

  // Load neural network weights if available
  let adapter: NetworkISMCTSAdapter | null = null;
  try {
    const weights = await loadWeightsFromFile(weightsPath);
    adapter = new NetworkISMCTSAdapter(weights);
    console.log(`Loaded weights from ${weightsPath}`);
  } catch {
    console.log('No weights found — using uniform priors for ISMCTS');
  }

  console.log(`Generating ${numGames} self-play games (${numDet}×${numSim} ISMCTS)...`);

  let totalSteps = 0;
  let p0Wins = 0;
  let p1Wins = 0;
  const startTime = performance.now();

  for (let g = 0; g < numGames; g++) {
    const globalIdx = gameOffset + g;
    const { steps, winner } = await playGameAndCollect(
      globalIdx * 54321 + 99, adapter, numDet, numSim
    );
    totalSteps += steps.length;
    if (winner === 0) p0Wins++;
    else p1Wins++;

    // Write each game as its own file
    const filepath = path.join(resolvedDir, `game_${String(globalIdx).padStart(5, '0')}.bin`);
    writeTrajectoryBinary(steps, filepath);

    const elapsed = (performance.now() - startTime) / 1000;
    const gps = (g + 1) / elapsed;
    console.log(
      `  Game ${g + 1}/${numGames} | ${steps.length} steps | ` +
      `${gps.toFixed(2)} games/sec | ${elapsed.toFixed(0)}s`
    );
  }

  const elapsed = (performance.now() - startTime) / 1000;
  console.log(`\nDone! ${numGames} games, ${totalSteps} training steps`);
  console.log(`P0 wins: ${p0Wins}, P1 wins: ${p1Wins}`);
  console.log(`Time: ${elapsed.toFixed(1)}s`);
}

main().catch(console.error);

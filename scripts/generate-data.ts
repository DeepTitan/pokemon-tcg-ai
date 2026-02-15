/**
 * Generate training data from heuristic self-play.
 *
 * Plays games using the heuristic AI and writes binary trajectory files
 * for Python training. This is the bridge between the TS game engine
 * and the Python training pipeline.
 *
 * Usage: node --import tsx scripts/generate-data.ts [--games 500] [--output data/imitation]
 */

import { GameEngine } from '../src/engine/game-engine.js';
import { buildCharizardDeck } from '../src/engine/charizard-deck.js';
import { heuristicSelectAction } from '../src/ai/heuristic.js';
import { encodeAction, ACTION_ENCODING_SIZE } from '../src/ai/training/action-encoding.js';
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

function playGameAndCollect(seed: number): { steps: TrainingStep[]; winner: 0 | 1 } {
  const deck1 = buildCharizardDeck();
  const deck2 = buildCharizardDeck();
  let state = GameEngine.createGame(deck1, deck2, seed);

  const steps: TrainingStep[] = [];
  const playerSteps: Map<0 | 1, number[]> = new Map([[0, []], [1, []]]);
  let turnCount = 0;
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
        const chosenAction = heuristicSelectAction(state, actions);
        const chosenIdx = actions.findIndex(a => JSON.stringify(a) === JSON.stringify(chosenAction));

        const policyTarget = new Float32Array(actions.length);
        if (chosenIdx >= 0) {
          policyTarget[chosenIdx] = 1.0;
        } else {
          policyTarget.fill(1.0 / actions.length);
        }

        const stepIdx = steps.length;
        steps.push({
          state: stateVec,
          actionFeatures: actionFeats,
          policyTarget,
          valueTarget: 0,
        });
        playerSteps.get(currentPlayer)!.push(stepIdx);

        state = GameEngine.applyAction(state, chosenAction);
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

function main() {
  const args = process.argv.slice(2);
  let numGames = 500;
  let outDir = 'data/imitation';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--games' && args[i + 1]) {
      numGames = parseInt(args[i + 1]);
    }
    if (args[i] === '--output' && args[i + 1]) {
      outDir = args[i + 1];
    }
  }

  const resolvedDir = path.resolve(outDir);
  fs.mkdirSync(resolvedDir, { recursive: true });

  console.log(`Generating ${numGames} games → ${resolvedDir}/`);

  let totalSteps = 0;
  let p0Wins = 0;
  let p1Wins = 0;
  const batchSize = 50;
  let batchSteps: TrainingStep[] = [];
  let fileIdx = 0;
  const startTime = performance.now();

  for (let g = 0; g < numGames; g++) {
    const { steps, winner } = playGameAndCollect(g * 12345 + 42);
    totalSteps += steps.length;
    if (winner === 0) p0Wins++;
    else p1Wins++;

    batchSteps.push(...steps);

    if ((g + 1) % batchSize === 0 || g === numGames - 1) {
      const filepath = path.join(resolvedDir, `batch_${String(fileIdx).padStart(4, '0')}.bin`);
      writeTrajectoryBinary(batchSteps, filepath);
      fileIdx++;
      batchSteps = [];
    }

    if ((g + 1) % 100 === 0) {
      const elapsed = (performance.now() - startTime) / 1000;
      const gps = (g + 1) / elapsed;
      console.log(
        `  ${g + 1}/${numGames} games | ${totalSteps} steps | ${gps.toFixed(0)} games/sec`
      );
    }
  }

  const elapsed = (performance.now() - startTime) / 1000;
  console.log(`\nDone! ${numGames} games, ${totalSteps} training steps`);
  console.log(`P0 wins: ${p0Wins}, P1 wins: ${p1Wins}`);
  console.log(`Avg steps/game: ${(totalSteps / numGames).toFixed(1)}`);
  console.log(`Time: ${elapsed.toFixed(1)}s (${(numGames / elapsed).toFixed(0)} games/sec)`);
}

main();

#!/usr/bin/env npx ts-node
/**
 * Benchmark script to test game simulation speed.
 * Measures: games/second, actions/second, encoding speed
 * Critical for estimating training time.
 */

import { GameEngine } from '../src/engine/game-engine.js';
import { buildStarterDeck } from '../src/engine/cards.js';
import { GameState } from '../src/engine/types.js';

/**
 * Utility to measure execution time
 */
function measureTime(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

/**
 * Run benchmarks
 */
async function main(): Promise<void> {
  console.log('Pokemon TCG AI - Performance Benchmark');
  console.log('=====================================\n');

  const NUM_GAMES = 1000;
  const NUM_ENCODINGS = 1000;

  try {
    // Initialize game engine
    const deck1 = buildStarterDeck();
    const deck2 = buildStarterDeck();
    const engine = new GameEngine();

    // Benchmark: Game simulation
    console.log(`Benchmarking ${NUM_GAMES} random games...`);
    let totalActions = 0;

    const gameTime = measureTime(() => {
      for (let i = 0; i < NUM_GAMES; i++) {
        let state = engine.initializeGame(deck1, deck2);
        let actionCount = 0;

        while (!engine.isGameOver(state)) {
          const legalActions = engine.getLegalActions(state);
          if (legalActions.length === 0) break;

          // Pick random legal action
          const randomAction = legalActions[Math.floor(Math.random() * legalActions.length)];
          state = engine.executeAction(state, randomAction);
          actionCount++;
        }

        totalActions += actionCount;
      }
    });

    const gamesPerSecond = (NUM_GAMES / gameTime) * 1000;
    const actionsPerSecond = (totalActions / gameTime) * 1000;
    const avgGameLength = totalActions / NUM_GAMES;

    console.log(`  Games simulated: ${NUM_GAMES}`);
    console.log(`  Total time: ${gameTime.toFixed(2)}ms`);
    console.log(`  Games/second: ${gamesPerSecond.toFixed(2)}`);
    console.log(`  Actions/second: ${actionsPerSecond.toFixed(0)}`);
    console.log(`  Average game length: ${avgGameLength.toFixed(2)} actions\n`);

    // Benchmark: State encoding
    console.log(`Benchmarking ${NUM_ENCODINGS} state encodings...`);
    let initialState = engine.initializeGame(deck1, deck2);

    const encodeTime = measureTime(() => {
      for (let i = 0; i < NUM_ENCODINGS; i++) {
        engine.encodeGameState(initialState);
      }
    });

    const encodingsPerSecond = (NUM_ENCODINGS / encodeTime) * 1000;

    console.log(`  Encodings: ${NUM_ENCODINGS}`);
    console.log(`  Total time: ${encodeTime.toFixed(2)}ms`);
    console.log(`  Encodings/second: ${encodingsPerSecond.toFixed(0)}\n`);

    // Training time estimation
    console.log('Training Time Estimation');
    console.log('------------------------');
    const trainingGames = 100000;
    const estimatedGameTime = (trainingGames / gamesPerSecond) * 1000;
    const estimatedHours = estimatedGameTime / (1000 * 60 * 60);

    console.log(`  Target: ${trainingGames} games for initial training`);
    console.log(`  Estimated time: ${estimatedHours.toFixed(2)} hours`);
    console.log(`  (Assumes single-threaded; multi-threaded training scales linearly)\n`);

    // Hardware info
    console.log('System Information');
    console.log('------------------');
    console.log(`  Node.js: ${process.version}`);
    console.log(`  Platform: ${process.platform}`);
    console.log(`  Architecture: ${process.arch}`);

  } catch (error) {
    console.error('Benchmark failed:', error);
    process.exit(1);
  }
}

main();

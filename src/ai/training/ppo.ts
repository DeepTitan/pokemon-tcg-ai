import * as tf from '@tensorflow/tfjs';
import { PolicyValueNetwork, TrainingBatch } from '../network/model.js';
import { EncodedGameState, GameState } from '../../engine/types.js';

/**
 * PPO (Proximal Policy Optimization) configuration.
 * Based on February 2025 research (arXiv 2502.08938) showing PPO outperforms
 * CFR-based approaches for imperfect information games like Poker and Dou Dizhu.
 */
export interface PPOConfig {
  gamma: number;              // Discount factor, default 0.99
  lambda: number;             // GAE (Generalized Advantage Estimation) lambda, default 0.95
  epsilon: number;            // PPO clip ratio, default 0.2
  valueCoeff: number;         // Value loss coefficient, default 0.5
  entropyCoeff: number;       // Entropy bonus coefficient, default 0.01
  maxGradNorm: number;        // Gradient clipping, default 0.5
  numEpochs: number;          // PPO epochs per iteration, default 4
  batchSize: number;          // Minibatch size, default 256
  numWorkers: number;         // Parallel self-play workers, default 8
  gamesPerIteration: number;  // Games to play before training, default 100
  replayBufferSize: number;   // Max stored trajectories, default 10000
}

/**
 * A single trajectory: one complete game played by the agent.
 * Contains states, actions, rewards, value estimates, and log probabilities.
 */
export interface Trajectory {
  states: EncodedGameState[];      // Game states at each step
  actions: number[];                // Action indices taken
  rewards: number[];                // Sparse rewards: 0 during game, ±1 at end
  values: number[];                 // Value function estimates per step
  logProbs: number[];               // Log probability of chosen action
  legalMasks: Float32Array[];       // Legal action mask per step
  done: boolean[];                  // Terminal state flags
  returnCumulative?: number;        // Cumulative return for this trajectory
  gameLength?: number;              // Number of steps in game
  outcome?: 'win' | 'loss' | 'draw'; // Game outcome from agent perspective
}

/**
 * SelfPlayManager: Orchestrates self-play games for data collection.
 * Maintains a pool of opponent models (current + historical checkpoints)
 * and plays games to generate training trajectories.
 */
export class SelfPlayManager {
  private currentModel: PolicyValueNetwork;
  private opponentPool: PolicyValueNetwork[] = [];
  private checkpointHistory: { model: PolicyValueNetwork; iteration: number }[] = [];
  private config: PPOConfig;
  private gameCounter: number = 0;

  constructor(model: PolicyValueNetwork, config: PPOConfig) {
    this.currentModel = model;
    this.config = config;
    // Initialize pool with current model
    this.opponentPool.push(model.clone());
  }

  /**
   * Play a single game of Pokemon TCG AI vs opponent.
   * Collects trajectory data for training.
   *
   * Note: Simplified mock implementation. Real version would interface with game engine.
   *
   * @param opponent Model to play against
   * @returns Trajectory from the game
   */
  private async _playGame(opponent: PolicyValueNetwork): Promise<Trajectory> {
    const trajectory: Trajectory = {
      states: [],
      actions: [],
      rewards: [],
      values: [],
      logProbs: [],
      legalMasks: [],
      done: []
    };

    // Initialize game state (mock)
    let gameState: EncodedGameState = {
      buffer: new Float32Array(400),
      timestamp: Date.now(),
      turnNumber: 0,
      perspectivePlayer: 0
    }; // Mock 400-dim encoded state
    let terminated = false;
    let reward = 0;
    let stepCount = 0;
    const maxSteps = 500; // Max game length

    while (!terminated && stepCount < maxSteps) {
      // Get legal actions for current state (mock)
      const legalMask = this._getLegalActions(gameState);

      // Current player (agent) predicts action
      const { policy: agentPolicy, value: agentValue } = await this.currentModel.predict(gameState, legalMask);

      // Sample action from policy
      const action = this._sampleAction(agentPolicy, legalMask);
      const logProb = Math.log(Math.max(agentPolicy[action], 1e-8));

      // Store in trajectory
      trajectory.states.push(gameState);
      trajectory.actions.push(action);
      trajectory.values.push(agentValue);
      trajectory.logProbs.push(logProb);
      trajectory.legalMasks.push(legalMask);

      // Transition to next state (mock game engine step)
      const { nextState, reward: stepReward, done } = await this._gameStep(gameState, action, opponent);
      gameState = nextState;
      reward = stepReward;
      terminated = done;

      trajectory.rewards.push(reward);
      trajectory.done.push(done);

      stepCount++;
    }

    // Pad final state in done array if not terminal
    if (trajectory.done.length > 0) {
      trajectory.done[trajectory.done.length - 1] = true;
    }

    trajectory.gameLength = stepCount;
    trajectory.returnCumulative = trajectory.rewards.reduce((a, b) => a + b, 0);
    trajectory.outcome = trajectory.returnCumulative > 0 ? 'win' : trajectory.returnCumulative < 0 ? 'loss' : 'draw';

    this.gameCounter++;
    return trajectory;
  }

  /**
   * Play N parallel games and collect trajectories.
   * In production, would use worker threads for true parallelism.
   *
   * @param numGames Number of games to play
   * @returns Array of trajectories
   */
  async collectTrajectories(numGames: number): Promise<Trajectory[]> {
    const trajectories: Trajectory[] = [];

    // Play games sequentially (async, not parallel)
    // In production, use Promise.all with worker threads
    for (let i = 0; i < numGames; i++) {
      // Alternate between playing against current model and pool
      const opponent = this.opponentPool[i % this.opponentPool.length];
      const trajectory = await this._playGame(opponent);
      trajectories.push(trajectory);

      if ((i + 1) % 10 === 0) {
        console.log(`[SelfPlayManager] Collected ${i + 1}/${numGames} games`);
      }
    }

    return trajectories;
  }

  /**
   * Add a checkpoint to the opponent pool for future games.
   * Keeps recent models for diverse training opponents.
   *
   * @param model Model to add to pool
   * @param iteration Current training iteration
   */
  addCheckpoint(model: PolicyValueNetwork, iteration: number): void {
    const checkpoint = model.clone();
    this.checkpointHistory.push({ model: checkpoint, iteration });

    // Keep only recent checkpoints (last 10)
    if (this.checkpointHistory.length > 10) {
      const oldest = this.checkpointHistory.shift();
      oldest?.model.dispose();
    }

    this.opponentPool = this.checkpointHistory.map(c => c.model);
  }

  /**
   * Get legal actions for current game state.
   * Mock implementation returning random legal mask.
   */
  private _getLegalActions(state: EncodedGameState): Float32Array {
    const legalMask = new Float32Array(200); // Max 200 actions
    const numLegal = Math.floor(Math.random() * 30) + 5; // 5-35 legal actions
    for (let i = 0; i < numLegal; i++) {
      legalMask[Math.floor(Math.random() * 200)] = 1;
    }
    return legalMask;
  }

  /**
   * Sample action from policy distribution.
   */
  private _sampleAction(policy: Float32Array, legalMask: Float32Array): number {
    // Ensure only legal actions can be sampled
    let totalProb = 0;
    const legalProbs = new Float32Array(policy.length);
    for (let i = 0; i < policy.length; i++) {
      if (legalMask[i] > 0) {
        legalProbs[i] = policy[i];
        totalProb += policy[i];
      }
    }

    // Normalize
    if (totalProb > 0) {
      for (let i = 0; i < legalProbs.length; i++) {
        legalProbs[i] /= totalProb;
      }
    }

    // Categorical sampling
    const rand = Math.random();
    let cumProb = 0;
    for (let i = 0; i < legalProbs.length; i++) {
      cumProb += legalProbs[i];
      if (rand <= cumProb) {
        return i;
      }
    }

    return 0;
  }

  /**
   * Execute one game step via the engine.
   * Mock implementation for demonstration.
   */
  private async _gameStep(
    state: EncodedGameState,
    action: number,
    opponent: PolicyValueNetwork
  ): Promise<{ nextState: EncodedGameState; reward: number; done: boolean }> {
    // Simulate state transition
    const nextStateBuffer = new Float32Array(state.buffer);
    nextStateBuffer[action % 400] += Math.random() * 0.1; // Mock perturbation

    // Wrap as EncodedGameState for predict/getLegalActions
    const nextState: EncodedGameState = {
      buffer: nextStateBuffer,
      timestamp: Date.now(),
      turnNumber: state.turnNumber + 1,
      perspectivePlayer: (1 - state.perspectivePlayer) as 0 | 1
    };

    // Opponent's turn (mock)
    const opponentLegalMask = this._getLegalActions(nextState);
    const { policy: oppPolicy } = await opponent.predict(nextState, opponentLegalMask);
    const oppAction = this._sampleAction(oppPolicy, opponentLegalMask);

    // Apply opponent action
    nextStateBuffer[oppAction % 400] -= Math.random() * 0.1;

    // Random game outcome (mock)
    const rand = Math.random();
    const done = rand < 0.1; // 10% chance to end game
    const reward = done ? (Math.random() < 0.5 ? 1 : -1) : 0;

    return { nextState, reward, done };
  }

  /**
   * Get statistics about recent games.
   */
  getStatistics(): { avgGameLength: number; winRate: number; totalGames: number } {
    return {
      totalGames: this.gameCounter,
      avgGameLength: 0, // Would compute from trajectories
      winRate: 0        // Would compute from outcomes
    };
  }

  /**
   * Dispose of all models in pool.
   */
  dispose(): void {
    for (const checkpoint of this.checkpointHistory) {
      checkpoint.model.dispose();
    }
    this.checkpointHistory = [];
    this.opponentPool = [];
  }
}

/**
 * PPOTrainer: Implements Proximal Policy Optimization training loop.
 *
 * Algorithm outline:
 * 1. Collect trajectories via self-play
 * 2. Compute Generalized Advantage Estimation (GAE)
 * 3. Run multiple epochs of minibatch PPO updates
 * 4. Apply gradient clipping and parameter updates
 * 5. Evaluate and checkpoint
 * 6. Repeat
 *
 * This approach has shown superior performance for imperfect information games
 * compared to CFR-based methods (research: arXiv 2502.08938).
 */
export class PPOTrainer {
  private model: PolicyValueNetwork;
  private config: PPOConfig;
  private selfPlayManager: SelfPlayManager;
  private trajectoryBuffer: Trajectory[] = [];
  private eloRating: number = 1600; // Elo starting point
  private trainingIteration: number = 0;

  constructor(model: PolicyValueNetwork, config: PPOConfig) {
    this.model = model;
    this.config = config;
    this.selfPlayManager = new SelfPlayManager(model, config);
  }

  /**
   * Main training loop: runs for specified number of iterations.
   *
   * @param numIterations Number of PPO training iterations to run
   */
  async train(numIterations: number): Promise<void> {
    console.log(`[PPOTrainer] Starting training for ${numIterations} iterations`);
    console.log(`[PPOTrainer] Config: gamma=${this.config.gamma}, lambda=${this.config.lambda}, epsilon=${this.config.epsilon}`);

    for (let iter = 0; iter < numIterations; iter++) {
      this.trainingIteration = iter;
      const iterationStartTime = Date.now();

      // Phase 1: Collect trajectories via self-play
      console.log(`\n[Iteration ${iter + 1}/${numIterations}] Collecting ${this.config.gamesPerIteration} games...`);
      const trajectories = await this.selfPlayManager.collectTrajectories(
        this.config.gamesPerIteration
      );
      this.trajectoryBuffer.push(...trajectories);

      // Maintain replay buffer size
      if (this.trajectoryBuffer.length > this.config.replayBufferSize) {
        this.trajectoryBuffer = this.trajectoryBuffer.slice(-this.config.replayBufferSize);
      }

      // Phase 2: Process trajectories and compute advantages
      console.log('[PPOTrainer] Computing advantages with GAE...');
      const batches = this._prepareBatches(trajectories);

      // Phase 3: PPO optimization epochs
      console.log(`[PPOTrainer] Running ${this.config.numEpochs} PPO epochs with ${batches.length} batches...`);
      const metrics = await this._trainEpochs(batches);

      // Phase 4: Logging
      const iterationTime = (Date.now() - iterationStartTime) / 1000;
      this._logMetrics(metrics, trajectories, iterationTime);

      // Phase 5: Checkpointing
      if ((iter + 1) % 10 === 0) {
        console.log(`[PPOTrainer] Saving checkpoint at iteration ${iter + 1}`);
        this.selfPlayManager.addCheckpoint(this.model, iter);
        await this.model.save(`./checkpoints/model-iter-${iter + 1}`);
      }
    }

    console.log('[PPOTrainer] Training complete!');
  }

  /**
   * Compute Generalized Advantage Estimation (GAE) for trajectories.
   *
   * GAE is a variance-reduction technique that balances bias and variance:
   * A_t = sum_{l=0}^{inf} (gamma * lambda)^l * delta_{t+l}
   *
   * Where delta_t = r_t + gamma * V(s_{t+1}) - V(s_t)
   *
   * This reduces variance compared to Monte Carlo returns while maintaining
   * some bias (controlled by lambda parameter).
   */
  private _computeGAE(trajectory: Trajectory): { advantages: number[]; returns: number[] } {
    const advantages: number[] = [];
    const returns: number[] = [];

    // Bootstrap value at end of trajectory (0 if terminal)
    const n = trajectory.states.length;
    let nextValue = 0; // No bootstrap for terminal states

    let cumAdvantage = 0;

    // Iterate backwards through trajectory
    for (let t = n - 1; t >= 0; t--) {
      const reward = trajectory.rewards[t];
      const value = trajectory.values[t];
      const done = trajectory.done[t];

      // Temporal difference: delta_t = r_t + gamma * V(s_{t+1}) - V(s_t)
      const delta = reward + this.config.gamma * nextValue - value;

      // Cumulative discounted advantage
      cumAdvantage = delta + this.config.gamma * this.config.lambda * cumAdvantage * (done ? 0 : 1);

      advantages.unshift(cumAdvantage);
      returns.unshift(cumAdvantage + value);

      nextValue = value;
    }

    return { advantages, returns };
  }

  /**
   * Prepare training batches from collected trajectories.
   * Converts trajectories into minibatches for PPO updates.
   */
  private _prepareBatches(trajectories: Trajectory[]): TrainingBatch[] {
    const batches: TrainingBatch[] = [];

    // Flatten all trajectories
    let allStates: Float32Array[] = [];
    let allActions: number[] = [];
    let allAdvantages: number[] = [];
    let allReturns: number[] = [];
    let allOldLogProbs: number[] = [];
    let allLegalMasks: Float32Array[] = [];

    for (const trajectory of trajectories) {
      const { advantages, returns } = this._computeGAE(trajectory);

      allStates.push(...trajectory.states.map(s => s.buffer));
      allActions.push(...trajectory.actions);
      allAdvantages.push(...advantages);
      allReturns.push(...returns);
      allOldLogProbs.push(...trajectory.logProbs);
      allLegalMasks.push(...trajectory.legalMasks);
    }

    // Normalize advantages (reduces variance)
    const meanAdv = allAdvantages.reduce((a, b) => a + b) / allAdvantages.length;
    const stdAdv = Math.sqrt(
      allAdvantages.reduce((sum, a) => sum + (a - meanAdv) ** 2, 0) / allAdvantages.length
    );
    const normalizedAdvantages = allAdvantages.map(a => (a - meanAdv) / (stdAdv + 1e-8));

    // Create minibatches
    const numBatches = Math.ceil(allStates.length / this.config.batchSize);
    for (let i = 0; i < numBatches; i++) {
      const start = i * this.config.batchSize;
      const end = Math.min(start + this.config.batchSize, allStates.length);

      const statesBatch = allStates.slice(start, end);
      const actionsBatch = allActions.slice(start, end);
      const advantagesBatch = normalizedAdvantages.slice(start, end);
      const returnsBatch = allReturns.slice(start, end);
      const oldLogProbsBatch = allOldLogProbs.slice(start, end);
      const legalMasksBatch = allLegalMasks.slice(start, end);

      // Convert to tensors
      const statesTensor = tf.tensor2d(statesBatch.map(s => Array.from(s)));
      const actionsTensor = tf.tensor1d(actionsBatch, 'int32');
      const advantagesTensor = tf.tensor1d(advantagesBatch);
      const returnsTensor = tf.tensor1d(returnsBatch);
      const oldLogProbsTensor = tf.tensor1d(oldLogProbsBatch);
      const legalMasksTensor = tf.tensor2d(legalMasksBatch.map(m => Array.from(m)));

      batches.push({
        states: statesTensor as tf.Tensor2D,
        actions: actionsTensor as tf.Tensor1D,
        advantages: advantagesTensor as tf.Tensor1D,
        returns: returnsTensor as tf.Tensor1D,
        oldLogProbs: oldLogProbsTensor as tf.Tensor1D,
        legalMasks: legalMasksTensor as tf.Tensor2D
      });
    }

    return batches;
  }

  /**
   * Run multiple epochs of PPO training on prepared batches.
   * Each epoch shuffles and trains on all batches.
   */
  private async _trainEpochs(batches: TrainingBatch[]): Promise<{
    policyLoss: number;
    valueLoss: number;
    entropy: number;
  }> {
    const metrics = {
      policyLoss: 0,
      valueLoss: 0,
      entropy: 0
    };

    for (let epoch = 0; epoch < this.config.numEpochs; epoch++) {
      let epochPolicyLoss = 0;
      let epochValueLoss = 0;
      let epochEntropy = 0;
      let batchCount = 0;

      // Shuffle batches for better training
      const shuffledBatches = [...batches].sort(() => Math.random() - 0.5);

      for (const batch of shuffledBatches) {
        const batchMetrics = await this.model.trainOnBatch(batch);

        epochPolicyLoss += batchMetrics.policyLoss;
        epochValueLoss += batchMetrics.valueLoss;
        epochEntropy += batchMetrics.entropy;
        batchCount++;

        // Clean up batch tensors
        batch.states.dispose();
        batch.actions.dispose();
        batch.advantages.dispose();
        batch.returns.dispose();
        batch.oldLogProbs.dispose();
        batch.legalMasks.dispose();
      }

      metrics.policyLoss = epochPolicyLoss / batchCount;
      metrics.valueLoss = epochValueLoss / batchCount;
      metrics.entropy = epochEntropy / batchCount;

      console.log(
        `  Epoch ${epoch + 1}/${this.config.numEpochs} - ` +
        `Policy Loss: ${metrics.policyLoss.toFixed(4)}, ` +
        `Value Loss: ${metrics.valueLoss.toFixed(4)}, ` +
        `Entropy: ${metrics.entropy.toFixed(4)}`
      );
    }

    return metrics;
  }

  /**
   * Log training metrics and statistics.
   */
  private _logMetrics(
    metrics: { policyLoss: number; valueLoss: number; entropy: number },
    trajectories: Trajectory[],
    iterationTime: number
  ): void {
    // Compute game statistics
    const outcomes = trajectories.map(t => t.outcome);
    const wins = outcomes.filter(o => o === 'win').length;
    const losses = outcomes.filter(o => o === 'loss').length;
    const draws = outcomes.filter(o => o === 'draw').length;
    const winRate = (wins / trajectories.length * 100).toFixed(1);
    const avgGameLength = (
      trajectories.reduce((sum, t) => sum + (t.gameLength || 0), 0) / trajectories.length
    ).toFixed(1);

    console.log('\n' + '='.repeat(70));
    console.log(`Iteration ${this.trainingIteration + 1} Summary:`);
    console.log('='.repeat(70));
    console.log(`Games: ${trajectories.length} | Win Rate: ${winRate}% | Avg Length: ${avgGameLength}`);
    console.log(`Outcomes: ${wins}W / ${losses}L / ${draws}D`);
    console.log(`Policy Loss: ${metrics.policyLoss.toFixed(6)} | Value Loss: ${metrics.valueLoss.toFixed(6)}`);
    console.log(`Entropy: ${metrics.entropy.toFixed(6)} | Iteration Time: ${iterationTime.toFixed(1)}s`);
    console.log('='.repeat(70));
  }

  /**
   * Dispose of trainer resources.
   */
  dispose(): void {
    this.selfPlayManager.dispose();
    this.model.dispose();
  }
}

/**
 * Information Set Monte Carlo Tree Search (ISMCTS) Implementation
 *
 * Based on "Information Set Monte Carlo Tree Search" by Cowling, Powley, and Whitehouse (2012).
 * This implementation is tailored for Pokemon TCG, a game of imperfect information.
 *
 * Key principles:
 * 1. Determinization: Before each simulation, randomly sample a concrete game state that's
 *    consistent with what the current player knows.
 * 2. Information Set Nodes: Tree nodes represent information sets (states indistinguishable
 *    from the current player's perspective), not individual states.
 * 3. PUCT Selection: Uses PUCT formula for exploration-exploitation balance, incorporating
 *    neural network priors.
 * 4. Availability Weighting: Actions are only evaluated in determinizations where they're legal.
 */

import { GameState, Action, EncodedGameState } from '../../engine/types.js';

/**
 * Configuration for ISMCTS search
 */
export interface ChildStat {
  actionKey: string;
  action: Action;
  visitCount: number;
  meanValue: number;
  prior: number;
  probability: number;
}

export interface ISMCTSConfig {
  numDeterminizations: number;  // Number of determinizations per search (default: 30)
  numSimulations: number;       // MCTS iterations per determinization (default: 200)
  explorationWeight: number;    // c_puct coefficient for PUCT formula (default: 1.5)
  temperatureStart: number;     // Initial temperature for action selection (default: 1.0)
  temperatureEnd: number;       // Final temperature after annealing (default: 0.1)
  maxDepth: number;             // Maximum depth of tree (default: 30)
  useNeuralNetPrior: boolean;   // Whether to use NN priors (default: true)
  dirichletAlpha: number;       // Dirichlet noise alpha for root exploration (default: 0, disabled)
  dirichletEpsilon: number;     // Fraction of noise vs prior at root (default: 0.25)
  encodeStateFn?: (state: GameState, perspective: 0 | 1) => EncodedGameState;
  evaluateTerminalFn?: (state: GameState, currentPlayer: 0 | 1) => number;
}

/**
 * Node in the ISMCTS tree representing an information set
 */
interface MCTSNode {
  parent: MCTSNode | null;
  children: Map<string, MCTSNode>;  // action key -> child node
  action: Action | null;             // action that led to this node
  visitCount: number;                // total visits to this node
  totalValue: number;                // sum of all returns
  meanValue: number;                 // Q(s,a) = totalValue / visitCount
  prior: number;                     // P(s,a) from neural network [0, 1]
  availabilityCount: number;         // ISMCTS: visits where this action was legal
  depth: number;                     // depth in tree from root
}

/**
 * Interface for neural network policy/value predictions
 */
export interface PolicyValueNetwork {
  predict(state: EncodedGameState): Promise<{
    policy: Map<string, number>;
    value: number;
  }>;
  /** Optional synchronous predict for fast networks (avoids microtask overhead) */
  predictSync?(state: EncodedGameState): {
    policy: Map<string, number>;
    value: number;
  };
  /** Set context for action-scoring networks that need legal actions to compute policy */
  setContext?(state: GameState, legalActions: Action[]): void;
}

const DEFAULT_PREDICTION = { policy: new Map<string, number>(), value: 0.0 };

/**
 * Neural Network abstraction if none is provided (random policy).
 * Uses synchronous predict to avoid 18,000+ microtask hops in full search.
 */
class DefaultNetwork implements PolicyValueNetwork {
  predictSync(state: EncodedGameState): { policy: Map<string, number>; value: number } {
    return DEFAULT_PREDICTION;
  }
  async predict(state: EncodedGameState): Promise<{ policy: Map<string, number>; value: number }> {
    return DEFAULT_PREDICTION;
  }
}

/**
 * Information Set Monte Carlo Tree Search
 */
export class ISMCTS {
  private config: ISMCTSConfig;
  private nodeCount: number = 0;

  constructor(config: Partial<ISMCTSConfig> = {}) {
    this.config = {
      numDeterminizations: config.numDeterminizations ?? 30,
      numSimulations: config.numSimulations ?? 200,
      explorationWeight: config.explorationWeight ?? 1.5,
      temperatureStart: config.temperatureStart ?? 1.0,
      temperatureEnd: config.temperatureEnd ?? 0.1,
      maxDepth: config.maxDepth ?? 30,
      useNeuralNetPrior: config.useNeuralNetPrior ?? true,
      dirichletAlpha: config.dirichletAlpha ?? 0,
      dirichletEpsilon: config.dirichletEpsilon ?? 0.25,
    };

    // Validate configuration
    if (this.config.numDeterminizations < 1) {
      throw new Error('numDeterminizations must be >= 1');
    }
    if (this.config.numSimulations < 1) {
      throw new Error('numSimulations must be >= 1');
    }
    if (this.config.explorationWeight < 0) {
      throw new Error('explorationWeight must be >= 0');
    }
    if (this.config.maxDepth < 1) {
      throw new Error('maxDepth must be >= 1');
    }
  }

  /**
   * Main entry point: perform ISMCTS search and return best action
   *
   * Algorithm overview:
   * For each determinization:
   *   - Sample a concrete game state consistent with current player's knowledge
   *   - Run numSimulations MCTS iterations:
   *     - Select: traverse tree using PUCT until reaching unexplored node
   *     - Expand: add new node to tree
   *     - Evaluate: use NN to estimate value, or rollout
   *     - Backpropagate: update statistics up the tree
   * Return action with highest visit count from root
   *
   * @param gameState - Current game state
   * @param network - Neural network for policy/value estimates
   * @param getLegalActions - Function to get legal actions for a state
   * @param applyAction - Function to apply action to state
   * @param currentPlayer - Which player is acting (0 or 1)
   * @param determinizeState - Function to sample determinization
   * @returns Best action and statistics
   */
  async search(
    gameState: GameState,
    network: PolicyValueNetwork | undefined,
    getLegalActions: (state: GameState) => Action[],
    applyAction: (state: GameState, action: Action) => GameState,
    currentPlayer: 0 | 1,
    determinizeState: (state: GameState, perspective: 0 | 1) => GameState,
    onProgress?: (determinization: number, total: number) => void,
  ): Promise<{
    action: Action;
    policy: Map<string, number>;
    value: number;
    childStats: ChildStat[];
  }> {
    const net = network ?? new DefaultNetwork();
    const hasSyncPredict = typeof net.predictSync === 'function';

    // Reset node counter
    this.nodeCount = 0;

    // Create root node representing the current information set
    const root: MCTSNode = {
      parent: null,
      children: new Map(),
      action: null,
      visitCount: 0,
      totalValue: 0,
      meanValue: 0,
      prior: 1.0,
      availabilityCount: 0,
      depth: 0,
    };

    // Helper: call predict synchronously when possible to avoid microtask overhead
    const predict = hasSyncPredict
      ? (encoded: EncodedGameState) => net.predictSync!(encoded)
      : async (encoded: EncodedGameState) => net.predict(encoded);

    // Outer loop: run multiple determinizations
    const totalWork = this.config.numDeterminizations * this.config.numSimulations;
    const YIELD_INTERVAL = 50; // yield to event loop every N sync simulations
    let workDone = 0;

    for (let detIdx = 0; detIdx < this.config.numDeterminizations; detIdx++) {
      // Sample a determinization: concrete game state consistent with what current player knows
      const deterministicState = determinizeState(gameState, currentPlayer);

      // Inner loop: run MCTS simulations on this determinization
      if (hasSyncPredict) {
        // Fast synchronous path — yield periodically so UI stays responsive
        for (let simIdx = 0; simIdx < this.config.numSimulations; simIdx++) {
          this.runSimulationSync(
            deterministicState, root, net, getLegalActions, applyAction, currentPlayer,
          );
          workDone++;

          // Yield every YIELD_INTERVAL simulations for UI responsiveness
          if (workDone % YIELD_INTERVAL === 0) {
            onProgress?.(workDone, totalWork);
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
      } else {
        // Async path for real neural networks
        for (let simIdx = 0; simIdx < this.config.numSimulations; simIdx++) {
          await this.runSimulation(
            deterministicState, root, net, getLegalActions, applyAction, currentPlayer,
          );
          workDone++;
        }
      }

      onProgress?.(workDone, totalWork);

      // Add Dirichlet noise to root priors after first determinization
      if (detIdx === 0 && this.config.dirichletAlpha > 0 && root.children.size > 0) {
        const epsilon = this.config.dirichletEpsilon;
        const noise = this.sampleDirichlet(root.children.size, this.config.dirichletAlpha);
        let i = 0;
        for (const child of root.children.values()) {
          child.prior = (1 - epsilon) * child.prior + epsilon * noise[i];
          i++;
        }
      }

      // Yield between determinizations
      if (detIdx < this.config.numDeterminizations - 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Extract policy from root visit counts (annealed by temperature)
    const temperature = this.config.temperatureStart;
    const selectedAction = this.selectAction(root, getLegalActions(gameState), temperature);
    const policy = this.extractPolicy(root, getLegalActions(gameState));

    // Estimate value as weighted average of children values
    let value = 0;
    if (root.visitCount > 0) {
      let totalWeightedValue = 0;
      for (const child of root.children.values()) {
        if (child.visitCount > 0) {
          totalWeightedValue += (child.visitCount / root.visitCount) * child.meanValue;
        }
      }
      value = totalWeightedValue;
    }

    // Build child stats for debug output
    const legalActions = getLegalActions(gameState);
    const childStats: ChildStat[] = [];
    for (const action of legalActions) {
      const key = this.actionToKey(action);
      const child = root.children.get(key);
      childStats.push({
        actionKey: key,
        action,
        visitCount: child?.visitCount ?? 0,
        meanValue: child?.meanValue ?? 0,
        prior: child?.prior ?? 0,
        probability: root.visitCount > 0 && child ? child.visitCount / root.visitCount : 0,
      });
    }
    childStats.sort((a, b) => b.visitCount - a.visitCount);

    return {
      action: selectedAction,
      policy,
      value,
      childStats,
    };
  }

  /**
   * Run a single MCTS simulation iteration on a determinized state
   *
   * Steps:
   * 1. Selection: Traverse tree from root using PUCT until reaching leaf
   * 2. Expansion: Add new node to tree if leaf is non-terminal
   * 3. Evaluation: Use neural network to estimate value of node
   * 4. Backpropagation: Update all nodes in path
   */
  private async runSimulation(
    state: GameState,
    root: MCTSNode,
    network: PolicyValueNetwork,
    getLegalActions: (state: GameState) => Action[],
    applyAction: (state: GameState, action: Action) => GameState,
    currentPlayer: 0 | 1,
  ): Promise<void> {
    const path: MCTSNode[] = [];
    let currentNode = root;
    let currentState = state;
    let currentPlayerInSim = currentPlayer;

    // Selection phase: traverse tree using PUCT
    // Continue while node is fully expanded; break when we find unexplored actions
    while (true) {
      const legalActions = getLegalActions(currentState);

      if (legalActions.length === 0) {
        // Terminal state reached - backprop and exit
        const value = this.evaluateTerminal(currentState, currentPlayerInSim);
        this.backpropagate(path, value, 1, currentPlayerInSim);
        return;
      }

      // Check if this node is fully expanded
      const allActionsExplored = legalActions.every(action => {
        const key = this.actionToKey(action);
        return currentNode.children.has(key);
      });

      if (!allActionsExplored) {
        // Found a node with unexplored children - stop selection, go to expansion
        break;
      }

      // Selection: use PUCT to choose best action among explored children
      const { action, selectedChild } = this.selectBestChild(
        currentNode,
        legalActions,
        this.config.explorationWeight,
      );

      path.push(currentNode);
      currentNode = selectedChild;
      currentState = applyAction(currentState, action);
      currentPlayerInSim = currentPlayerInSim === 0 ? 1 : 0;

      // Max depth cutoff
      if (path.length >= this.config.maxDepth) {
        // Use neural network to evaluate state
        const maxDepthActions = getLegalActions(currentState);
        network.setContext?.(currentState, maxDepthActions);
        const encoded = this.encodeState(currentState, currentPlayerInSim);
        const { value } = await network.predict(encoded);
        this.backpropagate(path, value, 1, currentPlayerInSim);
        return;
      }
    }

    // Expansion: create children for all legal actions
    const legalActions = getLegalActions(currentState);
    network.setContext?.(currentState, legalActions);
    const encoded = this.encodeState(currentState, currentPlayerInSim);
    const { policy: priors } = await network.predict(encoded);

    for (const action of legalActions) {
      const key = this.actionToKey(action);
      if (!currentNode.children.has(key)) {
        const prior = priors.get(key) ?? 0;
        const child = this.createChildNode(currentNode, action, prior);
        currentNode.children.set(key, child);
      }
    }

    // Now select one of the newly expanded children to evaluate
    let selectedAction = legalActions[0];
    if (currentNode.children.size > 0) {
      // Pick the first child (could also use highest prior)
      selectedAction = legalActions[0];
    }

    const childKey = this.actionToKey(selectedAction);
    const selectedChild = currentNode.children.get(childKey);
    if (!selectedChild) {
      throw new Error('Failed to find selected child after expansion');
    }

    path.push(currentNode);
    currentState = applyAction(currentState, selectedAction);
    currentPlayerInSim = currentPlayerInSim === 0 ? 1 : 0;

    // Evaluation: use neural network for value estimate
    const evalActions = getLegalActions(currentState);
    network.setContext?.(currentState, evalActions);
    const evaluatedState = this.encodeState(currentState, currentPlayerInSim);
    const { value } = await network.predict(evaluatedState);

    // Backpropagation: update all nodes in path
    this.backpropagate(path, value, 1, currentPlayerInSim);
  }

  /**
   * Synchronous version of runSimulation for networks with predictSync.
   * Eliminates all microtask overhead — runs ~100x faster than async path
   * when using DefaultNetwork or other synchronous predictors.
   */
  private runSimulationSync(
    state: GameState,
    root: MCTSNode,
    network: PolicyValueNetwork,
    getLegalActions: (state: GameState) => Action[],
    applyAction: (state: GameState, action: Action) => GameState,
    currentPlayer: 0 | 1,
  ): void {
    const predictSync = network.predictSync!.bind(network);
    const path: MCTSNode[] = [];
    let currentNode = root;
    let currentState = state;
    let currentPlayerInSim = currentPlayer;

    // Selection: traverse while fully expanded; break when unexplored actions found
    while (true) {
      const legalActions = getLegalActions(currentState);

      if (legalActions.length === 0) {
        const value = this.evaluateTerminal(currentState, currentPlayerInSim);
        this.backpropagate(path, value, 1, currentPlayerInSim);
        return;
      }

      const allActionsExplored = legalActions.every(action => {
        const key = this.actionToKey(action);
        return currentNode.children.has(key);
      });

      if (!allActionsExplored) break;

      const { action, selectedChild } = this.selectBestChild(
        currentNode, legalActions, this.config.explorationWeight,
      );

      path.push(currentNode);
      currentNode = selectedChild;
      currentState = applyAction(currentState, action);
      currentPlayerInSim = currentPlayerInSim === 0 ? 1 : 0;

      if (path.length >= this.config.maxDepth) {
        const maxDepthActions = getLegalActions(currentState);
        network.setContext?.(currentState, maxDepthActions);
        const encoded = this.encodeState(currentState, currentPlayerInSim);
        const { value } = predictSync(encoded);
        this.backpropagate(path, value, 1, currentPlayerInSim);
        return;
      }
    }

    const legalActions = getLegalActions(currentState);
    network.setContext?.(currentState, legalActions);
    const encoded = this.encodeState(currentState, currentPlayerInSim);
    const { policy: priors } = predictSync(encoded);

    for (const action of legalActions) {
      const key = this.actionToKey(action);
      if (!currentNode.children.has(key)) {
        const prior = priors.get(key) ?? 0;
        const child = this.createChildNode(currentNode, action, prior);
        currentNode.children.set(key, child);
      }
    }

    let selectedAction = legalActions[0];
    const childKey = this.actionToKey(selectedAction);
    const selectedChild = currentNode.children.get(childKey);
    if (!selectedChild) {
      throw new Error('Failed to find selected child after expansion');
    }

    path.push(currentNode);
    currentState = applyAction(currentState, selectedAction);
    currentPlayerInSim = currentPlayerInSim === 0 ? 1 : 0;

    const evalActions = getLegalActions(currentState);
    network.setContext?.(currentState, evalActions);
    const evaluatedState = this.encodeState(currentState, currentPlayerInSim);
    const { value } = predictSync(evaluatedState);
    this.backpropagate(path, value, 1, currentPlayerInSim);
  }

  /**
   * Selection step: use PUCT to select best child
   *
   * PUCT formula: Q(s,a) + c_puct * P(s,a) * sqrt(N(s)) / (1 + N(s,a))
   * where:
   *   Q(s,a) = mean value of action a from state s
   *   P(s,a) = prior probability from neural network
   *   N(s) = visit count of state s
   *   N(s,a) = visit count of action a from s
   *   c_puct = exploration weight
   */
  private selectBestChild(
    node: MCTSNode,
    legalActions: Action[],
    cPuct: number,
  ): { action: Action; selectedChild: MCTSNode } {
    let bestScore = -Infinity;
    let bestAction: Action | null = null;
    let bestChild: MCTSNode | null = null;

    for (const action of legalActions) {
      const key = this.actionToKey(action);
      const child = node.children.get(key);

      if (!child) {
        continue; // Skip unexplored actions (common in ISMCTS across determinizations)
      }

      // PUCT score calculation
      const exploitation = child.meanValue;
      const sqrtParentVisits = Math.sqrt(node.visitCount);
      const exploration =
        cPuct * child.prior * (sqrtParentVisits / (1 + child.visitCount));

      const score = exploitation + exploration;

      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
        bestChild = child;
      }
    }

    if (!bestAction || !bestChild) {
      throw new Error('No explored child found among legal actions');
    }

    return { action: bestAction, selectedChild: bestChild };
  }

  /**
   * Expansion: create a new child node
   */
  private createChildNode(
    parent: MCTSNode,
    action: Action,
    prior: number,
  ): MCTSNode {
    this.nodeCount++;

    return {
      parent,
      children: new Map(),
      action,
      visitCount: 0,
      totalValue: 0,
      meanValue: 0,
      prior: Math.max(prior, 1e-8), // Ensure prior is never 0
      availabilityCount: 0,
      depth: parent.depth + 1,
    };
  }

  /**
   * Backpropagation: update statistics for all nodes in path
   *
   * For each node in the path:
   *   - Increment visit count
   *   - Add value to total
   *   - Recalculate mean value
   *   - Increment availability count (for ISMCTS action weighting)
   *
   * @param path - Path from root to leaf (excluding leaf itself)
   * @param value - Value to backpropagate (perspective of current player)
   * @param leafWeight - Weight to apply (usually 1.0)
   * @param valuePlayer - Which player the value is from
   */
  private backpropagate(
    path: MCTSNode[],
    value: number,
    leafWeight: number,
    valuePlayer: 0 | 1,
  ): void {
    // Backpropagate up the tree
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i];
      const isOriginalPlayer = i === path.length - 1 || (path.length - 1 - i) % 2 === 0;

      // Adjust value sign based on whose perspective we're in
      const adjustedValue = isOriginalPlayer ? value : -value;

      node.visitCount++;
      node.totalValue += adjustedValue * leafWeight;
      node.meanValue = node.visitCount > 0 ? node.totalValue / node.visitCount : 0;
      node.availabilityCount++;
    }
  }

  /**
   * Terminal state evaluation: determine value based on game outcome
   */
  private evaluateTerminal(state: GameState, currentPlayer: 0 | 1): number {
    if (this.config.evaluateTerminalFn) {
      return this.config.evaluateTerminalFn(state, currentPlayer);
    }
    return 0;
  }

  private encodeState(state: GameState, perspective: 0 | 1): EncodedGameState {
    if (this.config.encodeStateFn) {
      return this.config.encodeStateFn(state, perspective);
    }
    return { buffer: new Float32Array(501) } as EncodedGameState;
  }

  /**
   * Sample from Dirichlet distribution using Gamma sampling
   */
  private sampleDirichlet(n: number, alpha: number): number[] {
    const samples: number[] = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      // Gamma(alpha, 1) via Marsaglia and Tsang's method (simplified for alpha >= 1)
      // For alpha < 1, use Gamma(alpha+1, 1) * U^(1/alpha)
      let gamma: number;
      if (alpha >= 1) {
        const d = alpha - 1 / 3;
        const c = 1 / Math.sqrt(9 * d);
        while (true) {
          let x: number, v: number;
          do {
            x = this.randn();
            v = 1 + c * x;
          } while (v <= 0);
          v = v * v * v;
          const u = Math.random();
          if (u < 1 - 0.0331 * x * x * x * x) { gamma = d * v; break; }
          if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) { gamma = d * v; break; }
        }
      } else {
        // alpha < 1: sample Gamma(alpha+1) then scale
        const d = alpha + 1 - 1 / 3;
        const c = 1 / Math.sqrt(9 * d);
        while (true) {
          let x: number, v: number;
          do {
            x = this.randn();
            v = 1 + c * x;
          } while (v <= 0);
          v = v * v * v;
          const u = Math.random();
          if (u < 1 - 0.0331 * x * x * x * x) { gamma = d * v * Math.pow(Math.random(), 1 / alpha); break; }
          if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) { gamma = d * v * Math.pow(Math.random(), 1 / alpha); break; }
        }
      }
      samples.push(gamma);
      sum += gamma;
    }
    // Normalize to get Dirichlet sample
    for (let i = 0; i < n; i++) samples[i] /= sum;
    return samples;
  }

  /** Standard normal via Box-Muller */
  private randn(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * Convert action to unique string key for tree indexing
   */
  private actionToKey(action: Action): string {
    // Serialize action to unique key
    // Implementation depends on your Action type
    return JSON.stringify(action);
  }

  /**
   * Select action from root using annealed temperature
   *
   * At high temperature: more exploration (flatter distribution)
   * At low temperature: more exploitation (sharper distribution)
   *
   * Formula: policy ∝ N(a) ^ (1/T)
   * where N(a) is visit count and T is temperature
   */
  private selectAction(root: MCTSNode, legalActions: Action[], temperature: number): Action {
    // Pure exploitation: argmax (for production play or near-zero temperature)
    if (temperature < 0.01) {
      let maxVisits = 0;
      let bestAction = legalActions[0];
      for (const action of legalActions) {
        const key = this.actionToKey(action);
        const child = root.children.get(key);
        if (child && child.visitCount > maxVisits) {
          maxVisits = child.visitCount;
          bestAction = action;
        }
      }
      return bestAction;
    }

    // Temperature-based sampling: policy ∝ N(a)^(1/T)
    const invT = 1.0 / temperature;
    const powered: number[] = [];
    for (const action of legalActions) {
      const key = this.actionToKey(action);
      const child = root.children.get(key);
      const visits = child?.visitCount ?? 0;
      powered.push(Math.pow(Math.max(visits, 1), invT));
    }

    const sum = powered.reduce((a, b) => a + b, 0);
    const rand = Math.random() * sum;
    let cumulative = 0;
    for (let i = 0; i < legalActions.length; i++) {
      cumulative += powered[i];
      if (rand < cumulative) return legalActions[i];
    }
    return legalActions[legalActions.length - 1];
  }

  /**
   * Extract policy distribution from root node
   * Returns normalized visit counts as policy
   */
  private extractPolicy(
    root: MCTSNode,
    legalActions: Action[],
  ): Map<string, number> {
    const policy = new Map<string, number>();

    if (root.visitCount === 0) {
      // Uniform policy if root was never visited
      const uniform = 1.0 / legalActions.length;
      for (const action of legalActions) {
        policy.set(this.actionToKey(action), uniform);
      }
      return policy;
    }

    // Normalize visit counts to create probability distribution
    for (const action of legalActions) {
      const key = this.actionToKey(action);
      const child = root.children.get(key);
      const probability = child ? child.visitCount / root.visitCount : 0;
      policy.set(key, probability);
    }

    return policy;
  }

  /**
   * Get training data from current tree
   * Returns visit-count-based policy and value estimate
   * Used for training neural network with PPO
   */
  getTrainingData(root: MCTSNode, legalActions: Action[]): {
    policy: Map<string, number>;
    value: number;
  } {
    const policy = this.extractPolicy(root, legalActions);

    // Value is average of root's children values weighted by visit counts
    let value = 0;
    if (root.visitCount > 0) {
      let totalWeightedValue = 0;
      for (const child of root.children.values()) {
        if (child.visitCount > 0) {
          totalWeightedValue += (child.visitCount / root.visitCount) * child.meanValue;
        }
      }
      value = totalWeightedValue;
    }

    return { policy, value };
  }

  /**
   * Get statistics about the tree for debugging/analysis
   */
  getTreeStats(): {
    nodeCount: number;
    config: ISMCTSConfig;
  } {
    return {
      nodeCount: this.nodeCount,
      config: { ...this.config },
    };
  }

  /**
   * Clear tree between searches (optional)
   */
  resetTree(): void {
    this.nodeCount = 0;
  }
}

export default ISMCTS;

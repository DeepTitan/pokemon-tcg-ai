import { GameEngine } from '../engine/game-engine.js';
import { ISMCTS, type ISMCTSConfig, type ChildStat, type PolicyValueNetwork } from './ismcts/ismcts.js';
import type { GameState, Action } from '../engine/types.js';
import { heuristicSelectAction } from './heuristic.js';
import { getModel } from './model-registry.js';
import { NetworkISMCTSAdapter, type ModelWeights } from './training/network-adapter.js';

export type { AIModel } from './model-registry.js';
export { getModels, getModel, getModelIds, registerModel } from './model-registry.js';

export type AIMode = string;

export interface AISearchResult {
  action: Action;
  childStats: ChildStat[];
  value: number;
  searchTimeMs: number;
  nodeCount: number;
  config: { determinizations: number; simulations: number };
}

function evaluateTerminal(state: GameState, currentPlayer: 0 | 1): number {
  if (state.winner === null) return 0;
  return state.winner === currentPlayer ? 1 : -1;
}

let deterministicSeed = 0;
let cachedNetworkAdapter: NetworkISMCTSAdapter | null = null;

/** Load neural network weights for ISMCTS. Call before using neural-ismcts mode. */
export function loadNeuralWeights(weights: ModelWeights): void {
  cachedNetworkAdapter = new NetworkISMCTSAdapter(weights);
}

/** Check if neural weights are loaded. */
export function hasNeuralWeights(): boolean {
  return cachedNetworkAdapter !== null;
}

export async function searchAction(
  state: GameState,
  actions: Action[],
  mode: AIMode,
  onProgress?: (det: number, total: number) => void,
): Promise<AISearchResult> {
  const model = getModel(mode);

  if (!model || !model.ismctsConfig) {
    // Heuristic fallback for any model without ISMCTS config
    const action = heuristicSelectAction(state, actions);
    return {
      action,
      childStats: [],
      value: 0,
      searchTimeMs: 0,
      nodeCount: 0,
      config: { determinizations: 0, simulations: 0 },
    };
  }

  const { determinizations, simulations } = model.ismctsConfig;
  const ismcts = new ISMCTS({
    numDeterminizations: determinizations,
    numSimulations: simulations,
    encodeStateFn: GameEngine.encodeState.bind(GameEngine),
    evaluateTerminalFn: evaluateTerminal,
  });

  // Use neural network adapter if available and mode requests it
  const useNeural = model.useNeural && cachedNetworkAdapter;
  const network: PolicyValueNetwork | undefined = useNeural
    ? cachedNetworkAdapter!
    : undefined;

  const startTime = performance.now();

  const result = await ismcts.search(
    state,
    network,
    GameEngine.getLegalActions.bind(GameEngine),
    GameEngine.applyAction.bind(GameEngine),
    state.currentPlayer as 0 | 1,
    (s, p) => GameEngine.determinize(s, p, deterministicSeed++),
    onProgress,
  );

  const elapsed = performance.now() - startTime;
  const stats = ismcts.getTreeStats();

  return {
    action: result.action,
    childStats: result.childStats,
    value: result.value,
    searchTimeMs: elapsed,
    nodeCount: stats.nodeCount,
    config: { determinizations, simulations },
  };
}

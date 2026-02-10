import { GameEngine } from '../engine/game-engine.js';
import { ISMCTS, type ISMCTSConfig, type ChildStat } from './ismcts/ismcts.js';
import type { GameState, Action } from '../engine/types.js';

export type AIMode = 'heuristic' | 'ismcts-lite' | 'ismcts-full';

export interface AISearchResult {
  action: Action;
  childStats: ChildStat[];
  value: number;
  searchTimeMs: number;
  nodeCount: number;
  config: { determinizations: number; simulations: number };
}

const PRESETS: Record<Exclude<AIMode, 'heuristic'>, Partial<ISMCTSConfig>> = {
  'ismcts-lite': { numDeterminizations: 5, numSimulations: 30 },
  'ismcts-full': { numDeterminizations: 30, numSimulations: 200 },
};

function evaluateTerminal(state: GameState, currentPlayer: 0 | 1): number {
  if (state.winner === null) return 0;
  return state.winner === currentPlayer ? 1 : -1;
}

function heuristicSelectAction(state: GameState, actions: Action[]): Action {
  const { GamePhase, ActionType } = await_types();
  if (state.phase === 'AttackPhase') {
    const attacks = actions.filter(a => a.type === 'Attack');
    if (attacks.length > 0) {
      const active = state.players[state.currentPlayer].active;
      if (active) {
        return attacks.reduce((best, a) => {
          const dmgA = active.card.attacks[a.payload.attackIndex]?.damage ?? 0;
          const dmgB = active.card.attacks[best.payload.attackIndex]?.damage ?? 0;
          return dmgA > dmgB ? a : best;
        });
      }
      return attacks[0];
    }
    return actions.find(a => a.type === 'Pass') || actions[0];
  }

  const playPokemon = actions.filter(a => a.type === 'PlayPokemon');
  const attachEnergy = actions.filter(a => a.type === 'AttachEnergy');
  const playTrainer = actions.filter(a => a.type === 'PlayTrainer');

  if (playPokemon.length > 0) {
    return playPokemon[Math.floor(Math.random() * playPokemon.length)];
  }
  if (attachEnergy.length > 0) {
    const toActive = attachEnergy.filter(a => a.payload.target === 'active');
    if (toActive.length > 0) return toActive[0];
    return attachEnergy[0];
  }
  if (playTrainer.length > 0) {
    return playTrainer[Math.floor(Math.random() * playTrainer.length)];
  }
  return actions.find(a => a.type === 'Pass') || actions[0];
}

// Avoid importing enum values to keep this module simple
function await_types() {
  return {
    GamePhase: { AttackPhase: 'AttackPhase' },
    ActionType: { Attack: 'Attack', Pass: 'Pass', PlayPokemon: 'PlayPokemon', AttachEnergy: 'AttachEnergy', PlayTrainer: 'PlayTrainer' },
  };
}

let deterministicSeed = 0;

export async function searchAction(
  state: GameState,
  actions: Action[],
  mode: AIMode,
  onProgress?: (det: number, total: number) => void,
): Promise<AISearchResult> {
  if (mode === 'heuristic') {
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

  const preset = PRESETS[mode];
  const ismcts = new ISMCTS({
    ...preset,
    encodeStateFn: GameEngine.encodeState.bind(GameEngine),
    evaluateTerminalFn: evaluateTerminal,
  });

  const startTime = performance.now();

  const result = await ismcts.search(
    state,
    undefined, // no neural network yet - uses DefaultNetwork (uniform priors)
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
    config: {
      determinizations: preset.numDeterminizations!,
      simulations: preset.numSimulations!,
    },
  };
}

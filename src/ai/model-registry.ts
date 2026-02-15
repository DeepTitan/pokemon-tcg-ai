import type { GameState, Action } from '../engine/types.js';
import type { AISearchResult } from './ai-bridge.js';

export interface AIModel {
  id: string;
  name: string;
  description: string;
  /** Whether this model runs async (ISMCTS) vs sync (heuristic) */
  async: boolean;
  /** Whether the model supports progress reporting */
  hasProgress: boolean;
  /** ISMCTS config if applicable */
  ismctsConfig?: { determinizations: number; simulations: number };
  /** Whether to use neural network priors (requires loaded weights) */
  useNeural?: boolean;
}

const models: AIModel[] = [
  {
    id: 'heuristic',
    name: 'Heuristic',
    description: 'Instant scoring-based AI',
    async: false,
    hasProgress: false,
  },
  {
    id: 'ismcts-lite',
    name: 'Lite',
    description: 'ISMCTS 5×30 (~150 sims)',
    async: true,
    hasProgress: true,
    ismctsConfig: { determinizations: 5, simulations: 30 },
  },
  {
    id: 'ismcts-full',
    name: 'Full',
    description: 'ISMCTS 15×100 (~1500 sims)',
    async: true,
    hasProgress: true,
    ismctsConfig: { determinizations: 15, simulations: 100 },
  },
  {
    id: 'neural-ismcts',
    name: 'Neural',
    description: 'Neural ISMCTS 5×50 (trained network)',
    async: true,
    hasProgress: true,
    ismctsConfig: { determinizations: 5, simulations: 50 },
    useNeural: true,
  },
];

/** Get all registered AI models */
export function getModels(): readonly AIModel[] {
  return models;
}

/** Get a model by id */
export function getModel(id: string): AIModel | undefined {
  return models.find(m => m.id === id);
}

/** Get all model IDs (for typing) */
export function getModelIds(): string[] {
  return models.map(m => m.id);
}

/** Register a new AI model at runtime */
export function registerModel(model: AIModel): void {
  const existing = models.findIndex(m => m.id === model.id);
  if (existing >= 0) {
    models[existing] = model;
  } else {
    models.push(model);
  }
}

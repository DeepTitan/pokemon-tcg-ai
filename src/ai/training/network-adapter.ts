/**
 * Network-ISMCTS Adapter (Architecture-Agnostic)
 *
 * Wraps trained weights for the action-scoring architecture,
 * implementing the ISMCTS PolicyValueNetwork interface.
 *
 * The forward pass is driven by a graph manifest embedded in the weights JSON.
 * Changing model architecture in Python (adding layers, changing sizes, new
 * activations) requires NO changes to this file — the manifest describes
 * the exact sequence of operations to execute.
 *
 * Uses raw Float32Array math (no TF.js dependency) for fast synchronous inference.
 */

import type { GameState, Action, EncodedGameState } from '../../engine/types.js';
import type { PolicyValueNetwork } from '../ismcts/ismcts.js';
import { encodeAction, ACTION_ENCODING_SIZE } from './action-encoding.js';

const STATE_SIZE = 501;

// ============================================================================
// TYPES
// ============================================================================

export interface LayerWeights {
  kernel: number[][];
  bias: number[];
}

export interface LayerNormWeights {
  gamma: number[];
  beta: number[];
}

export interface GraphOp {
  op: 'linear' | 'layernorm' | 'relu' | 'tanh' | 'gelu';
  key?: string;
}

export interface GraphManifest {
  state_encoder: GraphOp[];
  value_state_encoder?: GraphOp[];  // Separate encoder for value head (optional for backward compat)
  action_encoder: GraphOp[];
  action_scorer: GraphOp[];
  value_head: GraphOp[];
}

export interface ModelMeta {
  version: number;
  state_size: number;
  action_size: number;
  graph: GraphManifest;
}

export interface ModelWeights {
  _meta: ModelMeta;
  [key: string]: any;
}

// ============================================================================
// RAW MATH OPERATIONS
// ============================================================================

function matmul(input: Float32Array, kernel: number[][], bias: number[]): Float32Array {
  const inSize = kernel.length;
  const outSize = kernel[0].length;
  const output = new Float32Array(outSize);
  for (let j = 0; j < outSize; j++) {
    let sum = bias[j];
    for (let i = 0; i < inSize; i++) {
      sum += input[i] * kernel[i][j];
    }
    output[j] = sum;
  }
  return output;
}

function relu(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    out[i] = x[i] > 0 ? x[i] : 0;
  }
  return out;
}

function gelu(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    // GELU approximation: 0.5 * x * (1 + tanh(sqrt(2/pi) * (x + 0.044715 * x^3)))
    const v = x[i];
    out[i] = 0.5 * v * (1 + Math.tanh(0.7978845608 * (v + 0.044715 * v * v * v)));
  }
  return out;
}

function layerNorm(x: Float32Array, gamma: number[], beta: number[]): Float32Array {
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;

  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i] - mean;
    variance += d * d;
  }
  variance /= n;

  const std = Math.sqrt(variance + 1e-5);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = gamma[i] * ((x[i] - mean) / std) + beta[i];
  }
  return out;
}

function tanhActivation(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    out[i] = Math.tanh(x[i]);
  }
  return out;
}

function softmax(scores: number[]): number[] {
  let max = -Infinity;
  for (const s of scores) {
    if (s > max) max = s;
  }
  const exps = scores.map(s => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

// ============================================================================
// GRAPH EXECUTOR
// ============================================================================

/**
 * Execute a sequence of operations on an input tensor.
 * The ops come from the graph manifest in the weights JSON.
 */
function runGraph(input: Float32Array, ops: GraphOp[], weights: any): Float32Array {
  let x = input;
  for (const op of ops) {
    switch (op.op) {
      case 'linear':
        x = matmul(x, weights[op.key!].kernel, weights[op.key!].bias);
        break;
      case 'layernorm':
        x = layerNorm(x, weights[op.key!].gamma, weights[op.key!].beta);
        break;
      case 'relu':
        x = relu(x);
        break;
      case 'gelu':
        x = gelu(x);
        break;
      case 'tanh':
        x = tanhActivation(x);
        break;
      default:
        throw new Error(`Unknown op: ${(op as any).op}`);
    }
  }
  return x;
}

// ============================================================================
// NETWORK ADAPTER
// ============================================================================

export class NetworkISMCTSAdapter implements PolicyValueNetwork {
  private weights: ModelWeights;
  private graph: GraphManifest;
  private currentState: GameState | null = null;
  private currentActions: Action[] = [];

  constructor(weights: ModelWeights) {
    this.weights = weights;

    const meta = weights._meta;
    if (!meta || !meta.graph) {
      throw new Error(
        'Weights missing _meta.graph manifest. Re-export from Python with latest model.py.'
      );
    }
    if (meta.state_size !== STATE_SIZE) {
      throw new Error(`State size mismatch: weights=${meta.state_size}, expected=${STATE_SIZE}`);
    }
    if (meta.action_size !== ACTION_ENCODING_SIZE) {
      throw new Error(`Action size mismatch: weights=${meta.action_size}, expected=${ACTION_ENCODING_SIZE}`);
    }

    this.graph = meta.graph;
  }

  setContext(state: GameState, legalActions: Action[]): void {
    this.currentState = state;
    this.currentActions = legalActions;
  }

  predictSync(encoded: EncodedGameState): { policy: Map<string, number>; value: number } {
    const w = this.weights;
    const g = this.graph;

    // State encoder (policy path): driven by manifest
    const stateEmbed = runGraph(encoded.buffer, g.state_encoder, w);

    // Value state encoder: separate encoder if available, else reuse policy encoder
    const valueStateEmbed = g.value_state_encoder
      ? runGraph(encoded.buffer, g.value_state_encoder, w)
      : stateEmbed;

    // Value head: driven by manifest
    const valueOut = runGraph(valueStateEmbed, g.value_head, w);
    const value = valueOut[0];

    // If no context, return value only with empty policy
    if (!this.currentState || this.currentActions.length === 0) {
      return { policy: new Map<string, number>(), value };
    }

    // Score each legal action
    const scores: number[] = [];
    for (const action of this.currentActions) {
      const actionVec = encodeAction(action, this.currentState);

      // Action encoder: driven by manifest
      const actionEmbed = runGraph(actionVec, g.action_encoder, w);

      // Concatenate state + action embeddings
      const concat = new Float32Array(stateEmbed.length + actionEmbed.length);
      concat.set(stateEmbed, 0);
      concat.set(actionEmbed, stateEmbed.length);

      // Action scorer: driven by manifest
      const scoreOut = runGraph(concat, g.action_scorer, w);
      scores.push(scoreOut[0]);
    }

    // Softmax over scores to get policy distribution
    const probs = softmax(scores);
    const policy = new Map<string, number>();
    for (let i = 0; i < this.currentActions.length; i++) {
      const key = JSON.stringify(this.currentActions[i]);
      policy.set(key, probs[i]);
    }

    return { policy, value };
  }

  async predict(encoded: EncodedGameState): Promise<{ policy: Map<string, number>; value: number }> {
    return this.predictSync(encoded);
  }
}

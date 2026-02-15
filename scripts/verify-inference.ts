/**
 * Verify TypeScript inference matches Python inference.
 *
 * Loads test weights + test case exported by training/verify_inference.py,
 * runs the same inputs through the graph-driven TS forward pass,
 * and compares outputs to catch any drift.
 *
 * Usage:
 *   python3 training/verify_inference.py
 *   node --import tsx scripts/verify-inference.ts
 */

import { loadWeightsFromFile } from '../src/ai/training/weight-loader.js';
import type { GraphOp } from '../src/ai/training/network-adapter.js';
import * as fs from 'fs';

// ============================================================================
// Math ops (must match network-adapter.ts exactly)
// ============================================================================

function matmul(input: Float32Array, kernel: number[][], bias: number[]): Float32Array {
  const inSize = kernel.length;
  const outSize = kernel[0].length;
  const output = new Float32Array(outSize);
  for (let j = 0; j < outSize; j++) {
    let sum = bias[j];
    for (let i = 0; i < inSize; i++) sum += input[i] * kernel[i][j];
    output[j] = sum;
  }
  return output;
}

function relu(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] > 0 ? x[i] : 0;
  return out;
}

function layerNorm(x: Float32Array, gamma: number[], beta: number[]): Float32Array {
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) { const d = x[i] - mean; variance += d * d; }
  variance /= n;
  const std = Math.sqrt(variance + 1e-5);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = gamma[i] * ((x[i] - mean) / std) + beta[i];
  return out;
}

function tanhAct(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.tanh(x[i]);
  return out;
}

function runGraph(input: Float32Array, ops: GraphOp[], weights: any): Float32Array {
  let x = input;
  for (const op of ops) {
    switch (op.op) {
      case 'linear': x = matmul(x, weights[op.key!].kernel, weights[op.key!].bias); break;
      case 'layernorm': x = layerNorm(x, weights[op.key!].gamma, weights[op.key!].beta); break;
      case 'relu': x = relu(x); break;
      case 'tanh': x = tanhAct(x); break;
    }
  }
  return x;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const weights = await loadWeightsFromFile('models/test_weights.json');
  const testCase = JSON.parse(fs.readFileSync('models/test_case.json', 'utf-8'));
  const meta = (weights as any)._meta;

  if (!meta || !meta.graph) {
    console.error('ERROR: Weights missing _meta.graph. Re-export with latest model.py.');
    process.exit(1);
  }

  const graph = meta.graph;
  const stateBuffer = new Float32Array(testCase.state);
  const actionArrays: Float32Array[] = testCase.actions.map(
    (a: number[]) => new Float32Array(a)
  );

  // Run forward pass using graph manifest (same as NetworkISMCTSAdapter)
  const stateEmbed = runGraph(stateBuffer, graph.state_encoder, weights);

  // Value uses separate encoder if available, else reuses policy encoder
  const valueStateEmbed = graph.value_state_encoder
    ? runGraph(stateBuffer, graph.value_state_encoder, weights)
    : stateEmbed;
  const valueOut = runGraph(valueStateEmbed, graph.value_head, weights);
  const value = valueOut[0];

  const scores: number[] = [];
  for (const actionVec of actionArrays) {
    const actionEmbed = runGraph(actionVec, graph.action_encoder, weights);
    const concat = new Float32Array(stateEmbed.length + actionEmbed.length);
    concat.set(stateEmbed, 0);
    concat.set(actionEmbed, stateEmbed.length);
    const scoreOut = runGraph(concat, graph.action_scorer, weights);
    scores.push(scoreOut[0]);
  }

  // Compare with Python outputs
  const expectedScores = testCase.expected_scores as number[];
  const expectedValue = testCase.expected_value as number;

  console.log('=== Inference Verification ===\n');
  console.log('Value:');
  console.log(`  Python:     ${expectedValue.toFixed(6)}`);
  console.log(`  TypeScript: ${value.toFixed(6)}`);
  console.log(`  Diff:       ${Math.abs(value - expectedValue).toExponential(2)}`);

  console.log('\nScores:');
  let maxDiff = 0;
  for (let i = 0; i < scores.length; i++) {
    const diff = Math.abs(scores[i] - expectedScores[i]);
    maxDiff = Math.max(maxDiff, diff);
    console.log(
      `  [${i}] Python=${expectedScores[i].toFixed(4)} TS=${scores[i].toFixed(4)} diff=${diff.toExponential(2)}`
    );
  }

  console.log(`\nMax score diff: ${maxDiff.toExponential(2)}`);
  const valueDiff = Math.abs(value - expectedValue);

  const threshold = 1e-4;
  if (maxDiff < threshold && valueDiff < threshold) {
    console.log('\nVERIFICATION PASSED: Python and TypeScript inference match.');
  } else {
    console.log('\nVERIFICATION FAILED: Outputs diverge beyond threshold.');
    process.exit(1);
  }
}

main().catch(console.error);

/**
 * Weight Loader
 *
 * Loads model weights from JSON files exported by Python training.
 * Works in both Node.js (fs) and browser (fetch) environments.
 */

import type { ModelWeights } from './network-adapter.js';

/**
 * Load weights from a JSON file (Node.js environment).
 */
export async function loadWeightsFromFile(filepath: string): Promise<ModelWeights> {
  const fs = await import('fs');
  const data = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(data) as ModelWeights;
}

/**
 * Load weights from a URL (browser environment).
 */
export async function loadWeightsFromURL(url: string): Promise<ModelWeights> {
  const response = await fetch(url);
  return response.json() as Promise<ModelWeights>;
}

/**
 * Load weights, auto-detecting environment.
 */
export async function loadWeights(pathOrUrl: string): Promise<ModelWeights> {
  if (typeof window !== 'undefined') {
    return loadWeightsFromURL(pathOrUrl);
  }
  return loadWeightsFromFile(pathOrUrl);
}

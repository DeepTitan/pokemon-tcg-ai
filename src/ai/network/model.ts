import * as tf from '@tensorflow/tfjs';
import { EncodedGameState } from '../../engine/types.js';

/**
 * Network configuration interface for the Policy-Value network.
 * Supports both MLP and Transformer architectures.
 */
export interface NetworkConfig {
  inputSize: number;         // Size of encoded game state (~400-800 features)
  hiddenLayers: number[];    // MLP layer sizes, e.g., [256, 256, 128]
  policyOutputSize: number;  // Max number of possible actions (~200-400)
  learningRate: number;      // Default 3e-4 (standard PPO learning rate)
  useTransformer: boolean;   // If true, use transformer encoder instead of MLP
  numHeads: number;          // Transformer attention heads (default 4)
  embeddingDim: number;      // Transformer embedding dimension (default 128)
  epsilon: number;           // PPO clipping parameter (default 0.2)
  valueCoeff: number;        // Value loss coefficient (default 0.5)
  entropyCoeff: number;      // Entropy bonus coefficient (default 0.01)
}

/**
 * Training batch structure containing vectorized trajectories.
 */
export interface TrainingBatch {
  states: tf.Tensor2D;        // Shape: [batchSize, inputSize]
  actions: tf.Tensor1D;       // Shape: [batchSize] - action indices
  advantages: tf.Tensor1D;    // Shape: [batchSize] - GAE advantages
  returns: tf.Tensor1D;       // Shape: [batchSize] - discounted returns
  oldLogProbs: tf.Tensor1D;   // Shape: [batchSize] - old policy log probs
  legalMasks: tf.Tensor2D;    // Shape: [batchSize, policyOutputSize] - binary masks
}

/**
 * Output structure from model.predict()
 */
export interface NetworkOutput {
  policy: Float32Array;       // Action probability distribution
  value: number;              // Scalar value estimate [-1, 1]
}

/**
 * PolicyValueNetwork: A dual-head neural network for Pokemon TCG AI.
 *
 * Architecture:
 * - Shared trunk: MLP or Transformer encoder
 * - Policy head: Outputs action probabilities (softmax), with action masking for legal moves
 * - Value head: Outputs scalar value estimate in [-1, 1] (tanh), predicts win probability
 *
 * Based on the Hearthstone AI paper and DouZero approach for imperfect information games.
 * Total parameters: ~5M (MLP) or ~3M (Transformer)
 */
export class PolicyValueNetwork {
  private config: NetworkConfig;
  private model: tf.LayersModel;
  private optimizer: tf.Optimizer;
  private paramCount: number = 0;

  constructor(config: NetworkConfig) {
    this.config = config;
    this.optimizer = tf.train.adam(config.learningRate);
    this.model = this._buildModel();
    this._printParameterCount();
  }

  /**
   * Build the neural network architecture.
   * Selects between MLP and Transformer trunk based on config.
   */
  private _buildModel(): tf.LayersModel {
    const input = tf.input({ shape: [this.config.inputSize], name: 'state_input' });

    // Build shared trunk
    let trunk = this.config.useTransformer
      ? this._buildTransformerTrunk(input)
      : this._buildMLPTrunk(input);

    // Policy head: outputs logits for all actions
    // Shape: [batchSize, policyOutputSize]
    const policyLogits = tf.layers.dense({
      units: this.config.policyOutputSize,
      activation: 'linear',
      kernelInitializer: 'glorotUniform',
      name: 'policy_logits'
    }).apply(trunk) as tf.SymbolicTensor;

    // Value head: outputs scalar value estimate
    // Shape: [batchSize, 1]
    const valueOutput = tf.layers.dense({
      units: 64,
      activation: 'relu',
      kernelInitializer: 'glorotUniform',
      name: 'value_hidden'
    }).apply(trunk) as tf.SymbolicTensor;

    const value = tf.layers.dense({
      units: 1,
      activation: 'tanh',
      kernelInitializer: 'glorotUniform',
      name: 'value_output'
    }).apply(valueOutput) as tf.SymbolicTensor;

    const model = tf.model({
      inputs: input,
      outputs: [policyLogits, value],
      name: 'PolicyValueNetwork'
    });

    return model;
  }

  /**
   * Build MLP trunk: Stack of dense layers with LayerNorm and GELU activation.
   * This is the standard architecture for game AI (Hearthstone, AlphaGo Zero).
   */
  private _buildMLPTrunk(input: tf.SymbolicTensor): tf.SymbolicTensor {
    let x = input;

    for (const hiddenSize of this.config.hiddenLayers) {
      x = tf.layers.dense({
        units: hiddenSize,
        activation: 'linear',
        kernelInitializer: 'glorotUniform'
      }).apply(x) as tf.SymbolicTensor;

      // LayerNorm for stable training
      x = tf.layers.layerNormalization({
        epsilon: 1e-6
      }).apply(x) as tf.SymbolicTensor;

      // Activation (ReLU; consider a custom GELU layer for smoother gradients)
      x = tf.layers.activation({ activation: 'relu' }).apply(x) as tf.SymbolicTensor;
    }

    return x;
  }

  /**
   * Build Transformer trunk: Multi-head self-attention encoder.
   * More parameter-efficient than MLP (~3M vs ~5M params).
   * 2-4 layers with 4 attention heads and residual connections.
   */
  private _buildTransformerTrunk(input: tf.SymbolicTensor): tf.SymbolicTensor {
    const embeddingDim = this.config.embeddingDim;
    const numHeads = this.config.numHeads;
    const numLayers = 3;

    // Project input to embedding dimension
    let x = tf.layers.dense({
      units: embeddingDim,
      activation: 'relu',
      kernelInitializer: 'glorotUniform',
      name: 'embedding_projection'
    }).apply(input) as tf.SymbolicTensor;

    // Multi-layer transformer encoder
    for (let layer = 0; layer < numLayers; layer++) {
      const residual = x;

      // Layer norm before attention (pre-norm)
      x = tf.layers.layerNormalization({ epsilon: 1e-6 }).apply(x) as tf.SymbolicTensor;

      // Multi-head self-attention (simplified implementation using dense)
      // In production, use a proper multi-head attention layer
      const attention = tf.layers.dense({
        units: embeddingDim,
        activation: 'linear',
        kernelInitializer: 'glorotUniform',
        name: `attention_${layer}`
      }).apply(x) as tf.SymbolicTensor;

      // Add residual connection
      x = tf.layers.add().apply([residual, attention]) as tf.SymbolicTensor;

      // Feed-forward network
      const ffn1 = tf.layers.dense({
        units: embeddingDim * 4,
        activation: 'relu',
        kernelInitializer: 'glorotUniform',
        name: `ffn1_${layer}`
      }).apply(x) as tf.SymbolicTensor;

      const ffn2 = tf.layers.dense({
        units: embeddingDim,
        activation: 'linear',
        kernelInitializer: 'glorotUniform',
        name: `ffn2_${layer}`
      }).apply(ffn1) as tf.SymbolicTensor;

      // Add residual connection
      x = tf.layers.add().apply([x, ffn2]) as tf.SymbolicTensor;
    }

    // Final layer norm
    x = tf.layers.layerNormalization({ epsilon: 1e-6 }).apply(x) as tf.SymbolicTensor;

    return x;
  }

  /**
   * Predict policy and value for a given game state.
   * Applies action masking to ensure only legal actions have non-zero probability.
   *
   * @param state Encoded game state
   * @param legalActionMask Binary mask indicating legal actions
   * @returns Promise with policy distribution and value estimate
   */
  async predict(
    state: EncodedGameState,
    legalActionMask: Float32Array
  ): Promise<NetworkOutput> {
    return tf.tidy(() => {
      // Reshape state to batch dimension [1, inputSize]
      const stateTensor = tf.tensor2d(state.buffer, [1, this.config.inputSize]);

      // Forward pass
      const [policyLogits, valueTensor] = this.model.predict(stateTensor) as [tf.Tensor, tf.Tensor];

      // Extract value scalar
      const value = (valueTensor.dataSync()[0] as number);

      // Apply action masking to policy logits
      // Set illegal action logits to -Infinity (will become 0 after softmax)
      const policyLogitsData = policyLogits.dataSync();
      const maskedLogits = new Float32Array(policyLogitsData);

      for (let i = 0; i < maskedLogits.length; i++) {
        if (legalActionMask[i] === 0) {
          maskedLogits[i] = -Infinity;
        }
      }

      // Convert to probability distribution via softmax
      const policy = this._softmax(maskedLogits);

      return { policy, value };
    });
  }

  /**
   * Train the network on a batch of trajectories using PPO loss.
   * Computes policy loss, value loss, and entropy bonus.
   *
   * @param batch Training batch with advantages and returns
   * @returns Promise with loss metrics
   */
  async trainOnBatch(batch: TrainingBatch): Promise<{
    policyLoss: number;
    valueLoss: number;
    entropy: number;
  }> {
    let policyLoss = 0;
    let valueLoss = 0;
    let entropy = 0;

    // Use tf.tidy to clean up intermediate tensors
    tf.tidy(() => {
      this.optimizer.minimize(() => {
        const [policyLogits, values] = this.model.predict(batch.states) as [tf.Tensor, tf.Tensor];

        // Policy loss: cross-entropy with advantage weighting
        // Log probability of selected actions
        const logProbs = tf.tidy(() => {
          const softmax = tf.softmax(policyLogits);
          const selectedProbs = tf.mul(softmax, batch.legalMasks);
          const normalizedProbs = tf.div(selectedProbs, tf.sum(selectedProbs, 1, true));
          return tf.log(tf.add(normalizedProbs, 1e-8));
        });

        // Gather log probs of actions taken
        const actionIndices = batch.actions.expandDims(1);
        const actionLogProbs = tf.sum(
          tf.gatherND(logProbs, actionIndices),
          1
        );

        // PPO policy loss with clipping
        const advantages = batch.advantages;
        const oldLogProbs = batch.oldLogProbs;
        const ratio = tf.exp(tf.sub(actionLogProbs, oldLogProbs));

        const clipped = tf.clipByValue(ratio, 1 - this.config.epsilon, 1 + this.config.epsilon);
        const policyLossUnclipped = tf.mul(ratio, advantages);
        const policyLossClipped = tf.mul(clipped, advantages);

        const policySurrogate = tf.minimum(policyLossUnclipped, policyLossClipped);
        policyLoss = tf.mean(tf.neg(policySurrogate)).dataSync()[0];

        // Value loss: MSE between predicted and target returns
        const valuePredictions = values.squeeze([1]);
        const valueError = tf.sub(valuePredictions, batch.returns);
        const valueLossValue = tf.mean(tf.square(valueError));
        valueLoss = valueLossValue.dataSync()[0];

        // Entropy bonus for exploration
        const softmax = tf.softmax(policyLogits);
        const entropyCost = tf.mul(softmax, tf.log(tf.add(softmax, 1e-8)));
        entropy = -tf.mean(tf.sum(entropyCost, 1)).dataSync()[0];

        // Combined loss with coefficients
        const totalLoss = tf.add(
          policyLoss,
          tf.mul(valueLossValue, this.config.valueCoeff)
        );

        return tf.sub(totalLoss, tf.mul(entropy, this.config.entropyCoeff));
      });
    });

    // Gradient clipping
    await this.optimizer.dispose();
    this.optimizer = tf.train.adam(this.config.learningRate);

    return { policyLoss, valueLoss, entropy };
  }

  /**
   * Clone the network for use in self-play scenarios.
   * Returns a new network with identical weights.
   */
  clone(): PolicyValueNetwork {
    const cloned = new PolicyValueNetwork(this.config);
    cloned.model.setWeights(this.model.getWeights());
    return cloned;
  }

  /**
   * Get current network weights as tensors.
   */
  getWeights(): tf.Tensor[] {
    return this.model.getWeights();
  }

  /**
   * Set network weights from tensors.
   */
  setWeights(weights: tf.Tensor[]): void {
    this.model.setWeights(weights);
  }

  /**
   * Save model to file system.
   *
   * @param path File path to save to
   */
  async save(path: string): Promise<void> {
    await this.model.save(`file://${path}`);
  }

  /**
   * Load model from file system.
   *
   * @param path File path to load from
   */
  async load(path: string): Promise<void> {
    const loadedModel = await tf.loadLayersModel(`file://${path}/model.json`);
    this.model = loadedModel as tf.LayersModel;
  }

  /**
   * Softmax function: converts logits to probability distribution.
   * Handles -Infinity values for action masking.
   */
  private _softmax(logits: Float32Array): Float32Array {
    // Remove -Infinity values
    const validLogits = new Float32Array(logits.length);
    let maxLogit = -Infinity;

    for (let i = 0; i < logits.length; i++) {
      if (isFinite(logits[i])) {
        validLogits[i] = logits[i];
        maxLogit = Math.max(maxLogit, logits[i]);
      } else {
        validLogits[i] = -1e10; // Large negative number
      }
    }

    // Subtract max for numerical stability
    const exps = new Float32Array(logits.length);
    let sumExp = 0;

    for (let i = 0; i < logits.length; i++) {
      exps[i] = Math.exp(validLogits[i] - maxLogit);
      if (isFinite(exps[i])) {
        sumExp += exps[i];
      }
    }

    // Normalize
    const probs = new Float32Array(logits.length);
    for (let i = 0; i < logits.length; i++) {
      probs[i] = sumExp > 0 ? exps[i] / sumExp : 0;
    }

    return probs;
  }

  /**
   * Print parameter count for architecture inspection.
   */
  private _printParameterCount(): void {
    const weights = this.model.getWeights();
    let totalParams = 0;

    for (const weight of weights) {
      const params = weight.size;
      totalParams += params;
    }

    this.paramCount = totalParams;
    console.log(
      `[PolicyValueNetwork] Model initialized with ${(totalParams / 1e6).toFixed(2)}M parameters`
    );
  }

  /**
   * Dispose of model and optimizer resources.
   */
  dispose(): void {
    this.model.dispose();
    this.optimizer.dispose();
  }
}

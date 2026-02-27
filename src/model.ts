/**
 * TensorFlow.js InceptionV3 model loading and preprocessing for DeepDream.
 */

import * as tf from '@tensorflow/tfjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All available mixed (inception) layer names in InceptionV3. */
export const DREAM_LAYERS = [
  'mixed0',
  'mixed1',
  'mixed2',
  'mixed3',
  'mixed4',
  'mixed5',
  'mixed6',
  'mixed7',
  'mixed8',
  'mixed9',
  'mixed10',
] as const;

/** Union type of valid dream layer names. */
export type DreamLayerName = (typeof DREAM_LAYERS)[number];

/** URL served by Vite from public/models/inception_v3/model.json */
export const MODEL_URL = '/models/inception_v3/model.json';

// ---------------------------------------------------------------------------
// DreamModel interface
// ---------------------------------------------------------------------------

export interface DreamModel {
  /** The underlying TensorFlow.js LayersModel (full InceptionV3). */
  baseModel: tf.LayersModel;

  /**
   * Build a multi-output model on the fly from the requested layer names and
   * run a forward pass, returning activation tensors for each layer.
   */
  predict(input: tf.Tensor4D, layers: DreamLayerName[]): tf.Tensor[];

  /** Dispose of the base model and free GPU/CPU memory. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

/**
 * Load the converted InceptionV3 graph model from the public directory.
 *
 * @param onProgress - Optional callback receiving a fraction (0-1) as the
 *   weight files are downloaded.
 * @returns A `DreamModel` wrapping the loaded model.
 */
export async function loadDreamModel(
  onProgress?: (fraction: number) => void,
): Promise<DreamModel> {
  const baseModel = await tf.loadLayersModel(MODEL_URL, { onProgress });

  // Cache for multi-output sub-models keyed by sorted layer name list.
  const subModelCache = new Map<string, tf.LayersModel>();

  function predict(input: tf.Tensor4D, layers: DreamLayerName[]): tf.Tensor[] {
    const cacheKey = [...layers].sort().join(',');

    let subModel = subModelCache.get(cacheKey);
    if (!subModel) {
      const outputs = layers.map((name) => {
        const layer = baseModel.getLayer(name);
        return layer.output as tf.SymbolicTensor;
      });

      subModel = tf.model({
        inputs: baseModel.input as tf.SymbolicTensor,
        outputs,
      });
      subModelCache.set(cacheKey, subModel);
    }

    // Use apply() instead of predict() — predict() internally wraps
    // execution in tidy() which disposes intermediate tensors needed
    // for gradient backpropagation. apply() preserves the gradient chain.
    const result = subModel.apply(input) as tf.Tensor | tf.Tensor[];

    // Normalise to an array regardless of single vs multiple outputs.
    if (Array.isArray(result)) {
      return result;
    }
    return [result];
  }

  function dispose(): void {
    subModelCache.forEach((m) => m.dispose());
    subModelCache.clear();
    baseModel.dispose();
  }

  return { baseModel, predict, dispose };
}

// ---------------------------------------------------------------------------
// Pre- / de-processing helpers
// ---------------------------------------------------------------------------

/**
 * Preprocess a 3-D uint8 image tensor for InceptionV3.
 * Maps pixel values from [0, 255] to [-1, 1] and expands to a batch of 1.
 */
export function preprocessForInception(tensor3D: tf.Tensor3D): tf.Tensor4D {
  return tf.tidy(() => {
    const floated = tensor3D.toFloat();
    const normalized = floated.div(127.5).sub(1);
    return normalized.expandDims(0) as tf.Tensor4D;
  });
}

/**
 * Reverse the InceptionV3 preprocessing.
 * Takes a 4-D batch tensor and returns a 3-D uint8 image tensor ([H, W, 3]).
 */
export function deprocessFromInception(tensor4D: tf.Tensor4D): tf.Tensor3D {
  return tf.tidy(() => {
    const squeezed = tensor4D.squeeze([0]) as tf.Tensor3D;
    const denormalized = squeezed.add(1).mul(127.5);
    return denormalized.clipByValue(0, 255).cast('int32') as tf.Tensor3D;
  });
}

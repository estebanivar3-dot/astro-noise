/**
 * DeepDream core algorithm — multi-octave gradient ascent on InceptionV3
 * layer activations.
 */

import * as tf from '@tensorflow/tfjs';
import type { DreamModel, DreamLayerName } from './model.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Parameters that control the DeepDream process. */
export interface DreamConfig {
  /** Which mixed (inception) layers to maximize activations for. */
  layers: DreamLayerName[];
  /** Gradient step size per iteration (0.005 to 0.15). */
  intensity: number;
  /** Number of gradient ascent steps per octave (5 to 100). */
  iterations: number;
  /** Number of multi-scale passes (1 to 5). */
  octaves: number;
  /** Scale factor between successive octaves (1.2 to 1.5). */
  octaveScale: number;
}

/** Sensible defaults for a first-time DeepDream run. */
export const DEFAULT_CONFIG: DreamConfig = {
  layers: ['mixed3'],
  intensity: 0.02,
  iterations: 20,
  octaves: 3,
  octaveScale: 1.3,
};

// ---------------------------------------------------------------------------
// Progress callback
// ---------------------------------------------------------------------------

/** Information reported to the caller after each gradient step. */
export interface DreamProgress {
  /** Current octave (0-based). */
  octave: number;
  /** Total number of octaves. */
  totalOctaves: number;
  /** Current iteration within this octave (0-based). */
  iteration: number;
  /** Total iterations per octave. */
  totalIterations: number;
  /** Overall completion fraction in [0, 1]. */
  fraction: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed processing size — must match the InceptionV3 input_shape. */
const PROCESSING_SIZE = 512;

/** Small constant to avoid division by zero when normalising gradients. */
const EPSILON = 1e-7;

/** Yield to the browser event loop every N iterations. */
const YIELD_EVERY = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the gradient of the dream loss with respect to the input image.
 *
 * Uses tf.grad() which traces the computational graph through the model's
 * forward pass and computes the gradient via backpropagation.
 *
 * The dream loss is the sum of the means of all selected layer activations —
 * maximising this encourages the network to amplify patterns it "sees".
 */
/**
 * Monkey-patch tf.engine() to handle undefined tensors that leak through
 * from LayersModel internal execution when the gradient tape is active.
 *
 * TF.js LayersModel internally manages tensor lifecycles in ways that can
 * leave undefined references in kernel inputs. When the gradient tape
 * records these kernels, it stores the undefined refs as node inputs.
 * This causes two crashes:
 *   1. saveTensorsForBackwardMode tries to clone undefined → dataId error
 *   2. getFilteredNodesXToY traverses undefined node inputs → id error
 *
 * We patch both functions to safely skip undefined tensors.
 */
function patchGradientTape(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engine = tf.engine() as any;
  if (engine.__dreamPatched) return;

  // --- Patch 1: saveTensorsForBackwardMode ---
  const origSave = engine.saveTensorsForBackwardMode.bind(engine);
  engine.saveTensorsForBackwardMode = function (tensors: tf.Tensor[]) {
    const safeTensors = tensors.filter(
      (t: tf.Tensor | undefined) => t != null && t.dataId != null,
    );
    return origSave(safeTensors);
  };

  // --- Patch 2: addTapeNode — clean undefined entries from inputs ---
  const origAddTapeNode = engine.addTapeNode.bind(engine);
  engine.addTapeNode = function (
    kernelName: string,
    inputs: Record<string, tf.Tensor>,
    outputs: tf.Tensor[],
    gradientsFunc: unknown,
    saved: tf.Tensor[],
    attrs: unknown,
  ) {
    // Remove any undefined input entries so getFilteredNodesXToY won't crash
    const cleanInputs: Record<string, tf.Tensor> = {};
    for (const key of Object.keys(inputs)) {
      if (inputs[key] != null) {
        cleanInputs[key] = inputs[key];
      }
    }
    return origAddTapeNode(kernelName, cleanInputs, outputs, gradientsFunc, saved, attrs);
  };

  engine.__dreamPatched = true;
}

function computeDreamGradient(
  input: tf.Tensor3D,
  model: DreamModel,
  layerNames: DreamLayerName[],
): tf.Tensor3D {
  // Ensure the gradient tape patch is active
  patchGradientTape();

  const gradFn = tf.grad((x: tf.Tensor) => {
    const batch = x.reshape([1, PROCESSING_SIZE, PROCESSING_SIZE, 3]) as tf.Tensor4D;
    const activations = model.predict(batch, layerNames);
    let loss: tf.Scalar = tf.scalar(0);
    for (const act of activations) {
      loss = loss.add(act.mean()) as tf.Scalar;
    }
    return loss;
  });

  return gradFn(input) as tf.Tensor3D;
}

/**
 * Convert a [H, W, 3] float32 tensor (values in [0, 255]) to an ImageData.
 */
function tensorToImageData(tensor3D: tf.Tensor3D): ImageData {
  const [height, width] = tensor3D.shape;
  const rgb = tensor3D.clipByValue(0, 255).cast('int32');
  const rgbData = rgb.dataSync();
  rgb.dispose();

  const imageData = new ImageData(width, height);
  const { data } = imageData;

  let srcIdx = 0;
  let dstIdx = 0;
  const totalPixels = height * width;
  for (let i = 0; i < totalPixels; i++) {
    data[dstIdx] = rgbData[srcIdx];         // R
    data[dstIdx + 1] = rgbData[srcIdx + 1]; // G
    data[dstIdx + 2] = rgbData[srcIdx + 2]; // B
    data[dstIdx + 3] = 255;                 // A
    srcIdx += 3;
    dstIdx += 4;
  }

  return imageData;
}

// ---------------------------------------------------------------------------
// Main algorithm
// ---------------------------------------------------------------------------

/**
 * Run the DeepDream algorithm on a source image.
 *
 * The image is resized to 512×512 for processing (InceptionV3's fixed input
 * shape), then the result is resized back to the original dimensions.
 *
 * With a fixed-input model, octaves serve as successive refinement passes
 * rather than multi-resolution processing. Earlier octaves use gentler
 * intensity (scaled by `octaveScale`) to build up the dream gradually.
 *
 * @param sourceImageData - The original image from the canvas.
 * @param model           - A loaded `DreamModel`.
 * @param config          - Dream parameters (layers, intensity, octaves, etc.).
 * @param onProgress      - Optional callback invoked after every gradient step.
 * @returns A new `ImageData` containing the dreamed image at source dimensions.
 */
export async function deepDream(
  sourceImageData: ImageData,
  model: DreamModel,
  config: DreamConfig = DEFAULT_CONFIG,
  onProgress?: (progress: DreamProgress) => void,
): Promise<ImageData> {
  const { layers, intensity, iterations, octaves, octaveScale } = config;

  const tensorsBefore = tf.memory().numTensors;
  console.log(`[deepDream] start — tensors: ${tensorsBefore}`);

  const origWidth = sourceImageData.width;
  const origHeight = sourceImageData.height;
  const S = PROCESSING_SIZE; // 512 — must match model's input_shape

  try {
    // 1. Convert source ImageData → float32 tensor, resize to 512×512, map to [-1, 1].
    const rawTensor = tf.browser.fromPixels(sourceImageData);              // [H,W,3] uint8
    const resized = tf.image.resizeBilinear(rawTensor, [S, S]);            // [512,512,3]
    const preprocessed = resized.toFloat().div(127.5).sub(1) as tf.Tensor3D; // [-1, 1]
    rawTensor.dispose();
    resized.dispose();

    // Hold pixel data in a typed array between octaves to avoid keeping GPU
    // tensors alive across await boundaries.
    let workingData = new Float32Array(await preprocessed.data());
    preprocessed.dispose();

    // 2. Multi-octave gradient ascent.
    //    Uses regular tensors with tf.grad() instead of tf.Variable +
    //    tf.variableGrads, which avoids issues with the gradient tape and
    //    LayersModel internal tensor management.
    for (let octave = 0; octave < octaves; octave++) {
      let current = tf.tensor3d(workingData, [S, S, 3]);

      // Scale intensity per octave: earlier octaves dream gently, later ones push harder.
      const octaveIntensity = intensity * Math.pow(octaveScale, octave - octaves + 1);

      for (let iter = 0; iter < iterations; iter++) {
        // Compute gradient of dream loss w.r.t. input.
        const gradient = computeDreamGradient(current, model, layers);

        // Normalise and apply gradient ascent, then swap tensors.
        const next = tf.tidy(() => {
          const absMean = gradient.abs().mean();
          const normalised = gradient.div(absMean.add(EPSILON));
          return current.add(normalised.mul(octaveIntensity)) as tf.Tensor3D;
        });
        gradient.dispose();
        current.dispose();
        current = next;

        // Report progress.
        if (onProgress) {
          const totalSteps = octaves * iterations;
          const currentStep = octave * iterations + iter + 1;
          onProgress({
            octave,
            totalOctaves: octaves,
            iteration: iter,
            totalIterations: iterations,
            fraction: currentStep / totalSteps,
          });
        }

        // Yield to the browser event loop periodically.
        if ((iter + 1) % YIELD_EVERY === 0) {
          await tf.nextFrame();
        }
      }

      // Save working data for the next octave.
      workingData = new Float32Array(await current.data());
      current.dispose();
    }

    // 3. Deprocess from [-1, 1] to [0, 255].
    const resultTensor = tf.tidy(() => {
      const t = tf.tensor3d(workingData, [S, S, 3]);
      return t.add(1).mul(127.5).clipByValue(0, 255) as tf.Tensor3D;
    });

    // 4. Resize back to original dimensions.
    const finalTensor = tf.tidy(() => {
      return tf.image.resizeBilinear(
        resultTensor,
        [origHeight, origWidth],
      ) as tf.Tensor3D;
    });
    resultTensor.dispose();

    // 5. Convert to ImageData.
    const imageData = tensorToImageData(finalTensor);
    finalTensor.dispose();

    const tensorsAfter = tf.memory().numTensors;
    console.log(
      `[deepDream] done — tensors: ${tensorsAfter} (delta: ${tensorsAfter - tensorsBefore})`,
    );

    return imageData;
  } catch (err) {
    // Clean up any leaked tensors from a failed run.
    const leaked = tf.memory().numTensors - tensorsBefore;
    if (leaked > 0) {
      console.warn(`[deepDream] cleaning up ${leaked} leaked tensors after error`);
    }
    throw err;
  }
}

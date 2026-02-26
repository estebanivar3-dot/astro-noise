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

/** Maximum pixel dimension fed into WebGL to avoid driver limits. */
const MAX_PROCESSING_DIM = 512;

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
 * The dream loss is the sum of the means of all selected layer activations —
 * maximising this encourages the network to amplify patterns it "sees".
 *
 * @param inputVar   - A `tf.Variable` holding the current working image ([H,W,3]).
 * @param model      - The loaded DreamModel.
 * @param layerNames - Which layers to maximise.
 * @returns The gradient tensor (same shape as inputVar).
 */
function computeDreamGradient(
  inputVar: tf.Variable<tf.Rank.R3>,
  model: DreamModel,
  layerNames: DreamLayerName[],
): tf.Tensor3D {
  const { grads } = tf.variableGrads(() => {
    const batch = inputVar.expandDims(0) as tf.Tensor4D;
    const activations = model.predict(batch, layerNames);
    const toDispose: tf.Tensor[] = [batch];
    let loss: tf.Tensor = tf.scalar(0);
    toDispose.push(loss);
    for (const act of activations) {
      const mean = act.mean();
      const newLoss = loss.add(mean);
      toDispose.push(mean, act);
      loss = newLoss;
    }
    for (const t of toDispose) {
      t.dispose();
    }
    return loss as tf.Scalar;
  });

  const gradient = grads[inputVar.name];
  // Dispose all other gradient tensors that may have been returned.
  for (const key of Object.keys(grads)) {
    if (key !== inputVar.name) {
      grads[key].dispose();
    }
  }

  return gradient as tf.Tensor3D;
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

/**
 * Calculate target dimensions such that the longest side is at most
 * `MAX_PROCESSING_DIM`, preserving aspect ratio.
 */
function clampDimensions(
  width: number,
  height: number,
): [number, number] {
  const longest = Math.max(width, height);
  if (longest <= MAX_PROCESSING_DIM) {
    return [height, width];
  }
  const scale = MAX_PROCESSING_DIM / longest;
  return [
    Math.round(height * scale),
    Math.round(width * scale),
  ];
}

// ---------------------------------------------------------------------------
// Main algorithm
// ---------------------------------------------------------------------------

/**
 * Run the DeepDream algorithm on a source image.
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

  // 1. Calculate safe processing dimensions.
  const [procH, procW] = clampDimensions(origWidth, origHeight);

  // 2. Convert source ImageData to a float32 tensor and preprocess to [-1, 1].
  const rawTensor = tf.browser.fromPixels(sourceImageData);                    // [H,W,3] uint8
  const resized = tf.image.resizeBilinear(rawTensor, [procH, procW]);          // [procH,procW,3]
  const preprocessed = resized.toFloat().div(127.5).sub(1) as tf.Tensor3D;     // [-1, 1]
  rawTensor.dispose();
  resized.dispose();

  // The working image data is held in a typed array between octaves to avoid
  // keeping GPU tensors alive across await boundaries.
  let workingData = new Float32Array(await preprocessed.data());
  preprocessed.dispose();

  // 3. Multi-octave loop.
  for (let octave = 0; octave < octaves; octave++) {
    // 3a. Calculate dimensions for this octave.
    const octaveFactor = Math.pow(octaveScale, octave - octaves + 1);
    const octaveH = Math.round(procH * octaveFactor);
    const octaveW = Math.round(procW * octaveFactor);

    // Resize working image to this octave's dimensions.
    const workTensor = tf.tensor3d(
      workingData,
      [procH, procW, 3],
    );
    const octaveImg = tf.image.resizeBilinear(
      workTensor,
      [octaveH, octaveW],
    ) as tf.Tensor3D;
    workTensor.dispose();

    // Create a variable for gradient computation.
    const inputVar = tf.variable(octaveImg) as tf.Variable<tf.Rank.R3>;
    octaveImg.dispose();

    // 3b. Gradient ascent iterations within this octave.
    for (let iter = 0; iter < iterations; iter++) {
      // Compute gradient of dream loss w.r.t. input.
      const gradient = computeDreamGradient(inputVar, model, layers);

      // Normalise gradient: divide by (mean(|grad|) + epsilon).
      const updated = tf.tidy(() => {
        const absMean = gradient.abs().mean();
        const normalised = gradient.div(absMean.add(EPSILON));
        // Gradient ASCENT: add normalised gradient scaled by intensity.
        return inputVar.add(normalised.mul(intensity)) as tf.Tensor3D;
      });
      gradient.dispose();

      // Update the variable in-place.
      inputVar.assign(updated);
      updated.dispose();

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

    // Resize back to full processing dimensions and save for next octave.
    const afterOctave = tf.image.resizeBilinear(
      inputVar,
      [procH, procW],
    ) as tf.Tensor3D;
    workingData = new Float32Array(await afterOctave.data());
    afterOctave.dispose();
    inputVar.dispose();
  }

  // 4. Deprocess from [-1, 1] to [0, 255].
  const resultTensor = tf.tidy(() => {
    const t = tf.tensor3d(workingData, [procH, procW, 3]);
    return t.add(1).mul(127.5).clipByValue(0, 255) as tf.Tensor3D;
  });

  // 5. Resize back to original dimensions.
  const finalTensor = tf.tidy(() => {
    return tf.image.resizeBilinear(
      resultTensor,
      [origHeight, origWidth],
    ) as tf.Tensor3D;
  });
  resultTensor.dispose();

  // 6. Convert to ImageData.
  const imageData = tensorToImageData(finalTensor);
  finalTensor.dispose();

  const tensorsAfter = tf.memory().numTensors;
  console.log(
    `[deepDream] done — tensors: ${tensorsAfter} (delta: ${tensorsAfter - tensorsBefore})`,
  );

  return imageData;
}

/**
 * Style transfer algorithm — single forward-pass arbitrary stylisation.
 *
 * Uses the Magenta predictor to compute a style bottleneck, optionally
 * interpolates with the content bottleneck for partial strength, then
 * runs the transformer to produce the stylised image.
 */

import * as tf from '@tensorflow/tfjs';
import type { StyleTransferModel } from './model.ts';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface StyleConfig {
  /** How much style to apply: 0.0 = content only, 1.0 = full style. */
  strength: number;
}

export const DEFAULT_STYLE_CONFIG: StyleConfig = {
  strength: 1.0,
};

// ---------------------------------------------------------------------------
// Core algorithm
// ---------------------------------------------------------------------------

/**
 * Stylise a content image using a style reference image.
 *
 * This is a single forward pass through two small models — typically
 * completes in 1-2 seconds on WebGL.
 *
 * @param contentImageData - Source image from the canvas.
 * @param styleImageData   - Style reference image from the picker.
 * @param model            - Loaded StyleTransferModel (predictor + transformer).
 * @param config           - Style parameters (currently just strength).
 * @returns A new ImageData containing the stylised result at content dimensions.
 */
export async function stylizeImage(
  contentImageData: ImageData,
  styleImageData: ImageData,
  model: StyleTransferModel,
  config: StyleConfig = DEFAULT_STYLE_CONFIG,
): Promise<ImageData> {
  const tensorsBefore = tf.memory().numTensors;
  console.log(`[stylize] start — tensors: ${tensorsBefore}`);

  try {
    // 1. Compute style bottleneck from the style image.
    const styleBottleneck = model.predictStyle(styleImageData);

    // 2. If strength < 1, interpolate with content bottleneck.
    let finalBottleneck: tf.Tensor4D;

    if (config.strength < 1.0) {
      const contentBottleneck = model.predictStyle(contentImageData);

      finalBottleneck = tf.tidy(() => {
        const s = tf.scalar(config.strength);
        const oneMinusS = tf.scalar(1.0 - config.strength);
        return tf.add(
          tf.mul(styleBottleneck, s),
          tf.mul(contentBottleneck, oneMinusS),
        ) as tf.Tensor4D;
      });

      // Dispose originals — the interpolated tensor is the one we keep.
      styleBottleneck.dispose();
      contentBottleneck.dispose();
    } else {
      finalBottleneck = styleBottleneck;
    }

    // 3. Run the transformer.
    const resultTensor = model.stylize(contentImageData, finalBottleneck);
    finalBottleneck.dispose();

    // 4. Convert [H, W, 3] float32 (values in [0, 1]) to ImageData.
    const scaled = tf.tidy(() => {
      return resultTensor.mul(255).clipByValue(0, 255).cast('int32') as tf.Tensor3D;
    });
    resultTensor.dispose();

    const imageData = tensorToImageData(scaled);
    scaled.dispose();

    const tensorsAfter = tf.memory().numTensors;
    console.log(
      `[stylize] done — tensors: ${tensorsAfter} (delta: ${tensorsAfter - tensorsBefore})`,
    );

    return imageData;
  } catch (err) {
    const leaked = tf.memory().numTensors - tensorsBefore;
    if (leaked > 0) {
      console.warn(`[stylize] cleaning up ${leaked} leaked tensors after error`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a [H, W, 3] int32 tensor (values in [0, 255]) to an ImageData.
 */
function tensorToImageData(tensor3D: tf.Tensor3D): ImageData {
  const [height, width] = tensor3D.shape;
  const rgbData = tensor3D.dataSync();

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

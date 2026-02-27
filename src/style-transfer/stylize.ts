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
 * Downscale an ImageData so that its longest edge is at most `maxDim`.
 * Returns the original if already small enough.
 */
function downscaleImageData(source: ImageData, maxDim: number): ImageData {
  const { width, height } = source;
  if (width <= maxDim && height <= maxDim) return source;

  const scale = maxDim / Math.max(width, height);
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);

  const offscreen = document.createElement('canvas');
  offscreen.width = newW;
  offscreen.height = newH;
  const ctx = offscreen.getContext('2d')!;

  // Draw source ImageData onto a temp canvas first
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  srcCanvas.getContext('2d')!.putImageData(source, 0, 0);

  ctx.drawImage(srcCanvas, 0, 0, newW, newH);
  return ctx.getImageData(0, 0, newW, newH);
}

/** Yield to the event loop so the browser can repaint progress updates. */
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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
 * @param onProgress       - Optional callback (0-1) to report inference progress.
 * @returns A new ImageData containing the stylised result at content dimensions.
 */
export async function stylizeImage(
  contentImageData: ImageData,
  styleImageData: ImageData,
  model: StyleTransferModel,
  config: StyleConfig = DEFAULT_STYLE_CONFIG,
  onProgress?: (fraction: number) => void,
): Promise<ImageData> {
  const tensorsBefore = tf.memory().numTensors;
  console.log(`[stylize] start — tensors: ${tensorsBefore}`);

  // Cap resolution to avoid WebGL OOM / multi-second freezes.
  const MAX_DIM = 1024;
  const scaledContent = downscaleImageData(contentImageData, MAX_DIM);
  const scaledStyle = downscaleImageData(styleImageData, MAX_DIM);

  try {
    onProgress?.(0.05);
    await yieldToUI();

    // 1. Compute style bottleneck from the style image.
    const styleBottleneck = model.predictStyle(scaledStyle);
    onProgress?.(0.25);
    await yieldToUI();

    // 2. If strength < 1, interpolate with content bottleneck.
    let finalBottleneck: tf.Tensor4D;

    if (config.strength < 1.0) {
      const contentBottleneck = model.predictStyle(scaledContent);
      onProgress?.(0.4);
      await yieldToUI();

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

    onProgress?.(0.5);
    await yieldToUI();

    // 3. Run the transformer.
    const resultTensor = model.stylize(scaledContent, finalBottleneck);
    finalBottleneck.dispose();
    onProgress?.(0.85);
    await yieldToUI();

    // 4. Convert [H, W, 3] float32 (values in [0, 1]) to ImageData.
    const scaled = tf.tidy(() => {
      return resultTensor.mul(255).clipByValue(0, 255).cast('int32') as tf.Tensor3D;
    });
    resultTensor.dispose();

    const imageData = tensorToImageData(scaled);
    scaled.dispose();

    onProgress?.(1.0);

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

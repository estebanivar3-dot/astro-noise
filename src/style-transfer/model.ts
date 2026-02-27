/**
 * Style Transfer model loading — loads Google Magenta's arbitrary style
 * transfer models (predictor + transformer) using TF.js graph model API.
 *
 * The predictor is a MobileNetV2-based network that computes a 100-dim
 * style bottleneck from a style image.  The transformer takes a content
 * image and the bottleneck and produces the stylised output.
 */

import * as tf from '@tensorflow/tfjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PREDICTOR_URL = '/models/style_predictor/model.json';
const TRANSFORMER_URL = '/models/style_transformer/model.json';

/**
 * Output node for the predictor network.
 * Shape: [1, 1, 1, 100] — the 100-dimensional style bottleneck.
 */
const PREDICTOR_OUTPUT = 'mobilenet_conv/Conv/BiasAdd';

/**
 * Output node for the transformer network.
 * Shape: [1, H, W, 3] — the stylised image with values in [0, 1].
 */
const TRANSFORMER_OUTPUT = 'transformer/expand/conv3/conv/Sigmoid';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface StyleTransferModel {
  /** Compute a 100-dim style bottleneck from a style image. */
  predictStyle(styleImage: ImageData): tf.Tensor4D;
  /** Run the transformer on a content image given a style bottleneck. */
  stylize(contentImage: ImageData, styleBottleneck: tf.Tensor4D): tf.Tensor3D;
  /** Dispose both graph models and free GPU/CPU memory. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

/**
 * Load the style predictor and transformer graph models.
 *
 * @param onProgress - Optional callback receiving a fraction (0-1) across
 *   both models: predictor progress maps to 0-0.5, transformer to 0.5-1.0.
 */
export async function loadStyleTransferModel(
  onProgress?: (fraction: number) => void,
): Promise<StyleTransferModel> {
  // Load predictor (0% – 50%)
  const styleNet = await tf.loadGraphModel(PREDICTOR_URL, {
    onProgress: onProgress
      ? (fraction: number) => onProgress(fraction * 0.5)
      : undefined,
  });

  // Load transformer (50% – 100%)
  const transformNet = await tf.loadGraphModel(TRANSFORMER_URL, {
    onProgress: onProgress
      ? (fraction: number) => onProgress(0.5 + fraction * 0.5)
      : undefined,
  });

  // ---- API methods ----

  function predictStyle(styleImage: ImageData): tf.Tensor4D {
    return tf.tidy(() => {
      const raw = tf.browser.fromPixels(styleImage);              // [H, W, 3] uint8
      const floated = raw.toFloat().div(255) as tf.Tensor3D;      // [H, W, 3] float [0,1]
      const batch = floated.expandDims(0) as tf.Tensor4D;         // [1, H, W, 3]
      return styleNet.execute(
        { Placeholder: batch },
        PREDICTOR_OUTPUT,
      ) as tf.Tensor4D;
    });
  }

  function stylize(
    contentImage: ImageData,
    styleBottleneck: tf.Tensor4D,
  ): tf.Tensor3D {
    return tf.tidy(() => {
      const raw = tf.browser.fromPixels(contentImage);            // [H, W, 3] uint8
      const floated = raw.toFloat().div(255) as tf.Tensor3D;      // [H, W, 3] float [0,1]
      const batch = floated.expandDims(0) as tf.Tensor4D;         // [1, H, W, 3]

      const result = transformNet.execute(
        { Placeholder: batch, Placeholder_1: styleBottleneck },
        TRANSFORMER_OUTPUT,
      ) as tf.Tensor4D;                                            // [1, H, W, 3]

      return result.squeeze([0]) as tf.Tensor3D;                   // [H, W, 3]
    });
  }

  function dispose(): void {
    styleNet.dispose();
    transformNet.dispose();
  }

  return { predictStyle, stylize, dispose };
}

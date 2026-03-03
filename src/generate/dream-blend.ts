/**
 * Dream Blend — shared post-processing for DeepDream and Re-Dream results.
 *
 * Blends between source and dream result using:
 *   - Opacity slider (global mix factor)
 *   - Tonal targeting (per-pixel mask based on luminance ranges)
 *
 * Both tools store source + result, then call blendDreamResult()
 * whenever sliders change for instant visual feedback.
 */

import type { TonalConfig } from '../effects/tonal.ts';
import { computeTonalMask } from '../effects/tonal.ts';

/**
 * Blend source and dream result using opacity and tonal mask.
 * Returns a new ImageData ready for display.
 */
export function blendDreamResult(
  source: ImageData,
  dream: ImageData,
  opacity: number,
  tonalConfig: TonalConfig,
): ImageData {
  const { width, height } = source;
  const src = source.data;
  const drm = dream.data;
  const out = new ImageData(width, height);
  const dst = out.data;

  // Compute tonal mask from source (where the luminance ranges are)
  const tonalMask = computeTonalMask(source, tonalConfig);

  for (let i = 0; i < src.length; i += 4) {
    // Per-pixel blend weight = global opacity × tonal weight
    const pixelIdx = i >> 2;
    const tonal = tonalMask ? tonalMask[pixelIdx] : 1;
    const blend = opacity * tonal;
    const inv = 1 - blend;

    dst[i]     = src[i]     * inv + drm[i]     * blend;
    dst[i + 1] = src[i + 1] * inv + drm[i + 1] * blend;
    dst[i + 2] = src[i + 2] * inv + drm[i + 2] * blend;
    dst[i + 3] = src[i + 3]; // preserve alpha from source
  }

  return out;
}

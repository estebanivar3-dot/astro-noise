/**
 * Threshold effect — converts to black & white based on luminance cutoff.
 * In interactive mode, drag horizontally to adjust the threshold value.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

const thresholdEffect: PixelEffect = {
  id: 'threshold',
  label: 'Threshold',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const threshold = config['threshold'] ?? 128;
    const mix = (config['mix'] ?? 100) / 100;
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;
    const inv = 1 - mix;

    for (let i = 0; i < data.length; i += 4) {
      const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const val = luminance > threshold ? 255 : 0;
      dst[i]     = data[i]     * inv + val * mix;
      dst[i + 1] = data[i + 1] * inv + val * mix;
      dst[i + 2] = data[i + 2] * inv + val * mix;
      dst[i + 3] = data[i + 3];
    }

    return out;
  },
};

export const thresholdDef: EffectToolDef = {
  effect: thresholdEffect,
  sliders: [
    { key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1, defaultValue: 128, hint: 'Luminance cutoff for black vs white' },
    { key: 'mix', label: 'Mix', min: 0, max: 100, step: 1, defaultValue: 100, hint: 'Blend between original and threshold' },
  ],
};

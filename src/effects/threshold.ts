/**
 * Threshold effect — converts to black & white based on luminance cutoff.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

const thresholdEffect: PixelEffect = {
  id: 'threshold',
  label: 'Threshold',
  interactionType: 'none',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const threshold = config['threshold'] ?? 128;
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    for (let i = 0; i < data.length; i += 4) {
      const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const val = luminance > threshold ? 255 : 0;
      dst[i] = val;
      dst[i + 1] = val;
      dst[i + 2] = val;
      dst[i + 3] = data[i + 3];
    }

    return out;
  },
};

export const thresholdDef: EffectToolDef = {
  effect: thresholdEffect,
  sliders: [
    { key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1, defaultValue: 128, hint: 'Luminance cutoff for black vs white' },
  ],
  supportsInteractive: false,
};

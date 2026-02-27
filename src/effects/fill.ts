/**
 * Fill — stamps color/noise into areas of the image.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

const fillEffect: PixelEffect = {
  id: 'fill',
  label: 'Fill',
  interactionType: 'area-paint',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const mode = config['mode'] ?? 0;
    const opacity = (config['opacity'] ?? 100) / 100;
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    for (let i = 0; i < data.length; i += 4) {
      let fr: number, fg: number, fb: number;

      switch (mode) {
        case 1: {
          fr = 255; fg = 255; fb = 255;
          break;
        }
        case 2: {
          fr = 0; fg = 0; fb = 0;
          break;
        }
        default: {
          fr = Math.random() * 255;
          fg = Math.random() * 255;
          fb = Math.random() * 255;
          break;
        }
      }

      dst[i]     = Math.round(data[i] * (1 - opacity) + fr * opacity);
      dst[i + 1] = Math.round(data[i + 1] * (1 - opacity) + fg * opacity);
      dst[i + 2] = Math.round(data[i + 2] * (1 - opacity) + fb * opacity);
      dst[i + 3] = data[i + 3];
    }

    return out;
  },
};

export const fillDef: EffectToolDef = {
  effect: fillEffect,
  sliders: [
    { key: 'opacity', label: 'Opacity', min: 10, max: 100, step: 5, defaultValue: 100, hint: 'How opaque the fill is' },
  ],
  modes: [
    { key: 'mode', modes: ['Noise', 'White', 'Black'], defaultIndex: 0 },
  ],
};

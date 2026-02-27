/**
 * Burn — destructive contrast/exposure effects mimicking film damage.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(val: number): number {
  return val < 0 ? 0 : val > 255 ? 255 : val;
}

const burnEffect: PixelEffect = {
  id: 'burn',
  label: 'Burn',
  interactionType: 'none',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const intensity = (config['intensity'] ?? 50) / 100;
    const mode = config['mode'] ?? 0;
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      let nr: number, ng: number, nb: number;

      switch (mode) {
        case 1: {
          nr = 255 - ((255 - r) * (255 - r)) / 255;
          ng = 255 - ((255 - g) * (255 - g)) / 255;
          nb = 255 - ((255 - b) * (255 - b)) / 255;
          break;
        }
        case 2: {
          const thresh = 128 * (1 - intensity * 0.5);
          nr = r > thresh ? 255 - r : r;
          ng = g > thresh ? 255 - g : g;
          nb = b > thresh ? 255 - b : b;
          break;
        }
        default: {
          nr = (r * r) / 255;
          ng = (g * g) / 255;
          nb = (b * b) / 255;
          break;
        }
      }

      dst[i]     = clamp(Math.round(r + (nr - r) * intensity));
      dst[i + 1] = clamp(Math.round(g + (ng - g) * intensity));
      dst[i + 2] = clamp(Math.round(b + (nb - b) * intensity));
      dst[i + 3] = data[i + 3];
    }

    return out;
  },
};

export const burnDef: EffectToolDef = {
  effect: burnEffect,
  sliders: [
    { key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, defaultValue: 50, hint: 'How destructive the burn effect is' },
  ],
  modes: [
    { key: 'mode', modes: ['Burn', 'Dodge', 'Solarize'], defaultIndex: 0 },
  ],
  supportsInteractive: false,
};

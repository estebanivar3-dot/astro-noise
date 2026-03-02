/**
 * Solarize — Sabattier effect with threshold-based tone inversion.
 * Brush-paints vivid psychedelic color inversions onto the image.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(val: number): number {
  return val < 0 ? 0 : val > 255 ? 255 : Math.round(val);
}

const solarizeEffect: PixelEffect = {
  id: 'solarize',
  label: 'Solarize',
  interactionType: 'area-paint',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const intensity = (config['intensity'] ?? 60) / 100;
    const threshold = config['threshold'] ?? 128;
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
          // Neon — per-channel offset thresholds for color fringing
          const tR = threshold + 20;
          const tG = threshold;
          const tB = threshold - 20;
          nr = r > tR ? 255 - r : r;
          ng = g > tG ? 255 - g : g;
          nb = b > tB ? 255 - b : b;
          break;
        }
        case 2: {
          // Psychedelic — sine-wave multi-band inversion
          const pi = Math.PI;
          const freq = 1 + intensity * 2;
          nr = Math.abs(Math.sin(r / 255 * pi * freq)) * 255;
          ng = Math.abs(Math.sin(g / 255 * pi * freq)) * 255;
          nb = Math.abs(Math.sin(b / 255 * pi * freq)) * 255;
          break;
        }
        default: {
          // Classic — simple threshold inversion
          nr = r > threshold ? 255 - r : r;
          ng = g > threshold ? 255 - g : g;
          nb = b > threshold ? 255 - b : b;
          break;
        }
      }

      dst[i]     = clamp(r + (nr - r) * intensity);
      dst[i + 1] = clamp(g + (ng - g) * intensity);
      dst[i + 2] = clamp(b + (nb - b) * intensity);
      dst[i + 3] = data[i + 3];
    }

    return out;
  },
};

export const solarizeDef: EffectToolDef = {
  effect: solarizeEffect,
  sliders: [
    { key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, defaultValue: 60, hint: 'How strongly tones are inverted' },
    { key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1, defaultValue: 128, hint: 'Brightness cutoff for inversion' },
  ],
  modes: [
    { key: 'mode', modes: ['Classic', 'Neon', 'Psychedelic'], defaultIndex: 0 },
  ],
};

/**
 * Burn — destructive solarize-burn with stacking brush.
 * Each stroke bakes in its own intensity. Paint at 30%, then 80%,
 * and both coexist — strokes accumulate, they don't just mask.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(val: number): number {
  return val < 0 ? 0 : val > 255 ? 255 : Math.round(val);
}

const burnEffect: PixelEffect = {
  id: 'burn',
  label: 'Burn',
  interactionType: 'area-paint',

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
          // Scorch — solarize + extreme color burn, pushes into hot oranges/magentas
          const sr = r > 128 ? 255 - r : r;
          const sg = g > 128 ? 255 - g : g;
          const sb = b > 128 ? 255 - b : b;
          // Color burn blend: darkens + saturates aggressively
          nr = clamp(r < 255 ? 255 - ((255 - sr) * 255) / (r + 1) : 0);
          ng = clamp(g < 200 ? (sg * 0.4) : sg);
          nb = clamp(b < 200 ? (sb * 0.2) : sb * 0.5);
          // Push toward hot orange/magenta
          nr = clamp(nr * 1.4 + 40);
          ng = clamp(ng * 0.6);
          nb = clamp(nb * 0.8 + nr * 0.15);
          break;
        }
        case 2: {
          // Neon — solarize into vivid neon colors
          const sr = Math.abs(Math.sin(r / 255 * Math.PI)) * 255;
          const sg = Math.abs(Math.sin(g / 255 * Math.PI * 1.5)) * 255;
          const sb = Math.abs(Math.sin(b / 255 * Math.PI * 2)) * 255;
          nr = clamp(sr * 1.3);
          ng = clamp(sg * 1.1);
          nb = clamp(sb * 1.4);
          break;
        }
        default: {
          // Solarize — classic Sabattier effect, intense and destructive
          const sr = r > 128 ? (255 - r) * 2 : r * 2;
          const sg = g > 128 ? (255 - g) * 2 : g * 2;
          const sb = b > 128 ? (255 - b) * 2 : b * 2;
          nr = clamp(sr);
          ng = clamp(sg);
          nb = clamp(sb);
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

export const burnDef: EffectToolDef = {
  effect: burnEffect,
  sliders: [
    { key: 'intensity', label: 'Intensity', min: 1, max: 100, step: 1, defaultValue: 40, hint: 'How much each brush stroke burns' },
  ],
  modes: [
    { key: 'mode', modes: ['Solarize', 'Scorch', 'Neon'], defaultIndex: 0 },
  ],
  stackingBrush: true,
};

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
          // Scorch — scorched film: S-curve contrast + warm shift, blown amber highlights.
          // Simulates heat-damaged film stock — charcoal shadows, amber mid-tones, golden blow-out.
          const lum = r * 0.299 + g * 0.587 + b * 0.114;
          // Smoothstep S-curve for aggressive contrast
          const sc = (v: number): number => {
            const t = v / 255;
            return t * t * (3 - 2 * t) * 255;
          };
          const cr = sc(r);
          const cg = sc(g);
          const cb = sc(b);
          // Warm colour grading: boost red, pull green toward red, crush blue
          nr = clamp(cr * 1.3 + 30);
          ng = clamp(cg * 0.85 + cr * 0.15);
          nb = clamp(cb * 0.4);
          // Highlights blow out to amber/gold
          if (lum > 160) {
            const t = (lum - 160) / 95;
            nr = clamp(nr + t * (255 - nr));
            ng = clamp(ng + t * (200 - ng));
            nb = clamp(nb + t * (80 - nb));
          }
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
        case 3: {
          // Ember — luminance solarize fold mapped through fire-gradient power curves.
          // Mid-tones glow white-hot, darks and highlights curve into deep reds/oranges.
          const el = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
          const t = el > 0.5 ? (1 - el) * 2 : el * 2;
          nr = clamp(Math.pow(t, 0.45) * 360);
          ng = clamp(Math.pow(t, 1.5) * 260);
          nb = clamp(Math.pow(t, 4.0) * 255);
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
    { key: 'mode', modes: ['Solarize', 'Scorch', 'Neon', 'Ember'], defaultIndex: 0 },
  ],
  stackingBrush: true,
};

/**
 * Noise — film grain / noise generator overlay.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

const noiseEffect: PixelEffect = {
  id: 'noise',
  label: 'Noise',
  interactionType: 'area-paint',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const amount = (config['amount'] ?? 50) / 100;
    const scale = Math.max(1, Math.round(config['scale'] ?? 1));
    const mode = config['mode'] ?? 0;
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    // Seeded PRNG for deterministic results at same settings
    let seed = Math.round(amount * 777 + scale * 31 + mode * 13);
    function rand(): number {
      seed = (seed * 16807 + 0) % 2147483647;
      return (seed - 1) / 2147483646;
    }

    // Gaussian approximation via Box-Muller
    function gaussRand(): number {
      const u1 = rand() || 0.0001;
      const u2 = rand();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Use scaled coordinates for larger grain
        const gx = Math.floor(x / scale);
        const gy = Math.floor(y / scale);
        // Re-seed per grain block for consistency
        const blockSeed = (gx * 73856093) ^ (gy * 19349663);
        seed = ((blockSeed % 2147483647) + 2147483647) % 2147483647 || 1;

        switch (mode) {
          case 1: {
            // Salt & pepper
            const v = rand();
            if (v < amount * 0.15) {
              const val = rand() > 0.5 ? 255 : 0;
              dst[i] = val;
              dst[i + 1] = val;
              dst[i + 2] = val;
            } else {
              dst[i] = r;
              dst[i + 1] = g;
              dst[i + 2] = b;
            }
            break;
          }
          case 2: {
            // Film grain — luminance-weighted (more noise in midtones)
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const midtoneBias = 1 - Math.abs(lum / 127.5 - 1);
            const noise = gaussRand() * amount * 128 * midtoneBias;
            dst[i]     = clamp(r + noise);
            dst[i + 1] = clamp(g + noise);
            dst[i + 2] = clamp(b + noise);
            break;
          }
          case 3: {
            // Color noise — independent per channel
            dst[i]     = clamp(r + gaussRand() * amount * 100);
            dst[i + 1] = clamp(g + gaussRand() * amount * 100);
            dst[i + 2] = clamp(b + gaussRand() * amount * 100);
            break;
          }
          default: {
            // Gaussian (monochrome)
            const noise = gaussRand() * amount * 128;
            dst[i]     = clamp(r + noise);
            dst[i + 1] = clamp(g + noise);
            dst[i + 2] = clamp(b + noise);
            break;
          }
        }

        dst[i + 3] = data[i + 3];
      }
    }

    return out;
  },
};

export const noiseDef: EffectToolDef = {
  effect: noiseEffect,
  sliders: [
    { key: 'amount', label: 'Amount', min: 1, max: 100, step: 1, defaultValue: 30, hint: 'How much noise to add' },
    { key: 'scale', label: 'Grain Size', min: 1, max: 8, step: 1, defaultValue: 1, hint: 'Size of noise particles' },
  ],
  modes: [
    { key: 'mode', modes: ['Gaussian', 'Salt & Pepper', 'Film Grain', 'Color Noise'], defaultIndex: 0 },
  ],
};

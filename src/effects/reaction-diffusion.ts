/**
 * Reaction-Diffusion — Gray-Scott simulation that grows organic patterns,
 * then uses them to corrupt the image in different ways.
 *
 * The simulation grid is bilinear-interpolated to full resolution so
 * the pattern is smooth instead of blocky squares. This also makes
 * the Iterations slider meaningful — you can see the pattern develop
 * from sparse seeds to fully-formed structures.
 *
 * Modes:
 *   Corrode — spot pattern eats dark holes into the image
 *   Veins   — stripe pattern creates organic vein lines
 *   Stain   — coral pattern bleeds desaturated color
 *   Warp    — maze pattern displaces pixels organically
 */

import type { PixelEffect, EffectToolDef, EffectConfig } from './types.ts';

function clampUnit(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Fast hash for initial noise. */
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h >>> 0) / 4294967295;
}

const MODE_PARAMS: { f: number; k: number }[] = [
  { f: 0.037, k: 0.064 }, // Corrode — spots
  { f: 0.046, k: 0.063 }, // Veins — stripes
  { f: 0.058, k: 0.065 }, // Stain — coral
  { f: 0.029, k: 0.057 }, // Warp — maze
];

/** Bilinear sample from the grid at fractional coordinates. */
function sampleB(
  B: Float32Array, gw: number, gh: number,
  fx: number, fy: number,
): number {
  const gx0 = Math.max(0, Math.min(Math.floor(fx), gw - 1));
  const gx1 = Math.min(gx0 + 1, gw - 1);
  const gy0 = Math.max(0, Math.min(Math.floor(fy), gh - 1));
  const gy1 = Math.min(gy0 + 1, gh - 1);
  const tx = Math.max(0, fx - gx0);
  const ty = Math.max(0, fy - gy0);
  return B[gy0 * gw + gx0] * (1 - tx) * (1 - ty)
       + B[gy0 * gw + gx1] * tx * (1 - ty)
       + B[gy1 * gw + gx0] * (1 - tx) * ty
       + B[gy1 * gw + gx1] * tx * ty;
}

const reactionDiffusionEffect: PixelEffect = {
  id: 'reaction-diffusion',
  label: 'Reaction-Diffusion',
  interactionType: 'none',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const scale = Math.max(3, Math.round((config['scale'] ?? 6) as number));
    const mode = (config['mode'] ?? 0) as number;

    const { width, height, data } = source;

    const gw = Math.max(8, Math.ceil(width / scale));
    const gh = Math.max(8, Math.ceil(height / scale));
    const size = gw * gh;

    const budget = 400_000_000;
    const maxIters = Math.max(10, Math.floor(budget / (size * 15)));
    const iterations = Math.min(
      Math.max(1, Math.round((config['iterations'] ?? 200) as number)),
      maxIters,
    );

    // Initialize: A=1, B=0, seed B in midtones + noise
    const curA = new Float32Array(size);
    const curB = new Float32Array(size);
    const nxtA = new Float32Array(size);
    const nxtB = new Float32Array(size);

    curA.fill(1.0);

    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const sx = Math.min(Math.floor(gx * scale), width - 1);
        const sy = Math.min(Math.floor(gy * scale), height - 1);
        const si = (sy * width + sx) * 4;
        const lum = (data[si] * 0.299 + data[si + 1] * 0.587 + data[si + 2] * 0.114) / 255;

        const gi = gy * gw + gx;
        if (lum > 0.2 && lum < 0.8) {
          curB[gi] = 0.25;
          curA[gi] = 0.5;
        }
        curB[gi] += hash(gx, gy) * 0.05;
        curB[gi] = clampUnit(curB[gi]);
      }
    }

    // Gray-Scott simulation
    const preset = MODE_PARAMS[mode] ?? MODE_PARAMS[0];
    const f = preset.f;
    const k = preset.k;

    let srcA = curA, srcB = curB;
    let dstA = nxtA, dstB = nxtB;

    for (let iter = 0; iter < iterations; iter++) {
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const idx = y * gw + x;
          const a = srcA[idx];
          const b = srcB[idx];

          const xm = x > 0 ? x - 1 : gw - 1;
          const xp = x < gw - 1 ? x + 1 : 0;
          const ym = y > 0 ? y - 1 : gh - 1;
          const yp = y < gh - 1 ? y + 1 : 0;

          const lapA = srcA[y * gw + xm] + srcA[y * gw + xp]
                     + srcA[ym * gw + x] + srcA[yp * gw + x] - 4 * a;
          const lapB = srcB[y * gw + xm] + srcB[y * gw + xp]
                     + srcB[ym * gw + x] + srcB[yp * gw + x] - 4 * b;

          const abb = a * b * b;
          dstA[idx] = clampUnit(a + lapA - abb + f * (1 - a));
          dstB[idx] = clampUnit(b + 0.5 * lapB + abb - (k + f) * b);
        }
      }

      const tmpA = srcA; srcA = dstA; dstA = tmpA;
      const tmpB = srcB; srcB = dstB; dstB = tmpB;
    }

    const finalB = srcB;

    // ---- Pre-interpolate B to full resolution (eliminates block artifacts) ----
    const fullB = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const fy = y / scale - 0.5;
      for (let x = 0; x < width; x++) {
        const fx = x / scale - 0.5;
        fullB[y * width + x] = sampleB(finalB, gw, gh, fx, fy);
      }
    }

    // ---- Render using smooth B field ----
    const out = new ImageData(width, height);
    const dst = out.data;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bVal = fullB[y * width + x];
        const i = (y * width + x) * 4;

        switch (mode) {
          case 0: {
            // Corrode — organic dark holes
            const t = clampUnit(bVal * 3);
            const mask = t * t * (3 - 2 * t);
            const factor = 1 - mask * 0.92;
            dst[i]     = Math.round(data[i] * factor);
            dst[i + 1] = Math.round(data[i + 1] * factor);
            dst[i + 2] = Math.round(data[i + 2] * factor);
            break;
          }
          case 1: {
            // Veins — dark lines at pattern boundaries (pixel-res gradient)
            const bL = x > 0 ? fullB[y * width + x - 1] : bVal;
            const bR = x < width - 1 ? fullB[y * width + x + 1] : bVal;
            const bT = y > 0 ? fullB[(y - 1) * width + x] : bVal;
            const bB = y < height - 1 ? fullB[(y + 1) * width + x] : bVal;
            const gradX = bR - bL;
            const gradY = bB - bT;
            const edge = Math.sqrt(gradX * gradX + gradY * gradY);
            const vein = clampUnit(edge * 15);
            const vs = vein * vein * (3 - 2 * vein);
            const factor = 1 - vs * 0.9;
            dst[i]     = Math.round(data[i] * factor);
            dst[i + 1] = Math.round(data[i + 1] * factor);
            dst[i + 2] = Math.round(data[i + 2] * factor);
            break;
          }
          case 2: {
            // Stain — organic color bleeding / desaturation
            const t = clampUnit(bVal * 2.5);
            const stain = t * t * (3 - 2 * t);
            const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            const mix = stain * 0.75;
            dst[i]     = Math.round(data[i] * (1 - mix) + lum * 0.85 * mix);
            dst[i + 1] = Math.round(data[i + 1] * (1 - mix) + lum * 0.6 * mix);
            dst[i + 2] = Math.round(data[i + 2] * (1 - mix) + lum * 0.4 * mix);
            break;
          }
          case 3: {
            // Warp — organic pixel displacement (pixel-res gradient)
            const bL = x > 0 ? fullB[y * width + x - 1] : bVal;
            const bR = x < width - 1 ? fullB[y * width + x + 1] : bVal;
            const bT = y > 0 ? fullB[(y - 1) * width + x] : bVal;
            const bB = y < height - 1 ? fullB[(y + 1) * width + x] : bVal;
            const dispX = (bR - bL) * scale * 30;
            const dispY = (bB - bT) * scale * 30;
            const sx = Math.max(0, Math.min(width - 1, Math.round(x + dispX)));
            const sy = Math.max(0, Math.min(height - 1, Math.round(y + dispY)));
            const si = (sy * width + sx) * 4;
            dst[i]     = data[si];
            dst[i + 1] = data[si + 1];
            dst[i + 2] = data[si + 2];
            break;
          }
          default: {
            dst[i] = data[i];
            dst[i + 1] = data[i + 1];
            dst[i + 2] = data[i + 2];
          }
        }
        dst[i + 3] = data[i + 3];
      }
    }

    return out;
  },
};

export const reactionDiffusionDef: EffectToolDef = {
  effect: reactionDiffusionEffect,
  sliders: [
    { key: 'iterations', label: 'Iterations', min: 10, max: 1500, step: 10, defaultValue: 200, hint: 'How developed the pattern gets' },
    { key: 'scale', label: 'Scale', min: 3, max: 12, step: 1, defaultValue: 6, hint: 'Pattern size (higher = coarser but faster)' },
  ],
  modes: [
    { key: 'mode', modes: ['Corrode', 'Veins', 'Stain', 'Warp'], defaultIndex: 0 },
  ],
};

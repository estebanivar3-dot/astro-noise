/**
 * Growth/Spread effect — organic cellular automaton.
 * Pixels "infect" neighbors based on color similarity.
 * Paint to reveal the grown version.
 *
 * Downsamples to ~500px working resolution so iterations actually
 * cover a visible portion of the image. At full res with 12 iterations,
 * spread was only ~12px on a 2000px image — invisible. At 500px working
 * res with 40 iterations, spread covers ~8% of the image.
 */

import type { PixelEffect, EffectToolDef, EffectConfig } from './types.ts';

/** Max working dimension. */
const MAX_WORK = 400;

function luminance(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

/** Fast deterministic hash for neighbor selection. */
function hash(x: number, y: number, iter: number): number {
  let h = (x * 374761393 + y * 668265263 + iter * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return h >>> 0;
}

const NDX = [-1, 1, 0, 0];
const NDY = [0, 0, -1, 1];

const growthEffect: PixelEffect = {
  id: 'growth',
  label: 'Growth',
  interactionType: 'area-paint',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const tolerance = (config['tolerance'] ?? 50) as number;
    const mode = (config['mode'] ?? 0) as number;

    const { width, height, data } = source;

    // ---- Downsample for performance ----
    const longer = Math.max(width, height);
    const needsDown = longer > MAX_WORK;
    const ratio = needsDown ? MAX_WORK / longer : 1;
    const w = needsDown ? Math.max(4, Math.round(width * ratio)) : width;
    const h = needsDown ? Math.max(4, Math.round(height * ratio)) : height;

    const pixels = new Uint8ClampedArray(w * h * 4);
    if (needsDown) {
      const xR = width / w;
      const yR = height / h;
      for (let y = 0; y < h; y++) {
        const sy = Math.min(Math.floor(y * yR), height - 1);
        for (let x = 0; x < w; x++) {
          const sx = Math.min(Math.floor(x * xR), width - 1);
          const si = (sy * width + sx) * 4;
          const di = (y * w + x) * 4;
          pixels[di] = data[si]; pixels[di + 1] = data[si + 1];
          pixels[di + 2] = data[si + 2]; pixels[di + 3] = data[si + 3];
        }
      }
    } else {
      pixels.set(data);
    }

    // Performance cap at working resolution
    const maxIters = Math.max(1, Math.floor(300_000_000 / (w * h * 12)));
    const iterations = Math.min(
      Math.max(1, Math.round((config['iterations'] ?? 40) as number)),
      maxIters,
    );

    // Scale tolerance to distance units (use squared for color to skip sqrt)
    const tolColorSq = ((tolerance / 100) * 441) * ((tolerance / 100) * 441);
    const tolLum = (tolerance / 100) * 255;

    // ---- Growth simulation at working resolution ----
    for (let iter = 0; iter < iterations; iter++) {
      const forward = iter % 2 === 0;

      const yStart = forward ? 0 : h - 1;
      const yEnd = forward ? h : -1;
      const yStep = forward ? 1 : -1;
      const xStart = forward ? 0 : w - 1;
      const xEnd = forward ? w : -1;
      const xStep = forward ? 1 : -1;

      for (let y = yStart; y !== yEnd; y += yStep) {
        for (let x = xStart; x !== xEnd; x += xStep) {
          const ni = hash(x, y, iter) & 3;
          const nx = x + NDX[ni];
          const ny = y + NDY[ni];
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

          const i = (y * w + x) << 2;
          const j = (ny * w + nx) << 2;

          let shouldSpread = false;

          switch (mode) {
            case 0: {
              const dr = pixels[i] - pixels[j];
              const dg = pixels[i + 1] - pixels[j + 1];
              const db = pixels[i + 2] - pixels[j + 2];
              shouldSpread = dr * dr + dg * dg + db * db < tolColorSq;
              break;
            }
            case 1: {
              const l1 = luminance(pixels[i], pixels[i + 1], pixels[i + 2]);
              const l2 = luminance(pixels[j], pixels[j + 1], pixels[j + 2]);
              shouldSpread = Math.abs(l1 - l2) < tolLum;
              break;
            }
            case 2: {
              shouldSpread = (hash(x, y, iter * 7 + 3) % 100) < tolerance;
              break;
            }
          }

          if (shouldSpread) {
            pixels[j] = pixels[i];
            pixels[j + 1] = pixels[i + 1];
            pixels[j + 2] = pixels[i + 2];
          }
        }
      }
    }

    // ---- Upsample to full resolution (nearest-neighbor for sharp blob edges) ----
    const out = new ImageData(width, height);
    const dst = out.data;

    if (needsDown) {
      for (let y = 0; y < height; y++) {
        const sy = Math.min(Math.floor(y * h / height), h - 1);
        for (let x = 0; x < width; x++) {
          const sx = Math.min(Math.floor(x * w / width), w - 1);
          const si = (sy * w + sx) * 4;
          const di = (y * width + x) * 4;
          dst[di] = pixels[si]; dst[di + 1] = pixels[si + 1];
          dst[di + 2] = pixels[si + 2]; dst[di + 3] = data[di + 3];
        }
      }
    } else {
      dst.set(pixels);
    }

    return out;
  },
};

export const growthDef: EffectToolDef = {
  effect: growthEffect,
  sliders: [
    { key: 'tolerance', label: 'Tolerance', min: 1, max: 100, step: 1, defaultValue: 50, hint: 'How similar colors must be' },
    { key: 'iterations', label: 'Iterations', min: 1, max: 100, step: 1, defaultValue: 40, hint: 'How far the growth reaches' },
  ],
  modes: [
    { key: 'mode', modes: ['Color', 'Luminance', 'Random'], defaultIndex: 0 },
  ],
  stackingBrush: true,
};

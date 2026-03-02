/**
 * Datamosh — simulates I-frame removal with directional macro-block smearing.
 * NOT block shuffling (that's Squares). This creates directional streaking.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

const datamoshEffect: PixelEffect = {
  id: 'datamosh',
  label: 'Datamosh',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const intensity = config['intensity'] ?? 80;
    const blockSize = Math.max(8, Math.round(config['blockSize'] ?? 16));
    const decay = (config['decay'] ?? 50) / 100;
    const mode = config['mode'] ?? 0;
    const dirX = config['directionX'] ?? 0;
    const dirY = config['directionY'] ?? 0;

    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    // Start with a copy of source
    dst.set(data);

    // Normalize drag direction; drag distance amplifies displacement
    let dx = dirX;
    let dy = dirY;
    const mag = Math.sqrt(dx * dx + dy * dy);
    const dragScale = mag > 0 ? 1 + mag * 0.01 : 1;
    if (mag > 0) {
      dx = dx / mag;
      dy = dy / mag;
    } else {
      dx = 1;
      dy = 0;
    }

    // Seeded PRNG for per-block variation
    let seed = Math.round(intensity * 7 + blockSize * 31 + decay * 53 + Math.abs(dirX) * 11 + Math.abs(dirY) * 13);
    function rand(): number {
      seed = (seed * 16807 + 0) % 2147483647;
      return (seed - 1) / 2147483646;
    }

    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);

    switch (mode) {
      case 1: {
        // Horizontal — classic horizontal-only smearing
        for (let by = 0; by < blocksY; by++) {
          // Some rows stay clean
          if (rand() < 0.2) continue;

          const rowShift = Math.round(intensity * dragScale * (rand() * 2 - 0.5));
          const rowTop = by * blockSize;
          const rowBot = Math.min(rowTop + blockSize, height);

          for (let y = rowTop; y < rowBot; y++) {
            for (let x = 0; x < width; x++) {
              const sx = clamp(x - rowShift, 0, width - 1);
              const dstIdx = (y * width + x) * 4;
              const srcIdx = (y * width + sx) * 4;
              dst[dstIdx]     = Math.round(data[srcIdx]     * decay + data[dstIdx]     * (1 - decay));
              dst[dstIdx + 1] = Math.round(data[srcIdx + 1] * decay + data[dstIdx + 1] * (1 - decay));
              dst[dstIdx + 2] = Math.round(data[srcIdx + 2] * decay + data[dstIdx + 2] * (1 - decay));
            }
          }
        }
        break;
      }

      case 2: {
        // Melt — vertical downward drip
        for (let bx = 0; bx < blocksX; bx++) {
          const colLeft = bx * blockSize;
          const colRight = Math.min(colLeft + blockSize, width);
          const meltBase = intensity * dragScale * (0.3 + rand() * 0.7);

          // Some columns barely melt
          if (rand() < 0.15) continue;

          for (let x = colLeft; x < colRight; x++) {
            for (let y = height - 1; y >= 0; y--) {
              const normY = y / height;
              const downShift = Math.round(meltBase * normY * normY);
              const sy = clamp(y - downShift, 0, height - 1);
              const dstIdx = (y * width + x) * 4;
              const srcIdx = (sy * width + x) * 4;
              dst[dstIdx]     = Math.round(data[srcIdx]     * decay + data[dstIdx]     * (1 - decay));
              dst[dstIdx + 1] = Math.round(data[srcIdx + 1] * decay + data[dstIdx + 1] * (1 - decay));
              dst[dstIdx + 2] = Math.round(data[srcIdx + 2] * decay + data[dstIdx + 2] * (1 - decay));
            }
          }
        }
        break;
      }

      default: {
        // Directional — smear along drag direction (most authentic)
        for (let by = 0; by < blocksY; by++) {
          for (let bx = 0; bx < blocksX; bx++) {
            // Some blocks stay clean — the hallmark of real datamosh
            if (rand() < 0.3) continue;

            const blockDist = intensity * dragScale * (0.3 + rand() * 0.7);
            const blockDx = Math.round(dx * blockDist + (rand() - 0.5) * blockSize * 0.3);
            const blockDy = Math.round(dy * blockDist + (rand() - 0.5) * blockSize * 0.3);

            const x0 = bx * blockSize;
            const y0 = by * blockSize;
            const x1 = Math.min(x0 + blockSize, width);
            const y1 = Math.min(y0 + blockSize, height);

            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                const sx = clamp(x - blockDx, 0, width - 1);
                const sy = clamp(y - blockDy, 0, height - 1);
                const dstIdx = (y * width + x) * 4;
                const srcIdx = (sy * width + sx) * 4;
                dst[dstIdx]     = Math.round(data[srcIdx]     * decay + data[dstIdx]     * (1 - decay));
                dst[dstIdx + 1] = Math.round(data[srcIdx + 1] * decay + data[dstIdx + 1] * (1 - decay));
                dst[dstIdx + 2] = Math.round(data[srcIdx + 2] * decay + data[dstIdx + 2] * (1 - decay));
              }
            }
          }
        }
        break;
      }
    }

    return out;
  },
};

export const datamoshDef: EffectToolDef = {
  effect: datamoshEffect,
  sliders: [
    { key: 'intensity', label: 'Intensity', min: 0, max: 200, step: 1, defaultValue: 80, hint: 'Strength of motion vector displacement' },
    { key: 'blockSize', label: 'Block Size', min: 8, max: 64, step: 1, defaultValue: 16, hint: 'Codec block size (8=H.264, 16=MPEG)' },
    { key: 'decay', label: 'Decay', min: 0, max: 100, step: 1, defaultValue: 50, hint: 'Smear persistence — higher = longer streaks' },
  ],
  modes: [
    { key: 'mode', modes: ['Directional', 'Horizontal', 'Melt'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

/**
 * Pixelate — mosaic pixelation effect.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

const pixelateEffect: PixelEffect = {
  id: 'pixelate',
  label: 'Pixelate',
  interactionType: 'area-paint',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const intensity = (config['intensity'] ?? 100) / 100;
    const blockSize = Math.max(2, Math.round(config['blockSize'] ?? 8));
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    for (let by = 0; by < height; by += blockSize) {
      for (let bx = 0; bx < width; bx += blockSize) {
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        const maxY = Math.min(by + blockSize, height);
        const maxX = Math.min(bx + blockSize, width);

        for (let y = by; y < maxY; y++) {
          for (let x = bx; x < maxX; x++) {
            const i = (y * width + x) * 4;
            rSum += data[i];
            gSum += data[i + 1];
            bSum += data[i + 2];
            count++;
          }
        }

        const avgR = Math.round(rSum / count);
        const avgG = Math.round(gSum / count);
        const avgB = Math.round(bSum / count);

        for (let y = by; y < maxY; y++) {
          for (let x = bx; x < maxX; x++) {
            const i = (y * width + x) * 4;
            dst[i]     = Math.round(data[i]     + (avgR - data[i])     * intensity);
            dst[i + 1] = Math.round(data[i + 1] + (avgG - data[i + 1]) * intensity);
            dst[i + 2] = Math.round(data[i + 2] + (avgB - data[i + 2]) * intensity);
            dst[i + 3] = data[i + 3];
          }
        }
      }
    }

    return out;
  },
};

export const pixelateDef: EffectToolDef = {
  effect: pixelateEffect,
  sliders: [
    { key: 'intensity', label: 'Intensity', min: 1, max: 100, step: 1, defaultValue: 40, hint: 'How much each brush stroke pixelates' },
    { key: 'blockSize', label: 'Block Size', min: 2, max: 64, step: 1, defaultValue: 8, hint: 'Size of each pixel block' },
  ],
  stackingBrush: true,
};

/**
 * Mosh — datamoshing / compression corruption simulation.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

const moshEffect: PixelEffect = {
  id: 'mosh',
  label: 'Mosh',
  interactionType: 'smear',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const intensity = (config['intensity'] ?? 50) / 100;
    const blockSize = Math.max(4, Math.round(config['blockSize'] ?? 16));
    const mode = config['mode'] ?? 0;
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    dst.set(data);

    let seed = Math.round(intensity * 1000 + blockSize * 7);
    function rand(): number {
      seed = (seed * 16807 + 0) % 2147483647;
      return (seed - 1) / 2147483646;
    }

    const numOps = Math.round(20 + intensity * 80);

    switch (mode) {
      case 1: {
        for (let op = 0; op < numOps; op++) {
          const y = Math.floor(rand() * height);
          const rowHeight = Math.floor(1 + rand() * blockSize);
          const shift = Math.round((rand() - 0.5) * 2 * blockSize * intensity);

          for (let dy = 0; dy < rowHeight && y + dy < height; dy++) {
            for (let x = 0; x < width; x++) {
              const srcX = clamp(x - shift, 0, width - 1);
              const dstIdx = ((y + dy) * width + x) * 4;
              const srcIdx = ((y + dy) * width + srcX) * 4;
              dst[dstIdx] = data[srcIdx];
              dst[dstIdx + 1] = data[srcIdx + 1];
              dst[dstIdx + 2] = data[srcIdx + 2];
            }
          }
        }
        break;
      }

      case 2: {
        const chunkCount = Math.round(10 + intensity * 40);
        for (let c = 0; c < chunkCount; c++) {
          const chunkLen = Math.floor(4 + rand() * blockSize * 4) * 4;
          const srcOff = Math.floor(rand() * (data.length - chunkLen));
          const dstOff = Math.floor(rand() * (data.length - chunkLen));
          for (let j = 0; j < chunkLen; j++) {
            dst[dstOff + j] = data[srcOff + j];
          }
        }
        break;
      }

      default: {
        for (let op = 0; op < numOps; op++) {
          const bx = Math.floor(rand() * width);
          const by = Math.floor(rand() * height);
          const bw = Math.floor(blockSize / 2 + rand() * blockSize);
          const bh = Math.floor(blockSize / 2 + rand() * blockSize);
          const shiftX = Math.round((rand() - 0.5) * 2 * blockSize * intensity);
          const shiftY = Math.round((rand() - 0.5) * 2 * blockSize * intensity);

          for (let y = by; y < Math.min(by + bh, height); y++) {
            for (let x = bx; x < Math.min(bx + bw, width); x++) {
              const sx = clamp(x + shiftX, 0, width - 1);
              const sy = clamp(y + shiftY, 0, height - 1);
              const dstIdx = (y * width + x) * 4;
              const srcIdx = (sy * width + sx) * 4;
              dst[dstIdx] = data[srcIdx];
              dst[dstIdx + 1] = data[srcIdx + 1];
              dst[dstIdx + 2] = data[srcIdx + 2];
            }
          }
        }
        break;
      }
    }

    return out;
  },
};

export const moshDef: EffectToolDef = {
  effect: moshEffect,
  sliders: [
    { key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, defaultValue: 50, hint: 'How corrupted the output looks' },
    { key: 'blockSize', label: 'Block Size', min: 4, max: 64, step: 2, defaultValue: 16, hint: 'Size of displaced blocks' },
  ],
  modes: [
    { key: 'mode', modes: ['Block Shift', 'Row Glitch', 'Byte Corrupt'], defaultIndex: 0 },
  ],
};

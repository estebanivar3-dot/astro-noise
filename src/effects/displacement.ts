/**
 * Displacement — uses the image's own luminance (or a single channel)
 * as a displacement map. Bright pixels push one direction, dark pixels
 * push the other, creating organic self-distortion.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

const displacementEffect: PixelEffect = {
  id: 'displacement',
  label: 'Displacement',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const amount = config['amount'] ?? 60;
    const mode = config['mode'] ?? 0;
    const dirX = config['directionX'] ?? 0;
    const dirY = config['directionY'] ?? 0;

    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    // Drag direction + distance
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

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        // Read displacement value (0-1) based on mode
        let value: number;
        switch (mode) {
          case 1:
            // Red channel
            value = data[i] / 255;
            break;
          case 2:
            // Blue channel
            value = data[i + 2] / 255;
            break;
          default:
            // Luminance
            value = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
            break;
        }

        // Center around 0: bright → positive, dark → negative
        const offset = (value - 0.5) * 2 * amount * dragScale;

        const sx = clamp(Math.round(x + offset * dx), 0, width - 1);
        const sy = clamp(Math.round(y + offset * dy), 0, height - 1);
        const si = (sy * width + sx) * 4;

        dst[i]     = data[si];
        dst[i + 1] = data[si + 1];
        dst[i + 2] = data[si + 2];
        dst[i + 3] = data[i + 3];
      }
    }

    return out;
  },
};

export const displacementDef: EffectToolDef = {
  effect: displacementEffect,
  sliders: [
    { key: 'amount', label: 'Amount', min: 0, max: 500, step: 1, defaultValue: 60, hint: 'How far pixels shift' },
  ],
  modes: [
    { key: 'mode', modes: ['Luminance', 'Red Channel', 'Blue Channel'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

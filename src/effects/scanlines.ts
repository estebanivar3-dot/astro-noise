/**
 * Scanlines — RGB channel separation + vertical scanline grid.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

const scanlinesEffect: PixelEffect = {
  id: 'scanlines',
  label: 'Scanlines',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const intensity = (config['intensity'] ?? 100) / 100;
    const mode = config['mode'] ?? 0;
    // X/Y come from drag-bound sliders (or manual adjustment)
    const shiftX = config['shiftX'] ?? 0;
    const shiftY = config['shiftY'] ?? 0;
    const dx = shiftX * intensity;
    const dy = shiftY * intensity;
    const dragMag = Math.sqrt(shiftX * shiftX + shiftY * shiftY) * intensity;

    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    // Pass 1: Channel separation
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        let rOx: number, rOy: number, gOx: number, gOy: number, bOx: number, bOy: number;

        switch (mode) {
          case 1:
            rOx = dx; rOy = 0;
            gOx = 0; gOy = 0;
            bOx = -dx; bOy = 0;
            break;
          case 2:
            rOx = 0; rOy = dy || dragMag;
            gOx = 0; gOy = 0;
            bOx = 0; bOy = -(dy || dragMag);
            break;
          case 3: {
            const cx = x - width / 2;
            const cy = y - height / 2;
            const cMag = Math.sqrt(cx * cx + cy * cy) || 1;
            const scale = dragMag / cMag * 0.3;
            rOx = cx * scale; rOy = cy * scale;
            gOx = 0; gOy = 0;
            bOx = -cx * scale; bOy = -cy * scale;
            break;
          }
          default:
            rOx = dx; rOy = dy;
            gOx = 0; gOy = 0;
            bOx = -dx; bOy = -dy;
            break;
        }

        const rSx = clamp(Math.round(x - rOx), 0, width - 1);
        const rSy = clamp(Math.round(y - rOy), 0, height - 1);
        const gSx = clamp(Math.round(x - gOx), 0, width - 1);
        const gSy = clamp(Math.round(y - gOy), 0, height - 1);
        const bSx = clamp(Math.round(x - bOx), 0, width - 1);
        const bSy = clamp(Math.round(y - bOy), 0, height - 1);

        dst[i]     = data[(rSy * width + rSx) * 4];
        dst[i + 1] = data[(gSy * width + gSx) * 4 + 1];
        dst[i + 2] = data[(bSy * width + bSx) * 4 + 2];
        dst[i + 3] = data[i + 3];
      }
    }

    // Pass 2: Subtle scanline grid (displacement is the star)
    const gridAmt = (config['grid'] ?? 20) / 100;

    if (gridAmt > 0) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const col = x % 3;
          const dimFactor = 1 - gridAmt * 0.5;
          const boostFactor = 1 + gridAmt * 0.6;

          if (col === 0) {
            dst[i]     = clamp(Math.round(dst[i] * boostFactor), 0, 255);
            dst[i + 1] = clamp(Math.round(dst[i + 1] * dimFactor), 0, 255);
            dst[i + 2] = clamp(Math.round(dst[i + 2] * dimFactor), 0, 255);
          } else if (col === 1) {
            dst[i]     = clamp(Math.round(dst[i] * dimFactor), 0, 255);
            dst[i + 1] = clamp(Math.round(dst[i + 1] * boostFactor), 0, 255);
            dst[i + 2] = clamp(Math.round(dst[i + 2] * dimFactor), 0, 255);
          } else {
            dst[i]     = clamp(Math.round(dst[i] * dimFactor), 0, 255);
            dst[i + 1] = clamp(Math.round(dst[i + 1] * dimFactor), 0, 255);
            dst[i + 2] = clamp(Math.round(dst[i + 2] * boostFactor), 0, 255);
          }
        }
      }
    }

    return out;
  },
};

export const scanlinesDef: EffectToolDef = {
  effect: scanlinesEffect,
  sliders: [
    { key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, defaultValue: 100, hint: 'Strength of channel displacement' },
    { key: 'shiftX', label: 'X', min: -500, max: 500, step: 1, defaultValue: 0, dragBind: 'x' },
    { key: 'shiftY', label: 'Y', min: -500, max: 500, step: 1, defaultValue: 0, dragBind: 'y' },
    { key: 'grid', label: 'Scanline Grid', min: 0, max: 100, step: 1, defaultValue: 20, hint: 'Strength of the RGB sub-pixel grid' },
  ],
  modes: [
    { key: 'mode', modes: ['Directional', 'Horizontal', 'Vertical', 'Radial'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

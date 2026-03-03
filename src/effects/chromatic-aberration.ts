/**
 * Chromatic Aberration — lens-inspired RGB channel separation.
 * Unlike Channel Shift, offset is position-dependent (increases toward edges).
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

const chromaticEffect: PixelEffect = {
  id: 'chromatic-aberration',
  label: 'Chromatic Aberration',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const offset = config['offset'] ?? 10;
    const falloff = (config['falloff'] ?? 50) / 100;
    const mode = config['mode'] ?? 0;
    const dirX = config['directionX'] ?? 0;
    const dirY = config['directionY'] ?? 0;

    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    // Determine offset direction + distance from drag
    let dx = dirX;
    let dy = dirY;
    const mag = Math.sqrt(dx * dx + dy * dy);
    // Drag distance scales the offset (0 drag = slider only, more drag = stronger)
    const dragScale = mag > 0 ? 1 + mag * 0.02 : 1;
    if (mag > 0) {
      dx = dx / mag;
      dy = dy / mag;
    } else {
      dx = 1;
      dy = 0;
    }

    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        const distX = x - cx;
        const distY = y - cy;
        const dist = Math.sqrt(distX * distX + distY * distY);
        const normDist = dist / maxDist;

        let scale: number;

        switch (mode) {
          case 1: {
            // Radial — linear ramp from center
            scale = offset * dragScale * normDist * (0.2 + falloff * 0.8);
            break;
          }
          case 2: {
            // Barrel — quadratic curve (stronger near edges)
            const barrel = normDist * normDist;
            scale = offset * dragScale * barrel * (0.2 + falloff * 0.8);
            break;
          }
          default: {
            // Uniform — falloff adds edge emphasis (0 = constant everywhere)
            scale = offset * dragScale * (1 + normDist * falloff);
            break;
          }
        }

        // R: offset in drag direction, G: stays, B: opposite direction
        const rSx = clamp(Math.round(x + dx * scale), 0, width - 1);
        const rSy = clamp(Math.round(y + dy * scale), 0, height - 1);
        const bSx = clamp(Math.round(x - dx * scale), 0, width - 1);
        const bSy = clamp(Math.round(y - dy * scale), 0, height - 1);

        dst[i]     = data[(rSy * width + rSx) * 4];
        dst[i + 1] = data[i + 1];
        dst[i + 2] = data[(bSy * width + bSx) * 4 + 2];
        dst[i + 3] = data[i + 3];
      }
    }

    return out;
  },
};

export const chromaticDef: EffectToolDef = {
  effect: chromaticEffect,
  sliders: [
    { key: 'offset', label: 'Offset', min: 1, max: 200, step: 1, defaultValue: 15, hint: 'Base RGB channel separation distance' },
    { key: 'falloff', label: 'Falloff', min: 0, max: 100, step: 1, defaultValue: 50, hint: 'Edge emphasis — 0 is uniform, higher values increase separation near edges' },
    { key: 'directionX', label: 'X', min: -100, max: 100, step: 1, defaultValue: 80, hint: 'Horizontal aberration direction', dragBind: 'x' },
    { key: 'directionY', label: 'Y', min: -100, max: 100, step: 1, defaultValue: 0, hint: 'Vertical aberration direction', dragBind: 'y' },
  ],
  modes: [
    { key: 'mode', modes: ['Uniform', 'Radial', 'Barrel'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

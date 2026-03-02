/**
 * Slit-Scan — each row/column samples from a different spatial offset,
 * creating warping and stretching effects inspired by slit-scan photography.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

const slitScanEffect: PixelEffect = {
  id: 'slit-scan',
  label: 'Slit-Scan',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const amount = config['amount'] ?? 60;
    const frequency = config['frequency'] ?? 3;
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

    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        // Compute position along the scan axis (perpendicular to drag direction)
        // Use the component perpendicular to drag for the scan position
        const scanPos = (-dy * (x - cx) + dx * (y - cy)) / Math.max(width, height) + 0.5;

        let offset: number;

        switch (mode) {
          case 1: {
            // Sine — wavy liquid distortion
            offset = amount * Math.sin(scanPos * Math.PI * 2 * frequency);
            break;
          }
          case 2: {
            // Spiral — radial distance-based warping
            const distX = x - cx;
            const distY = y - cy;
            const dist = Math.sqrt(distX * distX + distY * distY);
            offset = amount * Math.sin(dist / maxDist * Math.PI * 2 * frequency);
            break;
          }
          default: {
            // Linear — progressive shear
            offset = amount * (scanPos * 2 - 1);
            break;
          }
        }

        offset *= dragScale;

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

export const slitScanDef: EffectToolDef = {
  effect: slitScanEffect,
  sliders: [
    { key: 'amount', label: 'Amount', min: 0, max: 200, step: 1, defaultValue: 60, hint: 'How far each scan line shifts' },
    { key: 'frequency', label: 'Frequency', min: 1, max: 20, step: 1, defaultValue: 3, hint: 'Oscillation frequency of the offset pattern' },
  ],
  modes: [
    { key: 'mode', modes: ['Linear', 'Sine', 'Spiral'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

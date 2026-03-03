/**
 * Melt effect — pixels drip/fall based on luminance.
 * Drag controls melt direction. Dark or bright tones can melt.
 */

import type { PixelEffect, EffectToolDef, EffectConfig } from './types.ts';

function clamp(v: number, lo = 0, hi = 255): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function luminance(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

/**
 * Simple box blur on a float array (single channel, width × height).
 */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return src;
  const out = new Float32Array(w * h);
  const r = Math.min(radius, Math.min(w, h) - 1);

  // Horizontal pass
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const row = y * w;
    // Initialize window
    for (let x = 0; x <= r; x++) sum += src[row + x];
    for (let x = 0; x < w; x++) {
      if (x + r + 1 < w) sum += src[row + x + r + 1];
      if (x - r - 1 >= 0) sum -= src[row + x - r - 1];
      const count = Math.min(x + r + 1, w) - Math.max(x - r, 0);
      tmp[row + x] = sum / count;
    }
  }

  // Vertical pass
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y <= r; y++) sum += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + r + 1 < h) sum += tmp[(y + r + 1) * w + x];
      if (y - r - 1 >= 0) sum -= tmp[(y - r - 1) * w + x];
      const count = Math.min(y + r + 1, h) - Math.max(y - r, 0);
      out[y * w + x] = sum / count;
    }
  }

  return out;
}

const meltEffect: PixelEffect = {
  id: 'melt',
  label: 'Melt',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const amount = (config['amount'] ?? 60) as number;
    const smoothing = (config['smoothing'] ?? 3) as number;
    const mode = (config['mode'] ?? 0) as number;
    const dirX = (config['directionX'] ?? 0) as number;
    const dirY = (config['directionY'] ?? 0) as number;

    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    // Drag direction and magnitude
    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    const dragScale = mag > 0 ? 1 + mag * 0.01 : 1;
    let dx = 0, dy = 1; // Default: melt downward
    if (mag > 0) {
      dx = dirX / mag;
      dy = dirY / mag;
    }

    // Build displacement map from luminance
    const dispMap = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = luminance(data[i], data[i + 1], data[i + 2]) / 255;
        // Mode 0: dark pixels melt more. Mode 1: bright pixels melt more.
        const disp = mode === 1 ? lum : 1 - lum;
        dispMap[y * width + x] = disp * amount * dragScale;
      }
    }

    // Smooth the displacement map
    const smoothed = boxBlur(dispMap, width, height, smoothing);

    // Sample source at displaced positions
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const displacement = smoothed[idx];
        const sx = clamp(Math.round(x - displacement * dx), 0, width - 1);
        const sy = clamp(Math.round(y - displacement * dy), 0, height - 1);

        const di = idx * 4;
        const si = (sy * width + sx) * 4;
        dst[di] = data[si];
        dst[di + 1] = data[si + 1];
        dst[di + 2] = data[si + 2];
        dst[di + 3] = data[di + 3];
      }
    }

    return out;
  },
};

export const meltDef: EffectToolDef = {
  effect: meltEffect,
  sliders: [
    { key: 'amount', label: 'Amount', min: 1, max: 400, step: 1, defaultValue: 60, hint: 'How far pixels drip' },
    { key: 'smoothing', label: 'Smoothing', min: 0, max: 20, step: 1, defaultValue: 3, hint: 'Blur on the melt map' },
  ],
  modes: [
    { key: 'mode', modes: ['Dark Melts', 'Bright Melts'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

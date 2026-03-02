/**
 * Pixel Sort — scans rows/columns for pixel runs exceeding a brightness
 * threshold, then sorts each run by luminance, hue, or saturation.
 * The iconic glitch art technique.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function luminance(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function rgbToHue(r: number, g: number, b: number): number {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

function rgbToSaturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

/**
 * Get the sort key for a pixel based on mode.
 */
function sortKey(r: number, g: number, b: number, mode: number): number {
  switch (mode) {
    case 1: return rgbToHue(r, g, b);
    case 2: return rgbToSaturation(r, g, b);
    default: return luminance(r, g, b);
  }
}

/**
 * Sort pixel runs in a single row of RGBA data.
 * Modifies `buf` in place. `stride` is the byte offset between row starts.
 */
function sortRow(
  buf: Uint8ClampedArray,
  rowStart: number,
  width: number,
  _stride: number,
  threshold: number,
  maxLen: number,
  mode: number,
): void {
  let x = 0;

  while (x < width) {
    // Find the start of a run: pixel luminance above threshold
    const i = rowStart + x * 4;
    const lum = luminance(buf[i], buf[i + 1], buf[i + 2]);
    if (lum < threshold) {
      x++;
      continue;
    }

    // Collect the run
    const runStart = x;
    while (x < width && x - runStart < maxLen) {
      const j = rowStart + x * 4;
      if (luminance(buf[j], buf[j + 1], buf[j + 2]) < threshold) break;
      x++;
    }
    const runLen = x - runStart;
    if (runLen < 2) continue;

    // Extract pixels with sort keys
    const pixels: { key: number; r: number; g: number; b: number; a: number }[] = [];
    for (let k = 0; k < runLen; k++) {
      const j = rowStart + (runStart + k) * 4;
      const r = buf[j], g = buf[j + 1], b = buf[j + 2], a = buf[j + 3];
      pixels.push({ key: sortKey(r, g, b, mode), r, g, b, a });
    }

    // Sort by key
    pixels.sort((a, b) => a.key - b.key);

    // Write back
    for (let k = 0; k < runLen; k++) {
      const j = rowStart + (runStart + k) * 4;
      const p = pixels[k];
      buf[j] = p.r;
      buf[j + 1] = p.g;
      buf[j + 2] = p.b;
      buf[j + 3] = p.a;
    }
  }
}

const pixelSortEffect: PixelEffect = {
  id: 'pixel-sort',
  label: 'Pixel Sort',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const threshold = config['threshold'] ?? 128;
    const maxLen = Math.round(config['length'] ?? 200);
    const mode = config['mode'] ?? 0;
    const dirX = config['directionX'] ?? 0;
    const dirY = config['directionY'] ?? 0;

    const { width, height, data } = source;

    // Drag controls direction: horizontal drag = sort rows, vertical = sort columns
    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    const horizontal = mag > 0 ? Math.abs(dirX / mag) > 0.5 : true;
    const dragScale = mag > 0 ? 1 + mag * 0.005 : 1;

    // Adjusted threshold: drag distance lowers threshold (sorts more pixels)
    const adjThreshold = clamp(threshold / dragScale, 0, 255);

    if (horizontal) {
      // Sort rows
      const buf = new Uint8ClampedArray(data);
      for (let y = 0; y < height; y++) {
        sortRow(buf, y * width * 4, width, width * 4, adjThreshold, maxLen, mode);
      }
      const out = new ImageData(width, height);
      out.data.set(buf);
      return out;
    } else {
      // Sort columns by transposing, sorting rows, transposing back
      const srcW = height;
      const srcH = width;
      const buf = new Uint8ClampedArray(srcW * srcH * 4);

      // Transpose: source (x,y) → buf row=x, col=y
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const si = (y * width + x) * 4;
          const di = (x * height + y) * 4;
          buf[di] = data[si];
          buf[di + 1] = data[si + 1];
          buf[di + 2] = data[si + 2];
          buf[di + 3] = data[si + 3];
        }
      }

      // Sort each row (= original column)
      for (let row = 0; row < srcH; row++) {
        sortRow(buf, row * srcW * 4, srcW, srcW * 4, adjThreshold, maxLen, mode);
      }

      // Transpose back
      const out = new ImageData(width, height);
      const dst = out.data;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const si = (x * height + y) * 4;
          const di = (y * width + x) * 4;
          dst[di] = buf[si];
          dst[di + 1] = buf[si + 1];
          dst[di + 2] = buf[si + 2];
          dst[di + 3] = buf[si + 3];
        }
      }

      return out;
    }
  },
};

export const pixelSortDef: EffectToolDef = {
  effect: pixelSortEffect,
  sliders: [
    { key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1, defaultValue: 128, hint: 'Brightness cutoff — which pixels get sorted' },
    { key: 'length', label: 'Max Length', min: 10, max: 500, step: 1, defaultValue: 200, hint: 'Maximum streak length' },
  ],
  modes: [
    { key: 'mode', modes: ['Luminance', 'Hue', 'Saturation'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

/**
 * Pixel Sort — scans rows/columns for pixel runs exceeding a brightness
 * threshold, then sorts each run by luminance, hue, or saturation.
 * The iconic glitch art technique.
 *
 * Uses flat typed arrays (not object arrays) for sorting to avoid
 * GC pressure from creating thousands of short-lived objects per frame.
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

function sortKey(r: number, g: number, b: number, mode: number): number {
  switch (mode) {
    case 1: return rgbToHue(r, g, b);
    case 2: return rgbToSaturation(r, g, b);
    default: return luminance(r, g, b);
  }
}

function inRun(r: number, g: number, b: number, mode: number, threshold: number): boolean {
  switch (mode) {
    case 1:
      return rgbToSaturation(r, g, b) * 255 >= threshold;
    case 2: {
      const lum = luminance(r, g, b);
      const band = 128 - threshold * 0.5;
      return lum >= band && lum <= 255 - band;
    }
    default:
      return luminance(r, g, b) >= threshold;
  }
}

// Pre-allocated flat buffers for sorting — avoids GC from object arrays.
// Reused across all sortRow calls within a single apply().
let sortKeys = new Float64Array(2048);
let sortIndices = new Uint16Array(2048);

function ensureSortBuffers(len: number): void {
  if (sortKeys.length < len) {
    const newLen = Math.max(len, sortKeys.length * 2);
    sortKeys = new Float64Array(newLen);
    sortIndices = new Uint16Array(newLen);
  }
}

function sortRow(
  buf: Uint8ClampedArray,
  rowStart: number,
  width: number,
  threshold: number,
  maxLen: number,
  mode: number,
): void {
  let x = 0;

  while (x < width) {
    const i = rowStart + x * 4;
    if (!inRun(buf[i], buf[i + 1], buf[i + 2], mode, threshold)) {
      x++;
      continue;
    }

    const runStart = x;
    while (x < width && x - runStart < maxLen) {
      const j = rowStart + x * 4;
      if (!inRun(buf[j], buf[j + 1], buf[j + 2], mode, threshold)) break;
      x++;
    }
    const runLen = x - runStart;
    if (runLen < 2) continue;

    ensureSortBuffers(runLen);

    // Fill keys and indices
    for (let k = 0; k < runLen; k++) {
      const j = rowStart + (runStart + k) * 4;
      sortKeys[k] = sortKey(buf[j], buf[j + 1], buf[j + 2], mode);
      sortIndices[k] = k;
    }

    // Sort indices by key (insertion sort for small runs, much faster than Array.sort)
    if (runLen <= 64) {
      for (let a = 1; a < runLen; a++) {
        const ki = sortIndices[a];
        const kv = sortKeys[ki];
        let b = a - 1;
        while (b >= 0 && sortKeys[sortIndices[b]] > kv) {
          sortIndices[b + 1] = sortIndices[b];
          b--;
        }
        sortIndices[b + 1] = ki;
      }
    } else {
      // For longer runs, use native sort on a temporary array slice
      const idxArr = Array.from(sortIndices.subarray(0, runLen));
      idxArr.sort((a, b) => sortKeys[a] - sortKeys[b]);
      for (let k = 0; k < runLen; k++) sortIndices[k] = idxArr[k];
    }

    // Rearrange pixels in-place via a temp copy of the run
    const runBytes = runLen * 4;
    const tmpBuf = new Uint8Array(runBytes);
    tmpBuf.set(buf.subarray(rowStart + runStart * 4, rowStart + runStart * 4 + runBytes));

    for (let k = 0; k < runLen; k++) {
      const srcOff = sortIndices[k] * 4;
      const dstOff = rowStart + (runStart + k) * 4;
      buf[dstOff]     = tmpBuf[srcOff];
      buf[dstOff + 1] = tmpBuf[srcOff + 1];
      buf[dstOff + 2] = tmpBuf[srcOff + 2];
      buf[dstOff + 3] = tmpBuf[srcOff + 3];
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
    const direction = Math.round(config['direction'] ?? 0);
    const mode = config['mode'] ?? 0;

    const { width, height, data } = source;

    const horizontal = direction === 0;
    const adjThreshold = clamp(threshold, 0, 255);

    if (horizontal) {
      const buf = new Uint8ClampedArray(data);
      for (let y = 0; y < height; y++) {
        sortRow(buf, y * width * 4, width, adjThreshold, maxLen, mode);
      }
      const out = new ImageData(width, height);
      out.data.set(buf);
      return out;
    } else {
      const srcW = height;
      const srcH = width;
      const buf = new Uint8ClampedArray(srcW * srcH * 4);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const si = (y * width + x) * 4;
          const di = (x * height + y) * 4;
          buf[di] = data[si]; buf[di + 1] = data[si + 1];
          buf[di + 2] = data[si + 2]; buf[di + 3] = data[si + 3];
        }
      }

      for (let row = 0; row < srcH; row++) {
        sortRow(buf, row * srcW * 4, srcW, adjThreshold, maxLen, mode);
      }

      const out = new ImageData(width, height);
      const dst = out.data;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const si = (x * height + y) * 4;
          const di = (y * width + x) * 4;
          dst[di] = buf[si]; dst[di + 1] = buf[si + 1];
          dst[di + 2] = buf[si + 2]; dst[di + 3] = buf[si + 3];
        }
      }

      return out;
    }
  },
};

export const pixelSortDef: EffectToolDef = {
  effect: pixelSortEffect,
  sliders: [
    { key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1, defaultValue: 128, hint: 'Brightness cutoff — which pixels get sorted', dragBind: 'x' },
    { key: 'length', label: 'Max Length', min: 10, max: 2000, step: 1, defaultValue: 200, hint: 'Maximum streak length', dragBind: 'y' },
  ],
  modes: [
    { key: 'mode', modes: ['Luminance', 'Hue', 'Saturation'], defaultIndex: 0 },
    { key: 'direction', modes: ['Rows', 'Columns'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

/**
 * Seam Carve (Broken) — intentionally corrupted content-aware resize.
 * Removes seams using broken energy functions, then scales back to
 * original dimensions. Faces compress, buildings fold, space collapses.
 *
 * Performance:
 *   - Downsample: large images are reduced to ~360px working resolution.
 *   - Flat column-index map tracks surviving pixels (cache-friendly).
 *   - copyWithin for fast seam removal shifts.
 *   - Incremental energy: only ~2×height pixels re-evaluated per seam.
 *   - Xorshift PRNG avoids expensive modular division.
 *
 * All energy/cost arrays use wW as their row stride — not curW — so
 * rows stay aligned as seams are removed.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

/** Max working dimension for the DP computation. */
const MAX_WORK = 300;

// ---------------------------------------------------------------------------
// Downsample helper
// ---------------------------------------------------------------------------

function downsample(
  src: Uint8ClampedArray, srcW: number, srcH: number,
  dstW: number, dstH: number,
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(Math.floor(y * yRatio), srcH - 1);
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(Math.floor(x * xRatio), srcW - 1);
      const si = (sy * srcW + sx) * 4;
      const di = (y * dstW + x) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
    }
  }
  return dst;
}

// ---------------------------------------------------------------------------
// Energy functions — all use eStride (= wW) for row offsets
// ---------------------------------------------------------------------------

function pixelEnergy(
  data: Uint8ClampedArray,
  x: number, y: number,
  w: number, h: number,
  stride: number,
): number {
  const lx = x > 0 ? x - 1 : 0;
  const rx = x < w - 1 ? x + 1 : w - 1;
  const li = (y * stride + lx) * 4;
  const ri = (y * stride + rx) * 4;
  const dxR = data[ri] - data[li];
  const dxG = data[ri + 1] - data[li + 1];
  const dxB = data[ri + 2] - data[li + 2];

  const ty = y > 0 ? y - 1 : 0;
  const by = y < h - 1 ? y + 1 : h - 1;
  const ti = (ty * stride + x) * 4;
  const bi = (by * stride + x) * 4;
  const dyR = data[bi] - data[ti];
  const dyG = data[bi + 1] - data[ti + 1];
  const dyB = data[bi + 2] - data[ti + 2];

  return Math.sqrt(
    dxR * dxR + dxG * dxG + dxB * dxB +
    dyR * dyR + dyG * dyG + dyB * dyB,
  );
}

function computeEnergy(
  data: Uint8ClampedArray,
  colMap: Int32Array,
  curW: number,
  height: number,
  bufStride: number,
  eStride: number,
): Float32Array {
  const energy = new Float32Array(eStride * height);
  for (let y = 0; y < height; y++) {
    const eRow = y * eStride;
    const cRow = y * eStride;
    for (let vx = 0; vx < curW; vx++) {
      energy[eRow + vx] = pixelEnergy(data, colMap[cRow + vx], y, bufStride, height, bufStride);
    }
  }
  return energy;
}

function updateEnergyNearSeam(
  energy: Float32Array,
  data: Uint8ClampedArray,
  colMap: Int32Array,
  seam: Int32Array,
  curW: number,
  height: number,
  bufStride: number,
  eStride: number,
): void {
  for (let y = 0; y < height; y++) {
    const sx = seam[y];
    const eRow = y * eStride;
    const cRow = y * eStride;
    for (let dx = -1; dx <= 1; dx++) {
      const vx = sx + dx;
      if (vx >= 0 && vx < curW) {
        energy[eRow + vx] = pixelEnergy(data, colMap[cRow + vx], y, bufStride, height, bufStride);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Seam finders — use eStride for row offsets in energy/cost arrays
// ---------------------------------------------------------------------------

function findVerticalSeam(
  energy: Float32Array,
  width: number,
  height: number,
  cost: Float32Array,
  eStride: number,
): Int32Array {
  for (let x = 0; x < width; x++) cost[x] = energy[x];

  for (let y = 1; y < height; y++) {
    const row = y * eStride;
    const prev = (y - 1) * eStride;
    for (let x = 0; x < width; x++) {
      let m = cost[prev + x];
      if (x > 0 && cost[prev + x - 1] < m) m = cost[prev + x - 1];
      if (x < width - 1 && cost[prev + x + 1] < m) m = cost[prev + x + 1];
      cost[row + x] = energy[row + x] + m;
    }
  }

  const seam = new Int32Array(height);
  let minVal = Infinity;
  let minX = 0;
  const last = (height - 1) * eStride;
  for (let x = 0; x < width; x++) {
    if (cost[last + x] < minVal) { minVal = cost[last + x]; minX = x; }
  }
  seam[height - 1] = minX;

  for (let y = height - 2; y >= 0; y--) {
    const px = seam[y + 1];
    const r = y * eStride;
    let bx = px;
    let bc = cost[r + px];
    if (px > 0 && cost[r + px - 1] < bc) { bc = cost[r + px - 1]; bx = px - 1; }
    if (px < width - 1 && cost[r + px + 1] < bc) { bx = px + 1; }
    seam[y] = bx;
  }
  return seam;
}

function findMaxVerticalSeam(
  energy: Float32Array,
  width: number,
  height: number,
  cost: Float32Array,
  eStride: number,
): Int32Array {
  for (let x = 0; x < width; x++) cost[x] = energy[x];

  for (let y = 1; y < height; y++) {
    const row = y * eStride;
    const prev = (y - 1) * eStride;
    for (let x = 0; x < width; x++) {
      let m = cost[prev + x];
      if (x > 0 && cost[prev + x - 1] > m) m = cost[prev + x - 1];
      if (x < width - 1 && cost[prev + x + 1] > m) m = cost[prev + x + 1];
      cost[row + x] = energy[row + x] + m;
    }
  }

  const seam = new Int32Array(height);
  let maxVal = -Infinity;
  let maxX = 0;
  const last = (height - 1) * eStride;
  for (let x = 0; x < width; x++) {
    if (cost[last + x] > maxVal) { maxVal = cost[last + x]; maxX = x; }
  }
  seam[height - 1] = maxX;

  for (let y = height - 2; y >= 0; y--) {
    const px = seam[y + 1];
    const r = y * eStride;
    let bx = px;
    let bc = cost[r + px];
    if (px > 0 && cost[r + px - 1] > bc) { bc = cost[r + px - 1]; bx = px - 1; }
    if (px < width - 1 && cost[r + px + 1] > bc) { bx = px + 1; }
    seam[y] = bx;
  }
  return seam;
}

function randomSeam(width: number, height: number, rand: () => number): Int32Array {
  const seam = new Int32Array(height);
  seam[0] = Math.floor(rand() * width);
  for (let y = 1; y < height; y++) {
    const p = seam[y - 1];
    const r = rand();
    if (r < 0.33 && p > 0) seam[y] = p - 1;
    else if (r > 0.66 && p < width - 1) seam[y] = p + 1;
    else seam[y] = p;
  }
  return seam;
}

// ---------------------------------------------------------------------------
// Seam removal — copyWithin for fast shifts on flat arrays
// ---------------------------------------------------------------------------

function removeSeamFromMap(
  colMap: Int32Array,
  energy: Float32Array,
  seam: Int32Array,
  curW: number,
  height: number,
  eStride: number,
): void {
  for (let y = 0; y < height; y++) {
    const sx = seam[y];
    const rowOff = y * eStride;
    // Shift elements left by 1 from sx+1..curW using native memcpy
    colMap.copyWithin(rowOff + sx, rowOff + sx + 1, rowOff + curW);
    energy.copyWithin(rowOff + sx, rowOff + sx + 1, rowOff + curW);
  }
}

// ---------------------------------------------------------------------------
// Effect
// ---------------------------------------------------------------------------

const seamCarveEffect: PixelEffect = {
  id: 'seam-carve',
  label: 'Seam Carve',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const amount = Math.max(1, Math.min(35, Math.round((config['amount'] ?? 15) as number)));
    const chaos = ((config['chaos'] ?? 50) as number) / 100;
    const mode = (config['mode'] ?? 0) as number;
    const dirX = (config['directionX'] ?? 0) as number;
    const dirY = (config['directionY'] ?? 0) as number;

    const { width, height, data } = source;
    const out = new ImageData(width, height);

    // Drag direction: horizontal drag = vertical seams (compress width)
    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    const horizontal = mag > 0 ? Math.abs(dirX / mag) > 0.5 : true;

    const fullW = horizontal ? width : height;
    const fullH = horizontal ? height : width;

    // Build full-res buffer (transpose if vertical carve)
    const fullBuf = new Uint8ClampedArray(fullW * fullH * 4);
    if (horizontal) {
      fullBuf.set(data);
    } else {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const si = (y * width + x) * 4;
          const di = (x * height + y) * 4;
          fullBuf[di] = data[si]; fullBuf[di + 1] = data[si + 1];
          fullBuf[di + 2] = data[si + 2]; fullBuf[di + 3] = data[si + 3];
        }
      }
    }

    // ---- Downsample for speed ----
    const needsDown = fullW > MAX_WORK;
    const wW = needsDown ? MAX_WORK : fullW;
    const wH = needsDown ? Math.max(2, Math.round(fullH * MAX_WORK / fullW)) : fullH;
    const buf = needsDown ? downsample(fullBuf, fullW, fullH, wW, wH) : fullBuf;

    // Amount is a percentage — compute seam count at working resolution
    const maxSeams = Math.min(
      Math.max(1, Math.round(wW * amount / 100)),
      Math.floor(wW * 0.35),
    );
    let curW = wW;

    // Xorshift PRNG — avoids expensive modular division
    let seed = Math.max(1, Math.round(amount * 7 + chaos * 131 + mode * 37 + Math.abs(dirX) * 11 + Math.abs(dirY) * 13)) | 0;
    function rand(): number {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    }

    // Flat column index map — colMap[y * wW + vx] = real column in buf
    const eStride = wW;
    const colMap = new Int32Array(eStride * wH);
    for (let y = 0; y < wH; y++) {
      const rowOff = y * eStride;
      for (let x = 0; x < wW; x++) colMap[rowOff + x] = x;
    }

    // Energy/cost arrays
    const costBuf = new Float32Array(eStride * wH);
    const noisyBuf = (mode === 0) ? new Float32Array(eStride * wH) : null;

    let energy = (mode !== 1)
      ? computeEnergy(buf, colMap, curW, wH, wW, eStride)
      : new Float32Array(0);

    for (let s = 0; s < maxSeams && curW > 2; s++) {
      let seam: Int32Array;

      if (mode === 1) {
        seam = randomSeam(curW, wH, rand);
      } else if (mode === 0) {
        // Broken Energy — mix real energy with random noise
        for (let y = 0; y < wH; y++) {
          const eRow = y * eStride;
          for (let x = 0; x < curW; x++) {
            noisyBuf![eRow + x] = energy[eRow + x] * (1 - chaos) + rand() * 400 * chaos;
          }
        }
        seam = findVerticalSeam(noisyBuf!, curW, wH, costBuf, eStride);
      } else {
        seam = findMaxVerticalSeam(energy, curW, wH, costBuf, eStride);
      }

      removeSeamFromMap(colMap, energy, seam, curW, wH, eStride);
      curW--;

      if (mode !== 1 && curW > 1) {
        updateEnergyNearSeam(energy, buf, colMap, seam, curW, wH, wW, eStride);
      }
    }

    // ---- Render carved result back with linear interpolation ----
    const dst = out.data;
    if (horizontal) {
      for (let y = 0; y < height; y++) {
        const wY = needsDown ? Math.min(Math.floor(y * wH / height), wH - 1) : y;
        const cRow = wY * eStride;
        for (let x = 0; x < width; x++) {
          const fvx = (x + 0.5) * curW / width - 0.5;
          const vx0 = Math.max(0, Math.min(Math.floor(fvx), curW - 1));
          const vx1 = Math.min(vx0 + 1, curW - 1);
          const t = Math.max(0, fvx - vx0);

          const si0 = (wY * wW + colMap[cRow + vx0]) * 4;
          const si1 = (wY * wW + colMap[cRow + vx1]) * 4;
          const di = (y * width + x) * 4;

          dst[di]     = Math.round(buf[si0]     + (buf[si1]     - buf[si0])     * t);
          dst[di + 1] = Math.round(buf[si0 + 1] + (buf[si1 + 1] - buf[si0 + 1]) * t);
          dst[di + 2] = Math.round(buf[si0 + 2] + (buf[si1 + 2] - buf[si0 + 2]) * t);
          dst[di + 3] = data[di + 3];
        }
      }
    } else {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const wRow = needsDown ? Math.min(Math.floor(x * wH / width), wH - 1) : x;
          const cRow = wRow * eStride;
          const fvc = (y + 0.5) * curW / height - 0.5;
          const vc0 = Math.max(0, Math.min(Math.floor(fvc), curW - 1));
          const vc1 = Math.min(vc0 + 1, curW - 1);
          const t = Math.max(0, fvc - vc0);

          const si0 = (wRow * wW + colMap[cRow + vc0]) * 4;
          const si1 = (wRow * wW + colMap[cRow + vc1]) * 4;
          const di = (y * width + x) * 4;

          dst[di]     = Math.round(buf[si0]     + (buf[si1]     - buf[si0])     * t);
          dst[di + 1] = Math.round(buf[si0 + 1] + (buf[si1 + 1] - buf[si0 + 1]) * t);
          dst[di + 2] = Math.round(buf[si0 + 2] + (buf[si1 + 2] - buf[si0 + 2]) * t);
          dst[di + 3] = data[di + 3];
        }
      }
    }

    return out;
  },
};

export const seamCarveDef: EffectToolDef = {
  effect: seamCarveEffect,
  sliders: [
    { key: 'amount', label: 'Amount', min: 1, max: 50, step: 1, defaultValue: 15, hint: 'Percentage of image to carve', dragBind: 'x' },
    { key: 'chaos', label: 'Chaos', min: 0, max: 100, step: 1, defaultValue: 50, hint: 'How wrong the content detection is', dragBind: 'y' },
  ],
  modes: [
    { key: 'mode', modes: ['Broken Energy', 'Random Seams', 'Reverse'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

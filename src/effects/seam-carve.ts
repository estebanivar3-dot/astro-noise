/**
 * Seam Carve (Broken) — intentionally corrupted content-aware resize.
 * Removes seams using broken energy functions, then scales back to
 * original dimensions. Faces compress, buildings fold, space collapses.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

/**
 * Compute gradient-based energy for each pixel.
 * Returns Float32Array of size width * height.
 */
function computeEnergy(data: Uint8ClampedArray, width: number, height: number, stride: number): Float32Array {
  const energy = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      // Horizontal gradient (use stride for pixel buffer addressing)
      const lx = Math.max(0, x - 1);
      const rx = Math.min(width - 1, x + 1);
      const li = (y * stride + lx) * 4;
      const ri = (y * stride + rx) * 4;
      const dxR = data[ri] - data[li];
      const dxG = data[ri + 1] - data[li + 1];
      const dxB = data[ri + 2] - data[li + 2];

      // Vertical gradient
      const ty = Math.max(0, y - 1);
      const by = Math.min(height - 1, y + 1);
      const ti = (ty * stride + x) * 4;
      const bi = (by * stride + x) * 4;
      const dyR = data[bi] - data[ti];
      const dyG = data[bi + 1] - data[ti + 1];
      const dyB = data[bi + 2] - data[ti + 2];

      energy[idx] = Math.sqrt(
        dxR * dxR + dxG * dxG + dxB * dxB +
        dyR * dyR + dyG * dyG + dyB * dyB,
      );
    }
  }

  return energy;
}

/**
 * Find and return one minimum-cost vertical seam using DP.
 * Returns array of x-coordinates, one per row.
 */
function findVerticalSeam(energy: Float32Array, width: number, height: number): Int32Array {
  // Cost matrix (reuse a flat array)
  const cost = new Float32Array(width * height);

  // First row = energy
  for (let x = 0; x < width; x++) {
    cost[x] = energy[x];
  }

  // Fill DP table top-down
  for (let y = 1; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let minPrev = cost[(y - 1) * width + x];
      if (x > 0) minPrev = Math.min(minPrev, cost[(y - 1) * width + x - 1]);
      if (x < width - 1) minPrev = Math.min(minPrev, cost[(y - 1) * width + x + 1]);
      cost[idx] = energy[idx] + minPrev;
    }
  }

  // Backtrack from minimum in bottom row
  const seam = new Int32Array(height);
  let minVal = Infinity;
  let minX = 0;
  const lastRow = (height - 1) * width;
  for (let x = 0; x < width; x++) {
    if (cost[lastRow + x] < minVal) {
      minVal = cost[lastRow + x];
      minX = x;
    }
  }
  seam[height - 1] = minX;

  for (let y = height - 2; y >= 0; y--) {
    const prevX = seam[y + 1];
    let bestX = prevX;
    let bestCost = cost[y * width + prevX];
    if (prevX > 0 && cost[y * width + prevX - 1] < bestCost) {
      bestCost = cost[y * width + prevX - 1];
      bestX = prevX - 1;
    }
    if (prevX < width - 1 && cost[y * width + prevX + 1] < bestCost) {
      bestX = prevX + 1;
    }
    seam[y] = bestX;
  }

  return seam;
}

/**
 * Find one maximum-cost seam (Reverse mode).
 */
function findMaxVerticalSeam(energy: Float32Array, width: number, height: number): Int32Array {
  const cost = new Float32Array(width * height);

  for (let x = 0; x < width; x++) {
    cost[x] = energy[x];
  }

  for (let y = 1; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let maxPrev = cost[(y - 1) * width + x];
      if (x > 0) maxPrev = Math.max(maxPrev, cost[(y - 1) * width + x - 1]);
      if (x < width - 1) maxPrev = Math.max(maxPrev, cost[(y - 1) * width + x + 1]);
      cost[idx] = energy[idx] + maxPrev;
    }
  }

  const seam = new Int32Array(height);
  let maxVal = -Infinity;
  let maxX = 0;
  const lastRow = (height - 1) * width;
  for (let x = 0; x < width; x++) {
    if (cost[lastRow + x] > maxVal) {
      maxVal = cost[lastRow + x];
      maxX = x;
    }
  }
  seam[height - 1] = maxX;

  for (let y = height - 2; y >= 0; y--) {
    const prevX = seam[y + 1];
    let bestX = prevX;
    let bestCost = cost[y * width + prevX];
    if (prevX > 0 && cost[y * width + prevX - 1] > bestCost) {
      bestCost = cost[y * width + prevX - 1];
      bestX = prevX - 1;
    }
    if (prevX < width - 1 && cost[y * width + prevX + 1] > bestCost) {
      bestX = prevX + 1;
    }
    seam[y] = bestX;
  }

  return seam;
}

/**
 * Generate a random connected seam path.
 */
function randomSeam(width: number, height: number, rand: () => number): Int32Array {
  const seam = new Int32Array(height);
  seam[0] = Math.floor(rand() * width);

  for (let y = 1; y < height; y++) {
    const prev = seam[y - 1];
    const r = rand();
    if (r < 0.33 && prev > 0) seam[y] = prev - 1;
    else if (r > 0.66 && prev < width - 1) seam[y] = prev + 1;
    else seam[y] = prev;
  }

  return seam;
}

const seamCarveEffect: PixelEffect = {
  id: 'seam-carve',
  label: 'Seam Carve',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const numSeams = Math.round(config['seams'] ?? 60);
    const chaos = (config['chaos'] ?? 50) / 100;
    const mode = config['mode'] ?? 0;
    const dirX = config['directionX'] ?? 0;
    const dirY = config['directionY'] ?? 0;

    const { width, height, data } = source;
    const out = new ImageData(width, height);

    // Drag controls direction: more horizontal drag = vertical seams (compress width)
    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    const horizontal = mag > 0 ? Math.abs(dirX / mag) > 0.5 : true;

    // For horizontal seams (compress height), we transpose, carve, transpose back.
    // For simplicity, we always carve vertical seams but optionally transpose.
    const srcW = horizontal ? width : height;
    const srcH = horizontal ? height : width;

    // Flatten source into a working pixel buffer (RGBA)
    const buf = new Uint8ClampedArray(srcW * srcH * 4);
    if (horizontal) {
      buf.set(data);
    } else {
      // Transpose: (x,y) → (y,x)
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
    }

    // Cap seams to prevent degenerate cases
    const maxSeams = Math.min(numSeams, Math.floor(srcW / 3));
    let curW = srcW;

    // Seeded PRNG
    let seed = Math.round(numSeams * 7 + chaos * 131 + mode * 37 + Math.abs(dirX) * 11 + Math.abs(dirY) * 13);
    function rand(): number {
      seed = (seed * 16807 + 0) % 2147483647;
      return (seed - 1) / 2147483646;
    }

    for (let s = 0; s < maxSeams; s++) {
      let seam: Int32Array;

      if (mode === 1) {
        // Random Seams — ignore energy entirely
        seam = randomSeam(curW, srcH, rand);
      } else {
        // Compute energy on current buffer
        const energy = computeEnergy(buf, curW, srcH, srcW);

        if (mode === 0) {
          // Broken Energy — mix with random noise
          for (let i = 0; i < energy.length; i++) {
            energy[i] = energy[i] * (1 - chaos) + rand() * 400 * chaos;
          }
          seam = findVerticalSeam(energy, curW, srcH);
        } else {
          // Reverse — find maximum-energy seam
          seam = findMaxVerticalSeam(energy, curW, srcH);
        }
      }

      // Remove the seam: shift pixels left
      for (let y = 0; y < srcH; y++) {
        const seamX = seam[y];
        const rowStart = y * srcW * 4;
        // Shift everything right of the seam one pixel left
        for (let x = seamX; x < curW - 1; x++) {
          const di = rowStart + x * 4;
          const si = rowStart + (x + 1) * 4;
          buf[di] = buf[si];
          buf[di + 1] = buf[si + 1];
          buf[di + 2] = buf[si + 2];
          buf[di + 3] = buf[si + 3];
        }
      }

      curW--;
    }

    // Scale the carved result back to original dimensions using nearest-neighbor
    const dst = out.data;
    if (horizontal) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const sx = Math.floor(x * curW / width);
          const si = (y * srcW + sx) * 4;
          const di = (y * width + x) * 4;
          dst[di] = buf[si];
          dst[di + 1] = buf[si + 1];
          dst[di + 2] = buf[si + 2];
          dst[di + 3] = data[(y * width + x) * 4 + 3];
        }
      }
    } else {
      // Transpose back: in transposed buffer, row=original x, col=original y.
      // Carving removed columns, so scale the column axis (original y → height).
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const scaledCol = Math.floor(y * curW / height);
          const si = (x * srcW + scaledCol) * 4; // row=x, col=scaledCol
          const di = (y * width + x) * 4;
          dst[di] = buf[si];
          dst[di + 1] = buf[si + 1];
          dst[di + 2] = buf[si + 2];
          dst[di + 3] = data[(y * width + x) * 4 + 3];
        }
      }
    }

    return out;
  },
};

export const seamCarveDef: EffectToolDef = {
  effect: seamCarveEffect,
  sliders: [
    { key: 'seams', label: 'Seams', min: 10, max: 200, step: 1, defaultValue: 60, hint: 'How many content seams to carve' },
    { key: 'chaos', label: 'Chaos', min: 0, max: 100, step: 1, defaultValue: 50, hint: 'How wrong the content detection is' },
  ],
  modes: [
    { key: 'mode', modes: ['Broken Energy', 'Random Seams', 'Reverse'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

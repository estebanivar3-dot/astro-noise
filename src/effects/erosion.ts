/**
 * Erosion/Dilate effect — morphological operations via luminance-based
 * pixel selection. Preserves natural colors by always copying whole
 * pixels instead of per-channel min/max.
 *
 * Uses separable passes (horizontal then vertical) for O(r) per pixel,
 * and downsamples to ~500px working resolution for speed. The radius
 * is applied at working resolution, so it automatically covers more
 * of the image — giving a more dramatic effect at larger scales.
 *
 * Modes: Erode (shrink brights), Dilate (grow brights), Open (smooth
 * away bright spots), Close (fill dark gaps), Gradient (edge detect).
 */

import type { PixelEffect, EffectToolDef, EffectConfig } from './types.ts';

/** Max working dimension for morphological processing. */
const MAX_WORK = 500;

// ---------------------------------------------------------------------------
// Separable morphological pass — 1D scan along rows or columns
// ---------------------------------------------------------------------------

function morphPass1D(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
  erode: boolean,
  horizontal: boolean,
): ImageData {
  const out = new ImageData(w, h);
  const dst = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let bestLum = erode ? 766 : -1;
      let bestIdx = (y * w + x) << 2;

      if (horizontal) {
        const lo = x - radius < 0 ? 0 : x - radius;
        const hi = x + radius >= w ? w - 1 : x + radius;
        for (let nx = lo; nx <= hi; nx++) {
          const ni = (y * w + nx) << 2;
          const lum = src[ni] + src[ni + 1] + src[ni + 2];
          if (erode ? lum < bestLum : lum > bestLum) {
            bestLum = lum;
            bestIdx = ni;
          }
        }
      } else {
        const lo = y - radius < 0 ? 0 : y - radius;
        const hi = y + radius >= h ? h - 1 : y + radius;
        for (let ny = lo; ny <= hi; ny++) {
          const ni = (ny * w + x) << 2;
          const lum = src[ni] + src[ni + 1] + src[ni + 2];
          if (erode ? lum < bestLum : lum > bestLum) {
            bestLum = lum;
            bestIdx = ni;
          }
        }
      }

      const i = (y * w + x) << 2;
      dst[i]     = src[bestIdx];
      dst[i + 1] = src[bestIdx + 1];
      dst[i + 2] = src[bestIdx + 2];
      dst[i + 3] = src[i + 3];
    }
  }

  return out;
}

/** Full morphological pass = horizontal + vertical (separable square kernel). */
function morphPass(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
  erode: boolean,
): ImageData {
  const h1 = morphPass1D(src, w, h, radius, erode, true);
  return morphPass1D(h1.data, w, h, radius, erode, false);
}

// ---------------------------------------------------------------------------
// Effect
// ---------------------------------------------------------------------------

const erosionEffect: PixelEffect = {
  id: 'erosion',
  label: 'Erosion',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const radius = (config['radius'] ?? 5) as number;
    const iterations = (config['iterations'] ?? 1) as number;
    const mode = (config['mode'] ?? 0) as number;
    const dirX = (config['directionX'] ?? 0) as number;
    const dirY = (config['directionY'] ?? 0) as number;

    const { width: fullW, height: fullH, data } = source;

    // Drag scales the effective radius
    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    const dragScale = mag > 0 ? 1 + mag * 0.005 : 1;
    const effectiveRadius = Math.max(1, Math.min(25, Math.round(radius * dragScale)));

    // ---- Downsample for performance ----
    const longer = Math.max(fullW, fullH);
    const needsDown = longer > MAX_WORK;
    const ratio = needsDown ? MAX_WORK / longer : 1;
    const w = needsDown ? Math.max(4, Math.round(fullW * ratio)) : fullW;
    const h = needsDown ? Math.max(4, Math.round(fullH * ratio)) : fullH;

    let workData: Uint8ClampedArray;
    if (needsDown) {
      workData = new Uint8ClampedArray(w * h * 4);
      const xR = fullW / w;
      const yR = fullH / h;
      for (let y = 0; y < h; y++) {
        const sy = Math.min(Math.floor(y * yR), fullH - 1);
        for (let x = 0; x < w; x++) {
          const sx = Math.min(Math.floor(x * xR), fullW - 1);
          const si = (sy * fullW + sx) * 4;
          const di = (y * w + x) * 4;
          workData[di] = data[si]; workData[di + 1] = data[si + 1];
          workData[di + 2] = data[si + 2]; workData[di + 3] = data[si + 3];
        }
      }
    } else {
      workData = new Uint8ClampedArray(data.length);
      workData.set(data);
    }

    // Performance cap
    const kernelLen = 2 * effectiveRadius + 1;
    const passMul = (mode === 2 || mode === 3 || mode === 4) ? 2 : 1;
    const budget = 500_000_000;
    const opsPerIter = w * h * 2 * kernelLen * 3 * passMul;
    let effectiveIters = Math.max(1, Math.min(iterations, 8));
    if (opsPerIter * effectiveIters > budget) {
      effectiveIters = Math.max(1, Math.floor(budget / opsPerIter));
    }

    let currentData = workData;

    for (let iter = 0; iter < effectiveIters; iter++) {
      switch (mode) {
        case 0: // Erode
          currentData = morphPass(currentData, w, h, effectiveRadius, true).data;
          break;
        case 1: // Dilate
          currentData = morphPass(currentData, w, h, effectiveRadius, false).data;
          break;
        case 2: // Open (erode → dilate)
          currentData = morphPass(currentData, w, h, effectiveRadius, true).data;
          currentData = morphPass(currentData, w, h, effectiveRadius, false).data;
          break;
        case 3: // Close (dilate → erode)
          currentData = morphPass(currentData, w, h, effectiveRadius, false).data;
          currentData = morphPass(currentData, w, h, effectiveRadius, true).data;
          break;
        case 4: { // Gradient (|dilate - erode| — edge detection)
          const eroded  = morphPass(currentData, w, h, effectiveRadius, true).data;
          const dilated = morphPass(currentData, w, h, effectiveRadius, false).data;
          const gradOut = new ImageData(w, h);
          const gd = gradOut.data;
          const len = w * h * 4;
          for (let i = 0; i < len; i += 4) {
            gd[i]     = Math.abs(dilated[i]     - eroded[i]);
            gd[i + 1] = Math.abs(dilated[i + 1] - eroded[i + 1]);
            gd[i + 2] = Math.abs(dilated[i + 2] - eroded[i + 2]);
            gd[i + 3] = 255;
          }
          currentData = gd;
          break;
        }
      }
    }

    // ---- Upsample to full resolution ----
    const out = new ImageData(fullW, fullH);
    const dst = out.data;

    if (needsDown) {
      for (let y = 0; y < fullH; y++) {
        const fy = (y + 0.5) * h / fullH - 0.5;
        const wy0 = Math.max(0, Math.min(Math.floor(fy), h - 1));
        const wy1 = Math.min(wy0 + 1, h - 1);
        const ty = Math.max(0, fy - wy0);
        const ity = 1 - ty;

        for (let x = 0; x < fullW; x++) {
          const fx = (x + 0.5) * w / fullW - 0.5;
          const wx0 = Math.max(0, Math.min(Math.floor(fx), w - 1));
          const wx1 = Math.min(wx0 + 1, w - 1);
          const tx = Math.max(0, fx - wx0);
          const itx = 1 - tx;

          const i00 = (wy0 * w + wx0) * 4;
          const i10 = (wy0 * w + wx1) * 4;
          const i01 = (wy1 * w + wx0) * 4;
          const i11 = (wy1 * w + wx1) * 4;
          const di = (y * fullW + x) * 4;

          const w00 = itx * ity, w10 = tx * ity, w01 = itx * ty, w11 = tx * ty;
          dst[di]     = currentData[i00]     * w00 + currentData[i10]     * w10 + currentData[i01]     * w01 + currentData[i11]     * w11;
          dst[di + 1] = currentData[i00 + 1] * w00 + currentData[i10 + 1] * w10 + currentData[i01 + 1] * w01 + currentData[i11 + 1] * w11;
          dst[di + 2] = currentData[i00 + 2] * w00 + currentData[i10 + 2] * w10 + currentData[i01 + 2] * w01 + currentData[i11 + 2] * w11;
          dst[di + 3] = data[di + 3];
        }
      }
    } else {
      dst.set(new Uint8ClampedArray(currentData));
    }

    return out;
  },
};

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const erosionDef: EffectToolDef = {
  effect: erosionEffect,
  sliders: [
    { key: 'radius', label: 'Radius', min: 1, max: 50, step: 1, defaultValue: 5, hint: 'Kernel size' },
    { key: 'iterations', label: 'Iterations', min: 1, max: 12, step: 1, defaultValue: 1, hint: 'Number of passes' },
  ],
  modes: [
    { key: 'mode', modes: ['Erode', 'Dilate', 'Open', 'Close', 'Gradient'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

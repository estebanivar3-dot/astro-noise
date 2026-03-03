/**
 * Worley Noise effect — Voronoi-based cellular texture.
 * Creates cracked mud, reptile scale, stained glass, or
 * distance-field patterns.
 *
 * Downsamples to ~600px working resolution for the distance
 * calculations, then bilinear-upsamples the result.
 */

import type { PixelEffect, EffectToolDef, EffectConfig } from './types.ts';

/** Max working dimension. */
const MAX_WORK = 500;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

interface SeedPoint {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
}

/** Deterministic seeded PRNG. */
function createRng(seed: number): () => number {
  let s = ((seed % 2147483647) + 2147483647) % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const worleyEffect: PixelEffect = {
  id: 'worley',
  label: 'Worley',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const cellCount = Math.max(2, Math.round((config['cells'] ?? 40) as number));
    const blend = clamp((config['blend'] ?? 75) as number, 0, 100) / 100;
    const mode = (config['mode'] ?? 0) as number;
    const dirX = (config['directionX'] ?? 0) as number;
    const dirY = (config['directionY'] ?? 0) as number;

    const { width, height, data } = source;

    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    const dragScale = mag > 0 ? 1 + mag * 0.005 : 1;
    const effectiveCells = clamp(Math.round(cellCount * dragScale), 2, 300);

    // ---- Downsample for performance ----
    const longer = Math.max(width, height);
    const needsDown = longer > MAX_WORK;
    const ratio = needsDown ? MAX_WORK / longer : 1;
    const w = needsDown ? Math.max(4, Math.round(width * ratio)) : width;
    const h = needsDown ? Math.max(4, Math.round(height * ratio)) : height;

    // Downsample source pixels
    const workSrc = new Uint8ClampedArray(w * h * 4);
    if (needsDown) {
      const xR = width / w;
      const yR = height / h;
      for (let y = 0; y < h; y++) {
        const sy = Math.min(Math.floor(y * yR), height - 1);
        for (let x = 0; x < w; x++) {
          const sx = Math.min(Math.floor(x * xR), width - 1);
          const si = (sy * width + sx) * 4;
          const di = (y * w + x) * 4;
          workSrc[di] = data[si]; workSrc[di + 1] = data[si + 1];
          workSrc[di + 2] = data[si + 2]; workSrc[di + 3] = data[si + 3];
        }
      }
    } else {
      workSrc.set(data);
    }

    // Generate seed points at working resolution
    const rng = createRng(effectiveCells * 7919);
    const points: SeedPoint[] = [];
    for (let i = 0; i < effectiveCells; i++) {
      const px = Math.floor(rng() * w);
      const py = Math.floor(rng() * h);
      const pi = (py * w + px) * 4;
      points.push({
        x: px, y: py,
        r: workSrc[pi], g: workSrc[pi + 1], b: workSrc[pi + 2],
      });
    }

    // Grid acceleration
    const gridSize = Math.max(1, Math.floor(Math.sqrt(effectiveCells) * 0.7));
    const cellW = w / gridSize;
    const cellH = h / gridSize;
    const grid: number[][] = new Array(gridSize * gridSize);
    for (let i = 0; i < grid.length; i++) grid[i] = [];
    for (let i = 0; i < points.length; i++) {
      const gx = clamp(Math.floor(points[i].x / cellW), 0, gridSize - 1);
      const gy = clamp(Math.floor(points[i].y / cellH), 0, gridSize - 1);
      grid[gy * gridSize + gx].push(i);
    }

    const avgCellDiag = Math.sqrt((w * w + h * h) / effectiveCells);
    const edgeWidth = Math.max(3, avgCellDiag * 0.15);

    // ---- Compute Worley at working resolution ----
    const workDst = new Uint8ClampedArray(w * h * 4);

    for (let y = 0; y < h; y++) {
      const gy = clamp(Math.floor(y / cellH), 0, gridSize - 1);
      for (let x = 0; x < w; x++) {
        const gx = clamp(Math.floor(x / cellW), 0, gridSize - 1);

        let d1sq = Infinity, d2sq = Infinity;
        let nearest = 0;

        for (let cdy = -2; cdy <= 2; cdy++) {
          const ny = gy + cdy;
          if (ny < 0 || ny >= gridSize) continue;
          for (let cdx = -2; cdx <= 2; cdx++) {
            const nx = gx + cdx;
            if (nx < 0 || nx >= gridSize) continue;
            const cell = grid[ny * gridSize + nx];
            for (const pi of cell) {
              const p = points[pi];
              const ddx = x - p.x;
              const ddy = y - p.y;
              const dsq = ddx * ddx + ddy * ddy;
              if (dsq < d1sq) {
                d2sq = d1sq;
                d1sq = dsq;
                nearest = pi;
              } else if (dsq < d2sq) {
                d2sq = dsq;
              }
            }
          }
        }

        const d1 = Math.sqrt(d1sq);
        const d2 = Math.sqrt(d2sq);

        const i = (y * w + x) * 4;
        const srcR = workSrc[i], srcG = workSrc[i + 1], srcB = workSrc[i + 2];
        const np = points[nearest];

        let outR: number, outG: number, outB: number;

        switch (mode) {
          case 0: {
            outR = np.r; outG = np.g; outB = np.b;
            break;
          }
          case 1: {
            const edge = 1 - smoothstep(0, edgeWidth, d2 - d1);
            outR = np.r * (1 - edge);
            outG = np.g * (1 - edge);
            outB = np.b * (1 - edge);
            break;
          }
          case 2: {
            const crack = smoothstep(0, 3, d2 - d1);
            outR = srcR * crack; outG = srcG * crack; outB = srcB * crack;
            break;
          }
          case 3: {
            const intensity = 1 - clamp(d1 / avgCellDiag, 0, 1);
            const boosted = intensity * intensity;
            outR = srcR * boosted; outG = srcG * boosted; outB = srcB * boosted;
            break;
          }
          default: {
            outR = np.r; outG = np.g; outB = np.b;
          }
        }

        workDst[i]     = clamp(Math.round(srcR + (outR - srcR) * blend), 0, 255);
        workDst[i + 1] = clamp(Math.round(srcG + (outG - srcG) * blend), 0, 255);
        workDst[i + 2] = clamp(Math.round(srcB + (outB - srcB) * blend), 0, 255);
        workDst[i + 3] = workSrc[i + 3];
      }
    }

    // ---- Upsample to full resolution ----
    const out = new ImageData(width, height);
    const dst = out.data;

    if (needsDown) {
      for (let y = 0; y < height; y++) {
        const fy = (y + 0.5) * h / height - 0.5;
        const wy0 = Math.max(0, Math.min(Math.floor(fy), h - 1));
        const wy1 = Math.min(wy0 + 1, h - 1);
        const ty = Math.max(0, fy - wy0);
        const ity = 1 - ty;

        for (let x = 0; x < width; x++) {
          const fx = (x + 0.5) * w / width - 0.5;
          const wx0 = Math.max(0, Math.min(Math.floor(fx), w - 1));
          const wx1 = Math.min(wx0 + 1, w - 1);
          const tx = Math.max(0, fx - wx0);
          const itx = 1 - tx;

          const i00 = (wy0 * w + wx0) * 4;
          const i10 = (wy0 * w + wx1) * 4;
          const i01 = (wy1 * w + wx0) * 4;
          const i11 = (wy1 * w + wx1) * 4;
          const di = (y * width + x) * 4;

          const w00 = itx * ity, w10 = tx * ity, w01 = itx * ty, w11 = tx * ty;
          dst[di]     = workDst[i00]     * w00 + workDst[i10]     * w10 + workDst[i01]     * w01 + workDst[i11]     * w11;
          dst[di + 1] = workDst[i00 + 1] * w00 + workDst[i10 + 1] * w10 + workDst[i01 + 1] * w01 + workDst[i11 + 1] * w11;
          dst[di + 2] = workDst[i00 + 2] * w00 + workDst[i10 + 2] * w10 + workDst[i01 + 2] * w01 + workDst[i11 + 2] * w11;
          dst[di + 3] = data[di + 3];
        }
      }
    } else {
      dst.set(workDst);
    }

    return out;
  },
};

export const worleyDef: EffectToolDef = {
  effect: worleyEffect,
  sliders: [
    { key: 'cells', label: 'Cells', min: 2, max: 500, step: 1, defaultValue: 40, hint: 'Number of seed points' },
    { key: 'blend', label: 'Blend', min: 0, max: 100, step: 1, defaultValue: 75, hint: 'Mix with original' },
  ],
  modes: [
    { key: 'mode', modes: ['Cells', 'Edges', 'Cracks', 'Distance'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

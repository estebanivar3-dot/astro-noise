/**
 * Fill — paint-bucket flood fill. Click a region to fill it with a random color.
 * In Full Image mode, all regions are filled at once (drag to control tolerance).
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(val: number): number {
  return val < 0 ? 0 : val > 255 ? 255 : Math.round(val);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = clamp(l * 255);
    return [v, v, v];
  }
  function hue2rgb(p: number, q: number, t: number): number {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    clamp(hue2rgb(p, q, h + 1 / 3) * 255),
    clamp(hue2rgb(p, q, h) * 255),
    clamp(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/** Generate a fill color from PRNG + mode selection + hue anchor. */
function generateColor(mode: number, rand: () => number, hueAnchor: number): [number, number, number] {
  // hueAnchor is 0-360. Variation spreads ±0.15 around the anchor hue.
  const baseHue = ((hueAnchor / 360) + (rand() * 0.3 - 0.15) + 1) % 1;
  switch (mode) {
    case 1: return hslToRgb(baseHue, 0.9 + rand() * 0.1, 0.4 + rand() * 0.2);        // Neon
    case 2: return hslToRgb(baseHue, 0.5 + rand() * 0.2, 0.65 + rand() * 0.13);       // Pastel
    case 3: { const g = clamp(rand() * 255); return [g, g, g]; }                       // Mono
    default: return hslToRgb(baseHue, 0.6 + rand() * 0.4, 0.3 + rand() * 0.4);        // Solid
  }
}

/** Seeded PRNG — deterministic from an integer seed. */
function createRng(s: number): () => number {
  let seed = s;
  return (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/**
 * Segment image into color regions via tolerance-based flood fill.
 */
function segmentImage(data: Uint8ClampedArray, width: number, height: number, tolerance: number): Int32Array {
  const labels = new Int32Array(width * height).fill(-1);
  let nextLabel = 0;
  const stack: number[] = [];

  for (let startIdx = 0; startIdx < width * height; startIdx++) {
    if (labels[startIdx] >= 0) continue;

    const label = nextLabel++;
    labels[startIdx] = label;
    stack.push(startIdx);

    const sr = data[startIdx * 4];
    const sg = data[startIdx * 4 + 1];
    const sb = data[startIdx * 4 + 2];
    const tolSq = tolerance * tolerance;

    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = (idx - x) / width;

      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < width - 1 ? idx + 1 : -1,
        y > 0 ? idx - width : -1,
        y < height - 1 ? idx + width : -1,
      ];

      for (const ni of neighbors) {
        if (ni < 0 || labels[ni] >= 0) continue;
        const pi = ni * 4;
        const dr = data[pi] - sr;
        const dg = data[pi + 1] - sg;
        const db = data[pi + 2] - sb;
        if (dr * dr + dg * dg + db * db <= tolSq) {
          labels[ni] = label;
          stack.push(ni);
        }
      }
    }
  }

  return labels;
}

/**
 * Flood-fill from a single seed point. Returns a Uint8Array mask (1 = in region).
 */
function floodFillFromSeed(
  data: Uint8ClampedArray, width: number, height: number,
  sx: number, sy: number, tolerance: number,
): Uint8Array {
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  const startIdx = sy * width + sx;
  const sr = data[startIdx * 4];
  const sg = data[startIdx * 4 + 1];
  const sb = data[startIdx * 4 + 2];
  const tolSq = tolerance * tolerance;

  visited[startIdx] = 1;
  stack.push(startIdx);

  while (stack.length > 0) {
    const idx = stack.pop()!;
    const x = idx % width;
    const y = (idx - x) / width;

    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < width - 1 ? idx + 1 : -1,
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
    ];

    for (const ni of neighbors) {
      if (ni < 0 || visited[ni]) continue;
      const pi = ni * 4;
      const dr = data[pi] - sr;
      const dg = data[pi + 1] - sg;
      const db = data[pi + 2] - sb;
      if (dr * dr + dg * dg + db * db <= tolSq) {
        visited[ni] = 1;
        stack.push(ni);
      }
    }
  }

  return visited;
}

const fillEffect: PixelEffect = {
  id: 'fill',
  label: 'Fill',
  interactionType: 'point-fill',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const tolerance = config['tolerance'] ?? 30;
    const intensity = (config['intensity'] ?? 100) / 100;
    const range = (config['range'] ?? 100) / 100;
    const hue = config['hue'] ?? 0;
    const mode = config['mode'] ?? 0;
    const seedX = config['seedX'] ?? -1;
    const seedY = config['seedY'] ?? -1;
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    // ── Single-region fill (Interactive click) ──────────────────────
    if (seedX >= 0 && seedY >= 0) {
      const sx = Math.round(seedX);
      const sy = Math.round(seedY);
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        dst.set(data);
        return out;
      }

      const visited = floodFillFromSeed(data, width, height, sx, sy, tolerance);

      // Range filter: compute region avg luminance, compare to image avg.
      // If region is outside the range window, skip the fill.
      let regionLumSum = 0;
      let regionCount = 0;
      let imageLumSum = 0;
      for (let i = 0; i < width * height; i++) {
        const pi = i * 4;
        const lum = data[pi] * 0.299 + data[pi + 1] * 0.587 + data[pi + 2] * 0.114;
        imageLumSum += lum;
        if (visited[i]) {
          regionLumSum += lum;
          regionCount++;
        }
      }
      const imageAvgLum = imageLumSum / (width * height);
      const regionAvgLum = regionCount > 0 ? regionLumSum / regionCount : imageAvgLum;
      const lumDist = Math.abs(regionAvgLum - imageAvgLum) / 255;
      // range=1 → window=1 (everything passes). range=0 → window=0 (nothing passes).
      const inRange = lumDist <= range;

      if (!inRange) {
        dst.set(data);
        return out;
      }

      const rand = createRng(Math.round(tolerance * 31 + intensity * 17 + mode * 113 + hue * 7 + sx * 7 + sy * 13 + 42));
      const [fr, fg, fb] = generateColor(mode, rand, hue);

      for (let i = 0; i < data.length; i += 4) {
        if (visited[i >> 2]) {
          dst[i]     = clamp(data[i]     + (fr - data[i])     * intensity);
          dst[i + 1] = clamp(data[i + 1] + (fg - data[i + 1]) * intensity);
          dst[i + 2] = clamp(data[i + 2] + (fb - data[i + 2]) * intensity);
          dst[i + 3] = data[i + 3];
        } else {
          dst[i]     = data[i];
          dst[i + 1] = data[i + 1];
          dst[i + 2] = data[i + 2];
          dst[i + 3] = data[i + 3];
        }
      }
      return out;
    }

    // Sentinel (-1, -1) after bake — return source unchanged
    if (seedX < 0) {
      if (config['seedX'] !== undefined) {
        dst.set(data);
        return out;
      }
    }

    // ── Full-image fill (all regions) ───────────────────────────────
    const labels = segmentImage(data, width, height, tolerance);

    let maxLabel = 0;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] > maxLabel) maxLabel = labels[i];
    }

    // Compute per-region average luminance + overall image average
    const regionLumSums = new Float64Array(maxLabel + 1);
    const regionCounts = new Uint32Array(maxLabel + 1);
    let totalLumSum = 0;
    for (let i = 0; i < width * height; i++) {
      const pi = i * 4;
      const lum = data[pi] * 0.299 + data[pi + 1] * 0.587 + data[pi + 2] * 0.114;
      totalLumSum += lum;
      const label = labels[i];
      regionLumSums[label] += lum;
      regionCounts[label]++;
    }
    const imageAvgLum = totalLumSum / (width * height);

    // Determine which regions pass the range filter
    const regionPasses = new Uint8Array(maxLabel + 1);
    for (let i = 0; i <= maxLabel; i++) {
      const avg = regionCounts[i] > 0 ? regionLumSums[i] / regionCounts[i] : imageAvgLum;
      const dist = Math.abs(avg - imageAvgLum) / 255;
      regionPasses[i] = dist <= range ? 1 : 0;
    }

    const rand = createRng(Math.round(tolerance * 31 + intensity * 17 + mode * 113 + hue * 7 + 42));

    const regionColors = new Uint8Array((maxLabel + 1) * 3);
    for (let i = 0; i <= maxLabel; i++) {
      const [r, g, b] = generateColor(mode, rand, hue);
      regionColors[i * 3]     = r;
      regionColors[i * 3 + 1] = g;
      regionColors[i * 3 + 2] = b;
    }

    for (let i = 0; i < data.length; i += 4) {
      const px = i / 4;
      const label = labels[px];

      if (!regionPasses[label]) {
        // Outside range — pass through original pixel
        dst[i]     = data[i];
        dst[i + 1] = data[i + 1];
        dst[i + 2] = data[i + 2];
        dst[i + 3] = data[i + 3];
        continue;
      }

      const cr = regionColors[label * 3];
      const cg = regionColors[label * 3 + 1];
      const cb = regionColors[label * 3 + 2];

      dst[i]     = clamp(data[i]     + (cr - data[i])     * intensity);
      dst[i + 1] = clamp(data[i + 1] + (cg - data[i + 1]) * intensity);
      dst[i + 2] = clamp(data[i + 2] + (cb - data[i + 2]) * intensity);
      dst[i + 3] = data[i + 3];
    }

    return out;
  },
};

export const fillDef: EffectToolDef = {
  effect: fillEffect,
  sliders: [
    { key: 'tolerance', label: 'Tolerance', min: 1, max: 100, step: 1, defaultValue: 30, hint: 'How similar colors must be to merge' },
    { key: 'range', label: 'Range', min: 0, max: 100, step: 1, defaultValue: 100, hint: 'Luminance selectivity — lower fills fewer tonal regions' },
    { key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, defaultValue: 100, hint: 'How much fill color overrides the original' },
    { key: 'hue', label: 'Hue', min: 0, max: 360, step: 1, defaultValue: 0, hint: 'Anchor hue for generated fill colors' },
  ],
  modes: [
    { key: 'mode', modes: ['Solid', 'Neon', 'Pastel', 'Monochrome'], defaultIndex: 0 },
  ],
  stackingBrush: true,
  dragMapping: '1d',
};

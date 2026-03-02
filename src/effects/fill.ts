/**
 * Fill — flood-fill segmentation that replaces regions with random solid colors.
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

/**
 * Segment image into color regions via tolerance-based flood fill.
 * Copied from colorize.ts to keep fill self-contained.
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
        if (dr * dr + dg * dg + db * db <= tolerance * tolerance) {
          labels[ni] = label;
          stack.push(ni);
        }
      }
    }
  }

  return labels;
}

const fillEffect: PixelEffect = {
  id: 'fill',
  label: 'Fill',
  interactionType: 'area-paint',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const tolerance = config['tolerance'] ?? 30;
    const opacity = (config['opacity'] ?? 100) / 100;
    const mode = config['mode'] ?? 0;
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    const labels = segmentImage(data, width, height, tolerance);

    let maxLabel = 0;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] > maxLabel) maxLabel = labels[i];
    }

    // Seeded PRNG — deterministic from slider values
    let seed = Math.round(tolerance * 31 + opacity * 17 + mode * 113 + 42);
    function rand(): number {
      seed = (seed * 16807 + 0) % 2147483647;
      return (seed - 1) / 2147483646;
    }

    // Generate one color per region
    const regionColors = new Uint8Array((maxLabel + 1) * 3);
    for (let i = 0; i <= maxLabel; i++) {
      let r: number, g: number, b: number;

      switch (mode) {
        case 1: {
          // Neon — high saturation, medium lightness
          [r, g, b] = hslToRgb(rand(), 0.9 + rand() * 0.1, 0.4 + rand() * 0.2);
          break;
        }
        case 2: {
          // Pastel — low saturation, high lightness
          [r, g, b] = hslToRgb(rand(), 0.2 + rand() * 0.3, 0.75 + rand() * 0.15);
          break;
        }
        case 3: {
          // Monochrome — random grays
          const gray = clamp(rand() * 255);
          r = gray; g = gray; b = gray;
          break;
        }
        default: {
          // Solid — random saturated colors
          [r, g, b] = hslToRgb(rand(), 0.6 + rand() * 0.4, 0.3 + rand() * 0.4);
          break;
        }
      }

      regionColors[i * 3]     = r;
      regionColors[i * 3 + 1] = g;
      regionColors[i * 3 + 2] = b;
    }

    for (let i = 0; i < data.length; i += 4) {
      const px = i / 4;
      const label = labels[px];
      const cr = regionColors[label * 3];
      const cg = regionColors[label * 3 + 1];
      const cb = regionColors[label * 3 + 2];

      dst[i]     = clamp(data[i]     + (cr - data[i])     * opacity);
      dst[i + 1] = clamp(data[i + 1] + (cg - data[i + 1]) * opacity);
      dst[i + 2] = clamp(data[i + 2] + (cb - data[i + 2]) * opacity);
      dst[i + 3] = data[i + 3];
    }

    return out;
  },
};

export const fillDef: EffectToolDef = {
  effect: fillEffect,
  sliders: [
    { key: 'tolerance', label: 'Tolerance', min: 5, max: 80, step: 1, defaultValue: 30, hint: 'How similar colors must be to merge' },
    { key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, defaultValue: 100, hint: 'How opaque the fill color is' },
  ],
  modes: [
    { key: 'mode', modes: ['Solid', 'Neon', 'Pastel', 'Monochrome'], defaultIndex: 0 },
  ],
};

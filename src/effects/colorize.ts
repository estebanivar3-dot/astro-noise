/**
 * Colorize — flood-fill recoloring with random colors.
 * Full image mode recolors all distinct regions.
 * Interactive (directional) mode: drag to shift hue and seed colors.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
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
 * Segment the image into color regions using a simple tolerance-based flood fill.
 * Returns a label map (Int32Array, one label per pixel).
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

const colorizeEffect: PixelEffect = {
  id: 'colorize',
  label: 'Colorize',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const tolerance = config['tolerance'] ?? 30;
    const hueShift = (config['hueShift'] ?? 50) / 100;
    const satShift = ((config['saturation'] ?? 50) - 50) / 50;
    const lumShift = ((config['lightness'] ?? 50) - 50) / 50;
    const dirX = config['directionX'] ?? 0;
    const dirY = config['directionY'] ?? 0;
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    // Use drag to shift hue and vary the random seed
    const dragMag = Math.sqrt(dirX * dirX + dirY * dirY);
    const dragAngle = Math.atan2(dirY, dirX);
    const effectiveHueShift = Math.min(1, hueShift + dragMag * 0.003);

    // Segment image into regions
    const labels = segmentImage(data, width, height, tolerance);

    // Find how many labels we got
    let maxLabel = 0;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] > maxLabel) maxLabel = labels[i];
    }

    // Seeded PRNG for deterministic random colors — drag angle shifts the seed
    let seed = Math.round(effectiveHueShift * 997 + tolerance * 13 + satShift * 71 + lumShift * 37 + Math.abs(dragAngle) * 100);
    function rand(): number {
      seed = (seed * 16807 + 0) % 2147483647;
      return (seed - 1) / 2147483646;
    }

    // Generate a random hue offset per region
    const regionHueOffsets = new Float32Array(maxLabel + 1);
    for (let i = 0; i <= maxLabel; i++) {
      regionHueOffsets[i] = rand() * effectiveHueShift;
    }

    for (let i = 0; i < data.length; i += 4) {
      const px = i / 4;
      const label = labels[px];
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const [h, s, l] = rgbToHsl(r, g, b);
      const newH = (h + regionHueOffsets[label]) % 1;
      const newS = Math.max(0, Math.min(1, s + satShift));
      const newL = Math.max(0, Math.min(1, l + lumShift));
      const [nr, ng, nb] = hslToRgb(newH, newS, newL);

      dst[i] = nr;
      dst[i + 1] = ng;
      dst[i + 2] = nb;
      dst[i + 3] = data[i + 3];
    }

    return out;
  },
};

export const colorizeDef: EffectToolDef = {
  effect: colorizeEffect,
  sliders: [
    { key: 'tolerance', label: 'Tolerance', min: 5, max: 80, step: 1, defaultValue: 30, hint: 'How similar colors must be to merge into one region' },
    { key: 'hueShift', label: 'Hue Shift', min: 0, max: 100, step: 1, defaultValue: 50, hint: 'How much to randomly shift each region\u2019s hue' },
    { key: 'saturation', label: 'Saturation', min: 0, max: 100, step: 1, defaultValue: 50, hint: 'Shift saturation (50 = no change)' },
    { key: 'lightness', label: 'Lightness', min: 0, max: 100, step: 1, defaultValue: 50, hint: 'Shift lightness (50 = no change)' },
  ],
  dragMapping: '2d',
};

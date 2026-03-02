/**
 * Gradient Map — maps pixel luminance to a color gradient.
 * Like Photoshop's gradient map: dark pixels get one color, bright pixels get another.
 * In interactive/directional mode, dragging shifts the gradient colors randomly.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

interface ColorStop {
  r: number;
  g: number;
  b: number;
}

function hslToRgb(h: number, s: number, l: number): ColorStop {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
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
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function generateGradientStops(seed: number, numStops: number): ColorStop[] {
  let s = ((seed % 2147483647) + 2147483647) % 2147483647 || 1;
  function rand(): number {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  }

  const stops: ColorStop[] = [];
  for (let i = 0; i < numStops; i++) {
    const h = rand();
    const sat = 0.5 + rand() * 0.5;
    const l = (i / (numStops - 1));
    stops.push(hslToRgb(h, sat, l * 0.7 + 0.15));
  }
  return stops;
}

function lerpColor(a: ColorStop, b: ColorStop, t: number): ColorStop {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function sampleGradient(stops: ColorStop[], t: number): ColorStop {
  if (t <= 0) return stops[0];
  if (t >= 1) return stops[stops.length - 1];
  const segment = t * (stops.length - 1);
  const idx = Math.floor(segment);
  const frac = segment - idx;
  return lerpColor(stops[idx], stops[Math.min(idx + 1, stops.length - 1)], frac);
}

const gradientEffect: PixelEffect = {
  id: 'gradient',
  label: 'Gradient',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const intensity = (config['intensity'] ?? 80) / 100;
    const colorSeed = Math.round(config['colorSeed'] ?? 42);
    const numStops = Math.max(2, Math.round(config['stops'] ?? 4));
    const dirX = config['directionX'] ?? 0;
    const dirY = config['directionY'] ?? 0;

    // Use drag direction to shift the seed for interactive randomization
    const dragMag = Math.sqrt(dirX * dirX + dirY * dirY);
    const effectiveSeed = colorSeed + Math.round(dragMag * 0.1);

    const stops = generateGradientStops(effectiveSeed, numStops);
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Luminance
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

      const mapped = sampleGradient(stops, lum);

      dst[i]     = clamp(r + (mapped.r - r) * intensity);
      dst[i + 1] = clamp(g + (mapped.g - g) * intensity);
      dst[i + 2] = clamp(b + (mapped.b - b) * intensity);
      dst[i + 3] = data[i + 3];
    }

    return out;
  },
};

export const gradientDef: EffectToolDef = {
  effect: gradientEffect,
  sliders: [
    { key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, defaultValue: 80, hint: 'Blend between original and mapped colors' },
    { key: 'colorSeed', label: 'Color Seed', min: 1, max: 999, step: 1, defaultValue: 42, hint: 'Change to get different color palettes' },
    { key: 'stops', label: 'Color Stops', min: 2, max: 8, step: 1, defaultValue: 4, hint: 'Number of colors in the gradient' },
  ],
  dragMapping: '2d',
};

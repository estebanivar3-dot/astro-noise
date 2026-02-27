/**
 * Gradient — maps a color gradient across the image via blend modes.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

const gradientEffect: PixelEffect = {
  id: 'gradient',
  label: 'Gradient',
  interactionType: 'none',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const angle = ((config['angle'] ?? 0) * Math.PI) / 180;
    const blendMode = config['blendMode'] ?? 0;
    const intensity = (config['intensity'] ?? 70) / 100;
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    const colA = { r: 255, g: 100, b: 0 };
    const colB = { r: 0, g: 80, b: 255 };

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        const dx = x - cx;
        const dy = y - cy;
        const proj = (dx * cosA + dy * sinA) / maxDist;
        const t = (proj + 1) / 2;

        const gr = colA.r + (colB.r - colA.r) * t;
        const gg = colA.g + (colB.g - colA.g) * t;
        const gb = colA.b + (colB.b - colA.b) * t;

        const sr = data[i];
        const sg = data[i + 1];
        const sb = data[i + 2];

        let br: number, bg: number, bb: number;

        switch (blendMode) {
          case 1:
            br = (sr * gr) / 255;
            bg = (sg * gg) / 255;
            bb = (sb * gb) / 255;
            break;
          case 2:
            br = 255 - ((255 - sr) * (255 - gr)) / 255;
            bg = 255 - ((255 - sg) * (255 - gg)) / 255;
            bb = 255 - ((255 - sb) * (255 - gb)) / 255;
            break;
          case 3: {
            const lum = 0.299 * sr + 0.587 * sg + 0.114 * sb;
            const gLum = 0.299 * gr + 0.587 * gg + 0.114 * gb;
            const ratio = gLum > 0 ? lum / gLum : 1;
            br = gr * ratio;
            bg = gg * ratio;
            bb = gb * ratio;
            break;
          }
          default:
            br = sr < 128 ? (2 * sr * gr) / 255 : 255 - (2 * (255 - sr) * (255 - gr)) / 255;
            bg = sg < 128 ? (2 * sg * gg) / 255 : 255 - (2 * (255 - sg) * (255 - gg)) / 255;
            bb = sb < 128 ? (2 * sb * gb) / 255 : 255 - (2 * (255 - sb) * (255 - gb)) / 255;
            break;
        }

        dst[i]     = clamp(sr + (br - sr) * intensity);
        dst[i + 1] = clamp(sg + (bg - sg) * intensity);
        dst[i + 2] = clamp(sb + (bb - sb) * intensity);
        dst[i + 3] = data[i + 3];
      }
    }

    return out;
  },
};

export const gradientDef: EffectToolDef = {
  effect: gradientEffect,
  sliders: [
    { key: 'angle', label: 'Angle', min: 0, max: 360, step: 5, defaultValue: 45, hint: 'Gradient direction in degrees' },
    { key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, defaultValue: 70, hint: 'How strongly the gradient blends' },
  ],
  modes: [
    { key: 'blendMode', modes: ['Overlay', 'Multiply', 'Screen', 'Color'], defaultIndex: 0 },
  ],
  supportsInteractive: false,
};

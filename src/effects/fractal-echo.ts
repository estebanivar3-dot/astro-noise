/**
 * Fractal Echo — composites the image at decreasing scales,
 * creating recursive zoom tunnel / mandala / kaleidoscope effects.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

const fractalEchoEffect: PixelEffect = {
  id: 'fractal-echo',
  label: 'Fractal Echo',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const echoCount = Math.round(config['echoes'] ?? 4);
    const scalePct = (config['scale'] ?? 80) / 100;
    const opacityBase = (config['opacity'] ?? 70) / 100;
    const mode = config['mode'] ?? 0;
    const dirX = config['directionX'] ?? 0;
    const dirY = config['directionY'] ?? 0;

    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    // Start with source as base
    dst.set(data);

    // Drag shifts the echo center
    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    const spreadX = mag > 0 ? (dirX / mag) * mag * 0.05 : 0;
    const spreadY = mag > 0 ? (dirY / mag) * mag * 0.05 : 0;

    const cx = width / 2;
    const cy = height / 2;

    // Blend echoes from farthest (faintest) to nearest
    for (let e = echoCount; e >= 1; e--) {
      const echoOpacity = Math.pow(opacityBase, e);

      // Determine scale for this echo
      let echoScale: number;
      switch (mode) {
        case 1:
          // Outward — echoes zoom out (explosion)
          echoScale = 1 / Math.pow(scalePct, e);
          break;
        case 2:
          // Mirror — alternating in/out
          echoScale = e % 2 === 0
            ? Math.pow(scalePct, e)
            : 1 / Math.pow(scalePct, e);
          break;
        default:
          // Inward — echoes zoom in (tunnel)
          echoScale = Math.pow(scalePct, e);
          break;
      }

      // Echo center shifts with drag direction
      const echoCx = cx + spreadX * e;
      const echoCy = cy + spreadY * e;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;

          // Map output pixel to source via echo scale
          const sx = Math.round(echoCx + (x - echoCx) / echoScale);
          const sy = Math.round(echoCy + (y - echoCy) / echoScale);

          // Skip if out of bounds
          if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;

          const si = (sy * width + sx) * 4;
          const inv = 1 - echoOpacity;

          dst[i]     = dst[i]     * inv + data[si]     * echoOpacity;
          dst[i + 1] = dst[i + 1] * inv + data[si + 1] * echoOpacity;
          dst[i + 2] = dst[i + 2] * inv + data[si + 2] * echoOpacity;
        }
      }
    }

    return out;
  },
};

export const fractalEchoDef: EffectToolDef = {
  effect: fractalEchoEffect,
  sliders: [
    { key: 'echoes', label: 'Echoes', min: 2, max: 10, step: 1, defaultValue: 4, hint: 'How many recursive copies' },
    { key: 'scale', label: 'Scale', min: 50, max: 95, step: 1, defaultValue: 80, hint: 'Size ratio between echoes' },
    { key: 'opacity', label: 'Opacity', min: 20, max: 100, step: 1, defaultValue: 70, hint: 'How quickly echoes fade' },
  ],
  modes: [
    { key: 'mode', modes: ['Inward', 'Outward', 'Mirror'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

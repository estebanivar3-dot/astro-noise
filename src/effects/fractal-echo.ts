/**
 * Fractal Echo — composites the image at decreasing scales,
 * creating recursive zoom tunnel / mandala / kaleidoscope effects.
 *
 * Downsamples to ~600px working resolution so echo compositing
 * doesn't process millions of pixels per echo layer.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

const MAX_WORK = 600;

interface EchoParams {
  invScale: number;
  opacity: number;
  cx: number;
  cy: number;
}

const fractalEchoEffect: PixelEffect = {
  id: 'fractal-echo',
  label: 'Fractal Echo',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const scalePct = (config['scale'] ?? 75) as number / 100;
    const opacityBase = (config['opacity'] ?? 70) as number / 100;
    const mode = (config['mode'] ?? 0) as number;
    const dirX = (config['directionX'] ?? 0) as number;
    const dirY = (config['directionY'] ?? 0) as number;

    const { width, height, data } = source;

    // ---- Downsample for performance ----
    const longer = Math.max(width, height);
    const needsDown = longer > MAX_WORK;
    const ratio = needsDown ? MAX_WORK / longer : 1;
    const w = needsDown ? Math.max(4, Math.round(width * ratio)) : width;
    const h = needsDown ? Math.max(4, Math.round(height * ratio)) : height;

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

    const echoCount = Math.max(1, Math.min(25, Math.round((config['echoes'] ?? 6) as number)));

    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    const spreadX = mag > 0 ? (dirX / longer) * w * 0.15 : 0;
    const spreadY = mag > 0 ? (dirY / longer) * h * 0.15 : 0;

    const cx = w / 2;
    const cy = h / 2;

    // Pre-compute echo parameters
    const echoes: EchoParams[] = [];
    const step = 1 - scalePct;

    for (let e = echoCount; e >= 1; e--) {
      const echoOpacity = opacityBase / (1 + (1 - opacityBase) * e);
      if (echoOpacity < 0.02) continue;

      let echoScale: number;
      switch (mode) {
        case 1: echoScale = 1 + step * e * 1.3; break;
        case 2: echoScale = e % 2 === 0 ? 1 - step * e * 0.5 : 1 + step * e * 0.65; break;
        default: echoScale = 1 - step * e * 0.5; break;
      }
      if (echoScale <= 0.02) continue;

      echoes.push({
        invScale: 1 / echoScale,
        opacity: echoOpacity,
        cx: cx + spreadX * e,
        cy: cy + spreadY * e,
      });
    }

    // Process at working resolution
    const workDst = new Uint8ClampedArray(w * h * 4);
    const echoLen = echoes.length;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let r = workSrc[i], g = workSrc[i + 1], b = workSrc[i + 2];

        for (let ei = 0; ei < echoLen; ei++) {
          const ep = echoes[ei];
          let sx = Math.round(ep.cx + (x - ep.cx) * ep.invScale);
          let sy = Math.round(ep.cy + (y - ep.cy) * ep.invScale);
          sx = ((sx % w) + w) % w;
          sy = ((sy % h) + h) % h;

          const si = (sy * w + sx) * 4;
          const inv = 1 - ep.opacity;
          r = r * inv + workSrc[si] * ep.opacity;
          g = g * inv + workSrc[si + 1] * ep.opacity;
          b = b * inv + workSrc[si + 2] * ep.opacity;
        }

        workDst[i]     = r;
        workDst[i + 1] = g;
        workDst[i + 2] = b;
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

export const fractalEchoDef: EffectToolDef = {
  effect: fractalEchoEffect,
  sliders: [
    { key: 'echoes', label: 'Echoes', min: 2, max: 25, step: 1, defaultValue: 6, hint: 'How many recursive copies' },
    { key: 'scale', label: 'Scale', min: 10, max: 98, step: 1, defaultValue: 75, hint: 'Size ratio between echoes' },
    { key: 'opacity', label: 'Opacity', min: 5, max: 100, step: 1, defaultValue: 70, hint: 'How quickly echoes fade', noIntensityMap: true },
  ],
  modes: [
    { key: 'mode', modes: ['Inward', 'Outward', 'Mirror'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

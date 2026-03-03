/**
 * Feedback Loop — iteratively applies transforms, feeding output back as input.
 * Creates recursive zoom tunnels, rotational spirals, and drifting color echoes.
 *
 * Downsamples to a working resolution (~600px) for processing, then
 * bilinear-upsamples the result. The recursive structure is global
 * so downsampling preserves the visual character.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

/** Max dimension for the feedback processing. */
const MAX_FEEDBACK = 600;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

const feedbackEffect: PixelEffect = {
  id: 'feedback-loop',
  label: 'Feedback Loop',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const zoom = (config['zoom'] ?? 2) as number;
    const blend = ((config['blend'] ?? 60) as number) / 100;
    const mode = (config['mode'] ?? 0) as number;
    const dirX = (config['directionX'] ?? 0) as number;
    const dirY = (config['directionY'] ?? 0) as number;
    const iterations = Math.max(1, Math.min(15,
      Math.round((config['iterations'] ?? 5) as number),
    ));

    const { width, height, data } = source;

    // ---- Downsample for performance ----
    const longer = Math.max(width, height);
    const needsDown = longer > MAX_FEEDBACK;
    const ratio = needsDown ? MAX_FEEDBACK / longer : 1;
    const wW = needsDown ? Math.max(4, Math.round(width * ratio)) : width;
    const wH = needsDown ? Math.max(4, Math.round(height * ratio)) : height;

    const workLen = wW * wH * 4;
    let working = new Uint8ClampedArray(workLen);
    let scratch = new Uint8ClampedArray(workLen);

    if (needsDown) {
      const xR = width / wW;
      const yR = height / wH;
      for (let y = 0; y < wH; y++) {
        const sy = Math.min(Math.floor(y * yR), height - 1);
        for (let x = 0; x < wW; x++) {
          const sx = Math.min(Math.floor(x * xR), width - 1);
          const si = (sy * width + sx) * 4;
          const di = (y * wW + x) * 4;
          working[di] = data[si]; working[di + 1] = data[si + 1];
          working[di + 2] = data[si + 2]; working[di + 3] = 255;
        }
      }
    } else {
      working.set(data);
    }

    // Drag
    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    const dragBoost = mag > 1 ? 1 + Math.log1p(mag * 0.02) : 1;
    let dx = 0, dy = 0;
    if (mag > 1) { dx = dirX / mag; dy = dirY / mag; }

    const cx = wW / 2;
    const cy = wH / 2;
    const stepZoom = zoom / 100 * dragBoost;
    const inv = 1 - blend;

    // ---- Feedback iterations at working resolution ----
    for (let iter = 0; iter < iterations; iter++) {
      const zoomFactor = 1 + stepZoom;
      const rotAngle = mode === 1
        ? (1 + Math.abs(zoom) * 2) * (Math.PI / 180) * dragBoost
        : 0;
      const drift = mode === 2 ? 6 * dragBoost : 0;
      const cosA = Math.cos(rotAngle);
      const sinA = Math.sin(rotAngle);

      // Hue rotation constants (Drift mode)
      let cosH = 1, c1 = 0, s1 = 0;
      if (mode === 2 && mag > 1) {
        const hueShift = 0.02 * dragBoost;
        cosH = Math.cos(hueShift);
        const sinH = Math.sin(hueShift);
        c1 = 0.333 * (1 - cosH);
        s1 = 0.577 * sinH;
      }

      for (let y = 0; y < wH; y++) {
        for (let x = 0; x < wW; x++) {
          const i = (y * wW + x) * 4;
          let sx: number, sy: number;

          switch (mode) {
            case 1: {
              const relX = x - cx;
              const relY = y - cy;
              sx = cx + (relX * cosA - relY * sinA) / zoomFactor;
              sy = cy + (relX * sinA + relY * cosA) / zoomFactor;
              break;
            }
            case 2: {
              sx = x - drift * dx;
              sy = y - drift * dy;
              break;
            }
            default: {
              const zCx = cx + dx * 12 * dragBoost;
              const zCy = cy + dy * 12 * dragBoost;
              sx = zCx + (x - zCx) / zoomFactor;
              sy = zCy + (y - zCy) / zoomFactor;
              break;
            }
          }

          const sxi = clamp(Math.round(sx), 0, wW - 1);
          const syi = clamp(Math.round(sy), 0, wH - 1);
          const si = (syi * wW + sxi) * 4;

          let sr = working[si];
          let sg = working[si + 1];
          let sb = working[si + 2];

          if (mode === 2 && mag > 1) {
            const rr = sr * (cosH + c1) + sg * (c1 - s1) + sb * (c1 + s1);
            const gg = sr * (c1 + s1) + sg * (cosH + c1) + sb * (c1 - s1);
            const bb = sr * (c1 - s1) + sg * (c1 + s1) + sb * (cosH + c1);
            sr = clamp(Math.round(rr), 0, 255);
            sg = clamp(Math.round(gg), 0, 255);
            sb = clamp(Math.round(bb), 0, 255);
          }

          scratch[i]     = working[i] * inv + sr * blend;
          scratch[i + 1] = working[i + 1] * inv + sg * blend;
          scratch[i + 2] = working[i + 2] * inv + sb * blend;
          scratch[i + 3] = 255;
        }
      }

      const tmp = working;
      working = scratch;
      scratch = tmp;
    }

    // ---- Upsample result to full resolution ----
    const out = new ImageData(width, height);
    const dst = out.data;

    if (needsDown) {
      for (let y = 0; y < height; y++) {
        const fy = (y + 0.5) * wH / height - 0.5;
        const wy0 = Math.max(0, Math.min(Math.floor(fy), wH - 1));
        const wy1 = Math.min(wy0 + 1, wH - 1);
        const ty = Math.max(0, fy - wy0);
        const ity = 1 - ty;

        for (let x = 0; x < width; x++) {
          const fx = (x + 0.5) * wW / width - 0.5;
          const wx0 = Math.max(0, Math.min(Math.floor(fx), wW - 1));
          const wx1 = Math.min(wx0 + 1, wW - 1);
          const tx = Math.max(0, fx - wx0);
          const itx = 1 - tx;

          const i00 = (wy0 * wW + wx0) * 4;
          const i10 = (wy0 * wW + wx1) * 4;
          const i01 = (wy1 * wW + wx0) * 4;
          const i11 = (wy1 * wW + wx1) * 4;
          const di = (y * width + x) * 4;

          const w00 = itx * ity, w10 = tx * ity, w01 = itx * ty, w11 = tx * ty;
          dst[di]     = working[i00]     * w00 + working[i10]     * w10 + working[i01]     * w01 + working[i11]     * w11;
          dst[di + 1] = working[i00 + 1] * w00 + working[i10 + 1] * w10 + working[i01 + 1] * w01 + working[i11 + 1] * w11;
          dst[di + 2] = working[i00 + 2] * w00 + working[i10 + 2] * w10 + working[i01 + 2] * w01 + working[i11 + 2] * w11;
          dst[di + 3] = data[di + 3];
        }
      }
    } else {
      dst.set(working);
    }

    return out;
  },
};

export const feedbackDef: EffectToolDef = {
  effect: feedbackEffect,
  sliders: [
    { key: 'iterations', label: 'Iterations', min: 1, max: 25, step: 1, defaultValue: 5, hint: 'Feedback passes' },
    { key: 'zoom', label: 'Zoom', min: -15, max: 15, step: 1, defaultValue: 2, hint: 'Zoom per pass' },
    { key: 'blend', label: 'Blend', min: 10, max: 100, step: 5, defaultValue: 60, hint: 'Pass opacity' },
  ],
  modes: [
    { key: 'mode', modes: ['Zoom', 'Rotate', 'Drift'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

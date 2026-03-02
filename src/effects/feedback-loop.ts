/**
 * Feedback Loop — iteratively applies transforms, feeding output back as input.
 * Creates recursive zoom tunnels, rotational spirals, and drifting color echoes.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

const feedbackEffect: PixelEffect = {
  id: 'feedback-loop',
  label: 'Feedback Loop',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const iterations = Math.round(config['iterations'] ?? 5);
    const zoomVal = (config['zoom'] ?? 3) / 100;
    const blend = (config['blend'] ?? 70) / 100;
    const mode = config['mode'] ?? 0;
    const dirX = config['directionX'] ?? 0;
    const dirY = config['directionY'] ?? 0;

    const { width, height, data } = source;

    // Drag direction + distance
    let dx = dirX;
    let dy = dirY;
    const mag = Math.sqrt(dx * dx + dy * dy);
    const dragScale = mag > 0 ? 1 + mag * 0.005 : 1;
    if (mag > 0) {
      dx = dx / mag;
      dy = dy / mag;
    } else {
      dx = 0;
      dy = -1;
    }

    const cx = width / 2;
    const cy = height / 2;

    // Working buffers: read from one, write to the other
    let working = new Uint8ClampedArray(data);
    let scratch = new Uint8ClampedArray(data.length);

    for (let iter = 0; iter < iterations; iter++) {
      const zoomFactor = Math.max(0.01, 1 + zoomVal * dragScale);
      // Rotation angle per iteration (only for Rotate mode)
      const rotAngle = mode === 1 ? (5 + zoomVal * 50) * Math.PI / 180 * dragScale : 0;
      // Drift offset per iteration (only for Drift mode)
      const driftX = mode === 2 ? dx * 8 * dragScale : 0;
      const driftY = mode === 2 ? dy * 8 * dragScale : 0;

      const cosA = Math.cos(rotAngle);
      const sinA = Math.sin(rotAngle);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          let sx: number, sy: number;

          switch (mode) {
            case 1: {
              // Rotate — rotation around center + slight zoom
              const relX = x - cx;
              const relY = y - cy;
              sx = cx + (relX * cosA - relY * sinA) / zoomFactor;
              sy = cy + (relX * sinA + relY * cosA) / zoomFactor;
              break;
            }
            case 2: {
              // Drift — shift in drag direction + hue drift
              sx = x - driftX;
              sy = y - driftY;
              break;
            }
            default: {
              // Zoom — pure zoom toward drag-offset center
              const zCx = cx + dx * 20 * dragScale;
              const zCy = cy + dy * 20 * dragScale;
              sx = zCx + (x - zCx) / zoomFactor;
              sy = zCy + (y - zCy) / zoomFactor;
              break;
            }
          }

          const sxi = clamp(Math.round(sx), 0, width - 1);
          const syi = clamp(Math.round(sy), 0, height - 1);
          const si = (syi * width + sxi) * 4;

          // Sample from working buffer and blend
          const inv = 1 - blend;
          let sr = working[si];
          let sg = working[si + 1];
          let sb = working[si + 2];

          // Drift mode: apply subtle hue rotation per iteration
          if (mode === 2) {
            const hueShift = 0.05 * dragScale;
            const cosH = Math.cos(hueShift);
            const sinH = Math.sin(hueShift);
            const rr = sr * (cosH + 0.333 * (1 - cosH)) + sg * (0.333 * (1 - cosH) - 0.577 * sinH) + sb * (0.333 * (1 - cosH) + 0.577 * sinH);
            const gg = sr * (0.333 * (1 - cosH) + 0.577 * sinH) + sg * (cosH + 0.333 * (1 - cosH)) + sb * (0.333 * (1 - cosH) - 0.577 * sinH);
            const bb = sr * (0.333 * (1 - cosH) - 0.577 * sinH) + sg * (0.333 * (1 - cosH) + 0.577 * sinH) + sb * (cosH + 0.333 * (1 - cosH));
            sr = clamp(Math.round(rr), 0, 255);
            sg = clamp(Math.round(gg), 0, 255);
            sb = clamp(Math.round(bb), 0, 255);
          }

          scratch[i]     = working[i] * inv + sr * blend;
          scratch[i + 1] = working[i + 1] * inv + sg * blend;
          scratch[i + 2] = working[i + 2] * inv + sb * blend;
          scratch[i + 3] = data[i + 3];
        }
      }

      // Swap buffers
      const tmp = working;
      working = scratch;
      scratch = tmp;
    }

    const out = new ImageData(width, height);
    out.data.set(working);
    return out;
  },
};

export const feedbackDef: EffectToolDef = {
  effect: feedbackEffect,
  sliders: [
    { key: 'iterations', label: 'Iterations', min: 1, max: 20, step: 1, defaultValue: 5, hint: 'How many times to feed back' },
    { key: 'zoom', label: 'Zoom', min: -20, max: 20, step: 1, defaultValue: 3, hint: 'Zoom in/out each pass' },
    { key: 'blend', label: 'Blend', min: 10, max: 100, step: 1, defaultValue: 70, hint: 'How much each pass shows through' },
  ],
  modes: [
    { key: 'mode', modes: ['Zoom', 'Rotate', 'Drift'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

/**
 * Dither — reduces image to a limited color palette using
 * Floyd-Steinberg error diffusion, ordered (Bayer) dithering, or halftone dots.
 *
 * The Strength slider (drag-bound to X) blends smoothly between the
 * original and the dithered result — this is what the cursor controls,
 * not the stepped Levels slider.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Quantize a value (0-255) to the nearest level.
 */
function quantize(value: number, levels: number): number {
  const step = 255 / (levels - 1);
  return Math.round(Math.round(value / step) * step);
}

/**
 * 8x8 Bayer threshold matrix (values 0-63).
 */
const BAYER_8X8 = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

const ditherEffect: PixelEffect = {
  id: 'dither',
  label: 'Dither',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const levels = Math.round(clamp(config['levels'] ?? 4, 2, 16));
    const scale = Math.round(clamp(config['scale'] ?? 4, 1, 16));
    const mode = config['mode'] ?? 0;
    const strength = clamp((config['strength'] ?? 50) as number, 0, 100) / 100;

    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    if (mode === 0 && scale > 1) {
      // Floyd-Steinberg with scale: downsample → dither → upsample (chunky pixel blocks)
      const sw = Math.max(1, Math.ceil(width / scale));
      const sh = Math.max(1, Math.ceil(height / scale));
      const smallSrc = new Uint8ClampedArray(sw * sh * 4);
      // Downsample with area-averaging
      for (let sy = 0; sy < sh; sy++) {
        for (let sx = 0; sx < sw; sx++) {
          let rr = 0, gg = 0, bb = 0, aa = 0, count = 0;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const ox = sx * scale + dx;
              const oy = sy * scale + dy;
              if (ox < width && oy < height) {
                const si = (oy * width + ox) * 4;
                rr += data[si]; gg += data[si + 1]; bb += data[si + 2]; aa += data[si + 3];
                count++;
              }
            }
          }
          const di = (sy * sw + sx) * 4;
          smallSrc[di] = rr / count; smallSrc[di + 1] = gg / count;
          smallSrc[di + 2] = bb / count; smallSrc[di + 3] = aa / count;
        }
      }
      const smallDst = new Uint8ClampedArray(sw * sh * 4);
      floydSteinberg(smallSrc, smallDst, sw, sh, levels);
      // Upsample (nearest neighbor)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const sx = Math.min(Math.floor(x / scale), sw - 1);
          const sy = Math.min(Math.floor(y / scale), sh - 1);
          const si = (sy * sw + sx) * 4;
          const di = (y * width + x) * 4;
          dst[di] = smallDst[si]; dst[di + 1] = smallDst[si + 1];
          dst[di + 2] = smallDst[si + 2]; dst[di + 3] = smallDst[si + 3];
        }
      }
    } else {
      switch (mode) {
        case 0:
          floydSteinberg(data, dst, width, height, levels);
          break;
        case 1:
          orderedDither(data, dst, width, height, levels, scale);
          break;
        case 2:
          halftone(data, dst, width, height, levels, scale);
          break;
      }
    }

    // Blend dithered result with original using strength
    if (strength < 1) {
      const inv = 1 - strength;
      for (let i = 0; i < width * height * 4; i += 4) {
        dst[i]     = Math.round(data[i] * inv + dst[i] * strength);
        dst[i + 1] = Math.round(data[i + 1] * inv + dst[i + 1] * strength);
        dst[i + 2] = Math.round(data[i + 2] * inv + dst[i + 2] * strength);
      }
    }

    return out;
  },
};

// ---------------------------------------------------------------------------
// Floyd-Steinberg error diffusion
// ---------------------------------------------------------------------------

function floydSteinberg(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  levels: number,
): void {
  // Work on float buffers for error accumulation
  const r = new Float32Array(width * height);
  const g = new Float32Array(width * height);
  const b = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    r[i] = src[i * 4];
    g[i] = src[i * 4 + 1];
    b[i] = src[i * 4 + 2];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      const oldR = r[idx];
      const oldG = g[idx];
      const oldB = b[idx];

      const newR = quantize(clamp(Math.round(oldR), 0, 255), levels);
      const newG = quantize(clamp(Math.round(oldG), 0, 255), levels);
      const newB = quantize(clamp(Math.round(oldB), 0, 255), levels);

      const di = idx * 4;
      dst[di] = newR;
      dst[di + 1] = newG;
      dst[di + 2] = newB;
      dst[di + 3] = src[di + 3];

      const errR = oldR - newR;
      const errG = oldG - newG;
      const errB = oldB - newB;

      // Distribute error to neighbors
      if (x + 1 < width) {
        const ni = idx + 1;
        r[ni] += errR * 7 / 16;
        g[ni] += errG * 7 / 16;
        b[ni] += errB * 7 / 16;
      }
      if (y + 1 < height) {
        if (x > 0) {
          const ni = idx + width - 1;
          r[ni] += errR * 3 / 16;
          g[ni] += errG * 3 / 16;
          b[ni] += errB * 3 / 16;
        }
        {
          const ni = idx + width;
          r[ni] += errR * 5 / 16;
          g[ni] += errG * 5 / 16;
          b[ni] += errB * 5 / 16;
        }
        if (x + 1 < width) {
          const ni = idx + width + 1;
          r[ni] += errR * 1 / 16;
          g[ni] += errG * 1 / 16;
          b[ni] += errB * 1 / 16;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ordered (Bayer) dithering
// ---------------------------------------------------------------------------

function orderedDither(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  levels: number,
  scale: number,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // Sample the Bayer matrix with scaling
      const bx = Math.floor((x / scale) % 8);
      const by = Math.floor((y / scale) % 8);
      const threshold = BAYER_8X8[by * 8 + bx] / 64 - 0.5;

      const spread = 255 / levels;

      dst[i]     = quantize(clamp(Math.round(src[i]     + threshold * spread), 0, 255), levels);
      dst[i + 1] = quantize(clamp(Math.round(src[i + 1] + threshold * spread), 0, 255), levels);
      dst[i + 2] = quantize(clamp(Math.round(src[i + 2] + threshold * spread), 0, 255), levels);
      dst[i + 3] = src[i + 3];
    }
  }
}

// ---------------------------------------------------------------------------
// Halftone (CMYK-style dot pattern)
// ---------------------------------------------------------------------------

function halftone(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  levels: number,
  scale: number,
): void {
  const spacing = scale * 4;

  // CMYK dot grid angles (degrees)
  const angles = [15, 75, 0, 45]; // C, M, Y, K
  const cosA = angles.map((a) => Math.cos(a * Math.PI / 180));
  const sinA = angles.map((a) => Math.sin(a * Math.PI / 180));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = src[i];
      const g = src[i + 1];
      const b = src[i + 2];

      // Convert RGB to CMY (simplified, no K separation for visual effect)
      const channels = [255 - r, 255 - g, 255 - b, (255 - Math.max(r, g, b))];

      let outR = 255, outG = 255, outB = 255;

      for (let ch = 0; ch < 4; ch++) {
        // Rotate coordinates for this channel's angle
        const rx = x * cosA[ch] + y * sinA[ch];
        const ry = -x * sinA[ch] + y * cosA[ch];

        // Distance from nearest dot center
        const dotCx = (rx % spacing + spacing) % spacing - spacing / 2;
        const dotCy = (ry % spacing + spacing) % spacing - spacing / 2;
        const dist = Math.sqrt(dotCx * dotCx + dotCy * dotCy);

        // Dot radius proportional to ink density
        const density = channels[ch] / 255;
        const maxRadius = spacing * 0.5;
        const dotRadius = maxRadius * Math.sqrt(density);

        if (dist < dotRadius) {
          // Inside dot — apply ink
          const ink = clamp(Math.round((1 - dist / dotRadius) * 255), 0, 255);
          if (ch === 0) outR = Math.max(0, outR - ink); // Cyan removes red
          else if (ch === 1) outG = Math.max(0, outG - ink); // Magenta removes green
          else if (ch === 2) outB = Math.max(0, outB - ink); // Yellow removes blue
          else { outR = Math.max(0, outR - ink); outG = Math.max(0, outG - ink); outB = Math.max(0, outB - ink); } // K
        }
      }

      // Quantize if levels > 2
      dst[i]     = levels > 2 ? quantize(outR, levels) : outR;
      dst[i + 1] = levels > 2 ? quantize(outG, levels) : outG;
      dst[i + 2] = levels > 2 ? quantize(outB, levels) : outB;
      dst[i + 3] = src[i + 3];
    }
  }
}

export const ditherDef: EffectToolDef = {
  effect: ditherEffect,
  sliders: [
    { key: 'strength', label: 'Strength', min: 0, max: 100, step: 1, defaultValue: 50, hint: 'Effect intensity', dragBind: 'x' },
    { key: 'levels', label: 'Levels', min: 2, max: 32, step: 1, defaultValue: 4, hint: 'Color depth per channel' },
    { key: 'scale', label: 'Scale', min: 1, max: 32, step: 1, defaultValue: 4, hint: 'Pattern / block size', dragBind: 'y' },
  ],
  modes: [
    { key: 'mode', modes: ['Floyd-Steinberg', 'Ordered', 'Halftone'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

/**
 * Turbulence effect — Perlin noise displacement.
 * Warps pixels using procedural noise independent of image content.
 * Creates smoke/cloud/organic distortion.
 */

import type { PixelEffect, EffectToolDef, EffectConfig } from './types.ts';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// Classic Perlin noise (2D)
// ---------------------------------------------------------------------------

const PERM = new Uint8Array(512);
{
  // Deterministic permutation table
  const p = [
    151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,
    140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,
    247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,
    57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,
    74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,
    60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,
    65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,
    200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,
    52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,
    207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,
    119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,
    129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,
    218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,
    81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,
    184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,
    222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180,
  ];
  for (let i = 0; i < 256; i++) {
    PERM[i] = p[i];
    PERM[i + 256] = p[i];
  }
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad2d(hash: number, x: number, y: number): number {
  const h = hash & 3;
  const u = h < 2 ? x : -x;
  const v = h === 0 || h === 3 ? y : -y;
  return u + v;
}

function perlin2d(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);

  const aa = PERM[PERM[xi] + yi];
  const ab = PERM[PERM[xi] + yi + 1];
  const ba = PERM[PERM[xi + 1] + yi];
  const bb = PERM[PERM[xi + 1] + yi + 1];

  return lerp(
    lerp(grad2d(aa, xf, yf), grad2d(ba, xf - 1, yf), u),
    lerp(grad2d(ab, xf, yf - 1), grad2d(bb, xf - 1, yf - 1), u),
    v,
  );
}

/**
 * Fractional Brownian motion — layered Perlin noise.
 */
function fbm(x: number, y: number, octaves: number): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    value += perlin2d(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / total;
}

// ---------------------------------------------------------------------------
// Effect
// ---------------------------------------------------------------------------

const turbulenceEffect: PixelEffect = {
  id: 'turbulence',
  label: 'Turbulence',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const amount = (config['amount'] ?? 40) as number;
    const scale = Math.max(1, (config['scale'] ?? 50) as number);
    const octaves = (config['octaves'] ?? 3) as number;
    const dirX = (config['directionX'] ?? 0) as number;
    const dirY = (config['directionY'] ?? 0) as number;

    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    const dragScale = mag > 0 ? 1 + mag * 0.01 : 1;

    // When no drag, warp in both axes equally
    let dx: number, dy: number;
    if (mag > 0) {
      dx = dirX / mag;
      dy = dirY / mag;
    } else {
      dx = 1;
      dy = 1;
    }

    const invScale = 1 / scale;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Two noise samples — offset in noise space so X and Y displacement are independent
        const nx = fbm(x * invScale, y * invScale, octaves);
        const ny = fbm(x * invScale + 137.3, y * invScale + 281.7, octaves);

        const offsetX = nx * amount * dragScale * dx;
        const offsetY = ny * amount * dragScale * dy;

        const sx = clamp(Math.round(x + offsetX), 0, width - 1);
        const sy = clamp(Math.round(y + offsetY), 0, height - 1);

        const di = (y * width + x) * 4;
        const si = (sy * width + sx) * 4;
        dst[di] = data[si];
        dst[di + 1] = data[si + 1];
        dst[di + 2] = data[si + 2];
        dst[di + 3] = data[di + 3];
      }
    }

    return out;
  },
};

export const turbulenceDef: EffectToolDef = {
  effect: turbulenceEffect,
  sliders: [
    { key: 'amount', label: 'Amount', min: 0, max: 400, step: 1, defaultValue: 40, hint: 'How far pixels shift' },
    { key: 'scale', label: 'Scale', min: 2, max: 400, step: 1, defaultValue: 50, hint: 'Noise frequency' },
    { key: 'octaves', label: 'Octaves', min: 1, max: 8, step: 1, defaultValue: 3, hint: 'Detail layers' },
  ],
  dragMapping: '2d',
};

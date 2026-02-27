/**
 * Tonal targeting — generates per-pixel masks based on luminance ranges.
 */

export interface TonalConfig {
  shadows: number;
  midtones: number;
  highlights: number;
}

function smoothWeight(luminance: number, center: number, width: number): number {
  const dist = Math.abs(luminance - center) / width;
  if (dist >= 1) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * dist));
}

export function computeTonalMask(
  source: ImageData,
  config: TonalConfig,
): Float32Array | null {
  if (config.shadows >= 1 && config.midtones >= 1 && config.highlights >= 1) {
    return null;
  }

  const { width, height } = source;
  const data = source.data;
  const mask = new Float32Array(width * height);

  const shadowCenter = 42;
  const midtoneCenter = 128;
  const highlightCenter = 213;
  const rangeWidth = 100;

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const luminance = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];

    const sWeight = smoothWeight(luminance, shadowCenter, rangeWidth);
    const mWeight = smoothWeight(luminance, midtoneCenter, rangeWidth);
    const hWeight = smoothWeight(luminance, highlightCenter, rangeWidth);

    const total = sWeight + mWeight + hWeight;
    if (total <= 0) {
      mask[i] = 1;
      continue;
    }

    mask[i] = (sWeight / total) * config.shadows + (mWeight / total) * config.midtones + (hWeight / total) * config.highlights;
  }

  return mask;
}

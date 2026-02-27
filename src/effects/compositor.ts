/**
 * Compositor — blends source + processed pixels using interactive and tonal masks.
 */

import type { PixelEffect, EffectConfig } from './types.ts';

export interface Compositor {
  setEffect(effect: PixelEffect, config: EffectConfig): void;
  updateConfig(config: EffectConfig): void;
  setSource(source: ImageData): void;
  getSource(): ImageData | null;
  setInteractiveMask(mask: Float32Array | null): void;
  setTonalMask(mask: Float32Array | null): void;
  composite(): ImageData | null;
  apply(): void;
  pushHistory(): void;
  undo(): boolean;
  reset(): void;
  destroy(): void;
}

export function createCompositor(): Compositor {
  let source: ImageData | null = null;
  let originalSource: ImageData | null = null;
  let effect: PixelEffect | null = null;
  let config: EffectConfig = {};
  let processedCache: ImageData | null = null;
  let interactiveMask: Float32Array | null = null;
  let tonalMask: Float32Array | null = null;
  let historyStack: Float32Array[] = [];

  function recompute(): void {
    if (!source || !effect) {
      processedCache = null;
      return;
    }
    processedCache = effect.apply(source, config);
  }

  return {
    setEffect(newEffect: PixelEffect, newConfig: EffectConfig): void {
      effect = newEffect;
      config = newConfig;
      recompute();
    },

    updateConfig(newConfig: EffectConfig): void {
      config = newConfig;
      recompute();
    },

    setSource(newSource: ImageData): void {
      source = newSource;
      if (!originalSource) {
        originalSource = newSource;
      }
      recompute();
    },

    getSource(): ImageData | null {
      return source;
    },

    setInteractiveMask(mask: Float32Array | null): void {
      interactiveMask = mask;
    },

    setTonalMask(mask: Float32Array | null): void {
      tonalMask = mask;
    },

    composite(): ImageData | null {
      if (!source || !processedCache) return null;

      const w = source.width;
      const h = source.height;
      const len = w * h * 4;
      const out = new ImageData(w, h);
      const src = source.data;
      const proc = processedCache.data;
      const dst = out.data;

      for (let i = 0; i < len; i += 4) {
        const px = i / 4;
        const iWeight = interactiveMask ? interactiveMask[px] : 1;
        const tWeight = tonalMask ? tonalMask[px] : 1;
        const weight = iWeight * tWeight;

        if (weight <= 0) {
          dst[i] = src[i];
          dst[i + 1] = src[i + 1];
          dst[i + 2] = src[i + 2];
          dst[i + 3] = src[i + 3];
        } else if (weight >= 1) {
          dst[i] = proc[i];
          dst[i + 1] = proc[i + 1];
          dst[i + 2] = proc[i + 2];
          dst[i + 3] = proc[i + 3];
        } else {
          const inv = 1 - weight;
          dst[i] = src[i] * inv + proc[i] * weight;
          dst[i + 1] = src[i + 1] * inv + proc[i + 1] * weight;
          dst[i + 2] = src[i + 2] * inv + proc[i + 2] * weight;
          dst[i + 3] = src[i + 3] * inv + proc[i + 3] * weight;
        }
      }

      return out;
    },

    apply(): void {
      const result = this.composite();
      if (result) {
        source = result;
        processedCache = null;
        interactiveMask = null;
        tonalMask = null;
        historyStack = [];
      }
    },

    pushHistory(): void {
      if (interactiveMask) {
        historyStack.push(new Float32Array(interactiveMask));
      }
    },

    undo(): boolean {
      const prev = historyStack.pop();
      if (prev) {
        interactiveMask = prev;
        return true;
      }
      return false;
    },

    reset(): void {
      if (originalSource) {
        source = originalSource;
      }
      processedCache = null;
      interactiveMask = null;
      tonalMask = null;
      historyStack = [];
      recompute();
    },

    destroy(): void {
      source = null;
      originalSource = null;
      processedCache = null;
      interactiveMask = null;
      tonalMask = null;
      historyStack = [];
      effect = null;
    },
  };
}

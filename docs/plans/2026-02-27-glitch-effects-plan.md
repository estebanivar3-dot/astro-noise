# Glitch Effects Suite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 8 interactive pixel-based glitch effects to CVLT TOOLS with shared compositor infrastructure, tonal targeting, and non-destructive undo.

**Architecture:** Pure-function pixel effects composited via shared infrastructure (brush masks, tonal masks, history stack). Each effect is a `Tool` registered with the existing router. A generic `effect-tool.ts` factory wraps any `PixelEffect` into a full Tool with UI, compositor wiring, and interaction handling.

**Tech Stack:** TypeScript, Canvas 2D API (getImageData/putImageData), existing Vite + router architecture. No new dependencies.

**Design doc:** `docs/plans/2026-02-27-glitch-effects-design.md`

---

## Phase 1: Shared Infrastructure

### Task 1: Extract shared UI helpers

The `createSlider` function is duplicated in `deepdream-controls.ts:278-324` and `style-transfer/controls.ts:207-253`. Extract to shared module.

**Files:**
- Create: `src/effects/ui-helpers.ts`
- Modify: `src/deepdream-controls.ts` (remove local `createSlider`, import from shared)
- Modify: `src/style-transfer/controls.ts` (remove local `createSlider`, import from shared)

**Step 1: Create `src/effects/ui-helpers.ts`**

```typescript
/**
 * Shared UI helpers for building tool control panels.
 */

export function createSlider(
  label: string,
  min: number,
  max: number,
  step: number,
  defaultValue: number,
  hint?: string,
): { group: HTMLDivElement; input: HTMLInputElement; valueEl: HTMLSpanElement } {
  const group = document.createElement('div');
  group.className = 'control-group';

  const labelRow = document.createElement('div');
  labelRow.className = 'control-label';

  const labelText = document.createElement('span');
  labelText.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'value';
  valueEl.textContent = String(defaultValue);

  labelRow.appendChild(labelText);
  labelRow.appendChild(valueEl);
  group.appendChild(labelRow);

  if (hint) {
    const hintEl = document.createElement('div');
    hintEl.className = 'control-hint';
    hintEl.textContent = hint;
    group.appendChild(hintEl);
  }

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(defaultValue);

  input.addEventListener('input', () => {
    valueEl.textContent = input.value;
  });

  group.appendChild(input);

  return { group, input, valueEl };
}

export function createModeToggle(
  modes: string[],
  defaultIndex: number = 0,
): { group: HTMLDivElement; getMode: () => number; setMode: (i: number) => void } {
  const group = document.createElement('div');
  group.className = 'control-group';

  const btn = document.createElement('button');
  btn.className = 'btn btn-secondary';
  btn.style.width = '100%';

  let currentIndex = defaultIndex;

  function update(): void {
    btn.textContent = `Mode ${currentIndex + 1}: ${modes[currentIndex]}`;
  }
  update();

  btn.addEventListener('click', () => {
    currentIndex = (currentIndex + 1) % modes.length;
    update();
  });

  group.appendChild(btn);

  return {
    group,
    getMode: () => currentIndex,
    setMode: (i: number) => { currentIndex = i; update(); },
  };
}

export function createSectionLabel(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'section-label';
  el.textContent = text;
  return el;
}

export function createDivider(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'control-divider';
  return el;
}
```

**Step 2: Update `src/deepdream-controls.ts`**

- Remove lines 278-324 (local `createSlider` function)
- Add import: `import { createSlider } from './effects/ui-helpers.ts';`

**Step 3: Update `src/style-transfer/controls.ts`**

- Remove lines 207-253 (local `createSlider` function)
- Add import: `import { createSlider } from '../effects/ui-helpers.ts';`

**Step 4: Verify**

Run `npx tsc --noEmit` — should compile without errors. Start dev server, confirm DeepDream and Style Transfer sliders still work.

**Step 5: Commit**

```
feat: extract shared createSlider to effects/ui-helpers
```

---

### Task 2: Types and interfaces

**Files:**
- Create: `src/effects/types.ts`

**Step 1: Create `src/effects/types.ts`**

```typescript
/**
 * Shared types for the pixel effects system.
 */

/** Interaction type determines how mouse events on the canvas affect the effect. */
export type InteractionType =
  | 'none'           // Full-image only, no canvas interaction
  | 'directional'    // Drag sets offset direction vector (LCD, Channel Shift)
  | 'area-paint'     // Drag paints effect under cursor (PIXLT, Fill)
  | 'smear';         // Drag corrupts/applies along path (Mosh)

/** Configuration value — all effect configs are flat number maps. */
export type EffectConfig = Record<string, number>;

/** A pixel effect: pure function from source pixels + config → processed pixels. */
export interface PixelEffect {
  /** Unique identifier matching the Tool id. */
  id: string;
  /** Display label for the nav. */
  label: string;
  /** Apply the effect to the full source image. */
  apply(source: ImageData, config: EffectConfig): ImageData;
  /** How the canvas responds to mouse interaction. */
  interactionType: InteractionType;
}

/** Defines a slider control for the effect's right panel. */
export interface SliderDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  hint?: string;
}

/** Defines a mode toggle for the effect's right panel. */
export interface ModeDef {
  key: string;
  modes: string[];
  defaultIndex?: number;
}

/** Complete UI definition for an effect tool. */
export interface EffectToolDef {
  effect: PixelEffect;
  sliders: SliderDef[];
  modes?: ModeDef[];
  /** Whether this effect supports interactive mode. Defaults to true if interactionType !== 'none'. */
  supportsInteractive?: boolean;
}
```

**Step 2: Commit**

```
feat: add pixel effect type definitions
```

---

### Task 3: Compositor

The compositor manages the effect pipeline: caching the full-image processed result, blending via masks, and undo history.

**Files:**
- Create: `src/effects/compositor.ts`

**Step 1: Create `src/effects/compositor.ts`**

```typescript
/**
 * Compositor — blends source + processed pixels using interactive and tonal masks.
 * Handles caching, undo history, and apply (bake) operations.
 */

import type { PixelEffect, EffectConfig } from './types.ts';

export interface Compositor {
  /** Set the pixel effect and its current config. Recomputes processedCache. */
  setEffect(effect: PixelEffect, config: EffectConfig): void;
  /** Update config and recompute. */
  updateConfig(config: EffectConfig): void;
  /** Set the source image (original or previously-applied). */
  setSource(source: ImageData): void;
  /** Get the current source. */
  getSource(): ImageData | null;
  /** Set the interactive mask (0-1 per pixel). null = full image (all 1s). */
  setInteractiveMask(mask: Float32Array | null): void;
  /** Set the tonal mask (0-1 per pixel). null = no tonal filtering (all 1s). */
  setTonalMask(mask: Float32Array | null): void;
  /** Composite and return the blended output. */
  composite(): ImageData | null;
  /** Bake the current composite as the new source (for effect stacking). */
  apply(): void;
  /** Push the current interactive mask onto the history stack. */
  pushHistory(): void;
  /** Pop the last history entry and restore it as the interactive mask. Returns false if empty. */
  undo(): boolean;
  /** Clear all masks and history. */
  reset(): void;
  /** Dispose and release memory. */
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

        // Interactive mask: null means full image (weight = 1)
        const iWeight = interactiveMask ? interactiveMask[px] : 1;
        // Tonal mask: null means no filtering (weight = 1)
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
```

**Step 2: Commit**

```
feat: add compositor for mask-based effect blending
```

---

### Task 4: Interactive canvas control (brush system)

**Files:**
- Create: `src/effects/brush.ts`

**Step 1: Create `src/effects/brush.ts`**

```typescript
/**
 * Interactive canvas control — handles mouse events on the canvas
 * and translates them into mask updates or directional vectors.
 */

import type { InteractionType } from './types.ts';

export interface BrushState {
  /** Current interaction mask (for area-paint, stamp, smear). */
  mask: Float32Array;
  /** Current direction vector (for directional mode). */
  directionX: number;
  directionY: number;
}

export interface BrushController {
  /** Start listening to canvas events. */
  attach(canvas: HTMLCanvasElement): void;
  /** Stop listening to canvas events. */
  detach(): void;
  /** Set the interaction type. */
  setInteractionType(type: InteractionType): void;
  /** Set brush radius (for area-paint/smear modes). */
  setBrushRadius(radius: number): void;
  /** Set brush softness (0 = hard, 1 = fully feathered). */
  setBrushSoftness(softness: number): void;
  /** Get the current mask. */
  getMask(): Float32Array | null;
  /** Get the current direction vector. */
  getDirection(): { x: number; y: number };
  /** Clear the mask to all zeros. */
  clearMask(): void;
  /** Restore mask from snapshot. */
  setMask(mask: Float32Array): void;
  /** Register callback for when interaction changes (mask update or direction change). */
  onChange(callback: () => void): void;
  /** Register callback for end of stroke (mouseup). */
  onStrokeEnd(callback: () => void): void;
}

export function createBrushController(): BrushController {
  let canvas: HTMLCanvasElement | null = null;
  let interactionType: InteractionType = 'none';
  let brushRadius = 20;
  let brushSoftness = 0.5;
  let mask: Float32Array | null = null;
  let directionX = 0;
  let directionY = 0;
  let isDrawing = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let changeCallback: (() => void) | null = null;
  let strokeEndCallback: (() => void) | null = null;

  // Bound handlers for cleanup
  let onMouseDown: ((e: MouseEvent) => void) | null = null;
  let onMouseMove: ((e: MouseEvent) => void) | null = null;
  let onMouseUp: ((e: MouseEvent) => void) | null = null;

  /** Convert page coordinates to canvas pixel coordinates. */
  function canvasCoords(e: MouseEvent): { x: number; y: number } {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }

  /** Paint a circle into the mask at (cx, cy). */
  function paintCircle(cx: number, cy: number): void {
    if (!mask || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    const r = brushRadius;
    const minX = Math.max(0, cx - r);
    const maxX = Math.min(w - 1, cx + r);
    const minY = Math.max(0, cy - r);
    const maxY = Math.min(h - 1, cy + r);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist > r) continue;
        const idx = y * w + x;
        // Feathered edge based on softness
        const edgeFactor = brushSoftness > 0
          ? 1 - Math.pow(dist / r, 1 / brushSoftness)
          : (dist < r ? 1 : 0);
        mask[idx] = Math.max(mask[idx], Math.max(0, edgeFactor));
      }
    }
  }

  function ensureMask(): void {
    if (!canvas) return;
    if (!mask || mask.length !== canvas.width * canvas.height) {
      mask = new Float32Array(canvas.width * canvas.height);
    }
  }

  return {
    attach(c: HTMLCanvasElement): void {
      canvas = c;

      onMouseDown = (e: MouseEvent) => {
        if (interactionType === 'none') return;
        isDrawing = true;
        const { x, y } = canvasCoords(e);
        dragStartX = x;
        dragStartY = y;

        if (interactionType === 'area-paint' || interactionType === 'stamp' || interactionType === 'smear') {
          ensureMask();
          paintCircle(x, y);
          changeCallback?.();
        }
      };

      onMouseMove = (e: MouseEvent) => {
        if (!isDrawing) return;
        const { x, y } = canvasCoords(e);

        if (interactionType === 'directional') {
          // Direction is relative to drag start
          directionX = x - dragStartX;
          directionY = y - dragStartY;
          changeCallback?.();
        } else if (interactionType === 'area-paint' || interactionType === 'smear') {
          paintCircle(x, y);
          changeCallback?.();
        }
      };

      onMouseUp = () => {
        if (!isDrawing) return;
        isDrawing = false;
        strokeEndCallback?.();
      };

      canvas.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },

    detach(): void {
      if (canvas && onMouseDown) {
        canvas.removeEventListener('mousedown', onMouseDown);
      }
      if (onMouseMove) {
        window.removeEventListener('mousemove', onMouseMove);
      }
      if (onMouseUp) {
        window.removeEventListener('mouseup', onMouseUp);
      }
      canvas = null;
      onMouseDown = null;
      onMouseMove = null;
      onMouseUp = null;
    },

    setInteractionType(type: InteractionType): void {
      interactionType = type;
      if (canvas) {
        canvas.style.cursor = type === 'none' ? 'default' : 'crosshair';
      }
    },

    setBrushRadius(r: number): void {
      brushRadius = r;
    },

    setBrushSoftness(s: number): void {
      brushSoftness = s;
    },

    getMask(): Float32Array | null {
      return mask;
    },

    getDirection(): { x: number; y: number } {
      return { x: directionX, y: directionY };
    },

    clearMask(): void {
      if (mask) mask.fill(0);
      directionX = 0;
      directionY = 0;
    },

    setMask(m: Float32Array): void {
      mask = new Float32Array(m);
    },

    onChange(callback: () => void): void {
      changeCallback = callback;
    },

    onStrokeEnd(callback: () => void): void {
      strokeEndCallback = callback;
    },
  };
}
```

**Step 2: Commit**

```
feat: add brush controller for interactive canvas effects
```

---

### Task 5: Tonal targeting

**Files:**
- Create: `src/effects/tonal.ts`

**Step 1: Create `src/effects/tonal.ts`**

```typescript
/**
 * Tonal targeting — generates per-pixel masks based on luminance ranges.
 * Allows effects to be selectively applied to shadows, midtones, or highlights.
 */

export interface TonalConfig {
  shadows: number;    // 0-1, default 1
  midtones: number;   // 0-1, default 1
  highlights: number; // 0-1, default 1
}

const DEFAULT_TONAL: TonalConfig = { shadows: 1, midtones: 1, highlights: 1 };

/**
 * Compute a smooth blending weight for a luminance value within a tonal range.
 * Uses a cosine-based smooth transition to avoid hard edges.
 */
function smoothWeight(luminance: number, center: number, width: number): number {
  const dist = Math.abs(luminance - center) / width;
  if (dist >= 1) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * dist));
}

/**
 * Generate a tonal mask for the given source image.
 * Returns null if all sliders are at 100% (no filtering needed).
 */
export function computeTonalMask(
  source: ImageData,
  config: TonalConfig = DEFAULT_TONAL,
): Float32Array | null {
  // If all at 100%, no filtering needed
  if (config.shadows >= 1 && config.midtones >= 1 && config.highlights >= 1) {
    return null;
  }

  const { width, height } = source;
  const data = source.data;
  const mask = new Float32Array(width * height);

  // Tonal range centers and widths (in 0-255 space)
  const shadowCenter = 42;
  const midtoneCenter = 128;
  const highlightCenter = 213;
  const rangeWidth = 100; // overlap width for smooth blending

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const luminance = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];

    // Compute weights for each tonal range
    const sWeight = smoothWeight(luminance, shadowCenter, rangeWidth);
    const mWeight = smoothWeight(luminance, midtoneCenter, rangeWidth);
    const hWeight = smoothWeight(luminance, highlightCenter, rangeWidth);

    // Normalize so they sum to 1
    const total = sWeight + mWeight + hWeight;
    if (total <= 0) {
      mask[i] = 1;
      continue;
    }

    const sNorm = sWeight / total;
    const mNorm = mWeight / total;
    const hNorm = hWeight / total;

    // Final weight is the blend of each range's slider value
    mask[i] = sNorm * config.shadows + mNorm * config.midtones + hNorm * config.highlights;
  }

  return mask;
}
```

**Step 2: Commit**

```
feat: add tonal targeting mask computation
```

---

### Task 6: Tonal targeting UI controls

**Files:**
- Create: `src/effects/tonal-controls.ts`

**Step 1: Create `src/effects/tonal-controls.ts`**

```typescript
/**
 * Tonal targeting UI section — shared across all effect tools.
 * Builds shadow/midtone/highlight sliders into a container.
 */

import type { TonalConfig } from './tonal.ts';
import { createSlider, createSectionLabel, createDivider } from './ui-helpers.ts';

export interface TonalControls {
  /** Get the current tonal config from slider values. */
  getConfig(): TonalConfig;
  /** Build the UI into the given container. */
  mount(container: HTMLElement): void;
  /** Register a callback for when any tonal slider changes. */
  onChange(callback: () => void): void;
  /** Get the disable-able elements for toggling during processing. */
  getInteractiveElements(): HTMLInputElement[];
}

export function createTonalControls(): TonalControls {
  let shadowInput: HTMLInputElement;
  let midtoneInput: HTMLInputElement;
  let highlightInput: HTMLInputElement;
  let changeCallback: (() => void) | null = null;

  return {
    getConfig(): TonalConfig {
      return {
        shadows: parseFloat(shadowInput?.value ?? '1'),
        midtones: parseFloat(midtoneInput?.value ?? '1'),
        highlights: parseFloat(highlightInput?.value ?? '1'),
      };
    },

    mount(container: HTMLElement): void {
      container.appendChild(createDivider());
      container.appendChild(createSectionLabel('Tonal Targeting'));

      const { group: sGroup, input: sInput } = createSlider('Shadows', 0, 1, 0.05, 1);
      shadowInput = sInput;
      shadowInput.addEventListener('input', () => changeCallback?.());
      container.appendChild(sGroup);

      const { group: mGroup, input: mInput } = createSlider('Midtones', 0, 1, 0.05, 1);
      midtoneInput = mInput;
      midtoneInput.addEventListener('input', () => changeCallback?.());
      container.appendChild(mGroup);

      const { group: hGroup, input: hInput } = createSlider('Highlights', 0, 1, 0.05, 1);
      highlightInput = hInput;
      highlightInput.addEventListener('input', () => changeCallback?.());
      container.appendChild(hGroup);
    },

    onChange(callback: () => void): void {
      changeCallback = callback;
    },

    getInteractiveElements(): HTMLInputElement[] {
      return [shadowInput, midtoneInput, highlightInput].filter(Boolean);
    },
  };
}
```

**Step 2: Commit**

```
feat: add tonal targeting UI controls
```

---

### Task 7: Generic effect tool factory

This is the key piece — takes an `EffectToolDef` and produces a complete `Tool` that the router can register. Wires up compositor, brush controller, tonal controls, and all UI.

**Files:**
- Create: `src/effects/effect-tool.ts`

**Step 1: Create `src/effects/effect-tool.ts`**

```typescript
/**
 * Generic effect tool factory — wraps any PixelEffect into a full Tool
 * with UI controls, compositor wiring, and interaction handling.
 */

import type { Tool, ToolControls } from '../router.ts';
import type { EffectToolDef, EffectConfig } from './types.ts';
import { createCompositor } from './compositor.ts';
import { createBrushController } from './brush.ts';
import { createTonalControls } from './tonal-controls.ts';
import { computeTonalMask } from './tonal.ts';
import { createSlider, createModeToggle, createSectionLabel, createDivider } from './ui-helpers.ts';

export interface EffectToolCallbacks {
  /** Get the current source image from the canvas manager. */
  getSourceImage: () => ImageData | null;
  /** Display an ImageData on the canvas. */
  displayImageData: (imageData: ImageData) => void;
  /** Called when the effect is "applied" (baked). The new source ImageData is passed. */
  onApply: (newSource: ImageData) => void;
  /** Called when reset is pressed. */
  onReset: () => void;
}

export function createEffectTool(
  def: EffectToolDef,
  callbacks: EffectToolCallbacks,
): Tool {
  const { effect, sliders, modes } = def;
  const supportsInteractive = def.supportsInteractive ?? effect.interactionType !== 'none';

  const compositor = createCompositor();
  const brush = createBrushController();
  const tonalCtrl = createTonalControls();

  let isInteractiveMode = false;
  let actionEnabled = false;

  /** Gather current config from all sliders and mode toggles. */
  let getConfigFn: (() => EffectConfig) | null = null;

  /** Recompute the effect and display the result. */
  function refresh(): void {
    const source = callbacks.getSourceImage();
    if (!source || !getConfigFn) return;

    compositor.setSource(source);
    const config = getConfigFn();

    // For directional effects in interactive mode, inject direction into config
    if (isInteractiveMode && effect.interactionType === 'directional') {
      const dir = brush.getDirection();
      config['directionX'] = dir.x;
      config['directionY'] = dir.y;
    }

    compositor.setEffect(effect, config);

    // Update masks
    if (isInteractiveMode && effect.interactionType !== 'directional') {
      compositor.setInteractiveMask(brush.getMask());
    } else {
      compositor.setInteractiveMask(null);
    }

    const tonalConfig = tonalCtrl.getConfig();
    compositor.setTonalMask(computeTonalMask(source, tonalConfig));

    const output = compositor.composite();
    if (output) {
      callbacks.displayImageData(output);
    }
  }

  const tool: Tool = {
    id: effect.id,
    label: effect.label,

    createLeftPanel(_container: HTMLElement): (() => void) | null {
      return null;
    },

    createRightPanel(
      controlsContainer: HTMLElement,
      actionBar: HTMLElement,
      canvasContainer: HTMLElement,
    ): ToolControls {
      // ---- Parameters section ----
      controlsContainer.appendChild(createSectionLabel('Parameters'));

      // ---- Mode toggles ----
      const modeGetters: Record<string, () => number> = {};
      if (modes) {
        for (const modeDef of modes) {
          const { group, getMode } = createModeToggle(modeDef.modes, modeDef.defaultIndex ?? 0);
          modeGetters[modeDef.key] = getMode;
          controlsContainer.appendChild(group);

          // Refresh on mode change
          group.addEventListener('click', () => refresh());
        }
      }

      // ---- Effect-specific sliders ----
      const sliderInputs: Record<string, HTMLInputElement> = {};
      const interactiveElements: (HTMLInputElement | HTMLSelectElement | HTMLButtonElement)[] = [];

      for (const sliderDef of sliders) {
        const { group, input } = createSlider(
          sliderDef.label,
          sliderDef.min,
          sliderDef.max,
          sliderDef.step,
          sliderDef.defaultValue,
          sliderDef.hint,
        );
        sliderInputs[sliderDef.key] = input;
        interactiveElements.push(input);
        input.addEventListener('input', () => refresh());
        controlsContainer.appendChild(group);
      }

      // ---- Build getConfig function ----
      getConfigFn = (): EffectConfig => {
        const config: EffectConfig = {};
        for (const sliderDef of sliders) {
          config[sliderDef.key] = parseFloat(sliderInputs[sliderDef.key].value);
        }
        for (const [key, getMode] of Object.entries(modeGetters)) {
          config[key] = getMode();
        }
        return config;
      };

      // ---- Interactive mode toggle ----
      if (supportsInteractive) {
        controlsContainer.appendChild(createDivider());
        controlsContainer.appendChild(createSectionLabel('Mode'));

        const modeGroup = document.createElement('div');
        modeGroup.className = 'control-group';

        const fullBtn = document.createElement('button');
        fullBtn.className = 'btn btn-secondary';
        fullBtn.style.flex = '1';
        fullBtn.textContent = 'Full Image';

        const interBtn = document.createElement('button');
        interBtn.className = 'btn btn-secondary';
        interBtn.style.flex = '1';
        interBtn.textContent = 'Interactive';

        const modeRow = document.createElement('div');
        modeRow.style.display = 'flex';
        modeRow.style.gap = '6px';

        function updateModeButtons(): void {
          fullBtn.style.background = !isInteractiveMode ? 'var(--fg)' : 'transparent';
          fullBtn.style.color = !isInteractiveMode ? 'var(--bg-dark)' : 'var(--fg-dim)';
          fullBtn.style.borderColor = !isInteractiveMode ? 'var(--fg)' : 'var(--border)';
          interBtn.style.background = isInteractiveMode ? 'var(--fg)' : 'transparent';
          interBtn.style.color = isInteractiveMode ? 'var(--bg-dark)' : 'var(--fg-dim)';
          interBtn.style.borderColor = isInteractiveMode ? 'var(--fg)' : 'var(--border)';
        }

        fullBtn.addEventListener('click', () => {
          isInteractiveMode = false;
          brush.setInteractionType('none');
          brush.clearMask();
          updateModeButtons();
          brushSizeGroup.style.display = 'none';
          refresh();
        });

        interBtn.addEventListener('click', () => {
          isInteractiveMode = true;
          brush.setInteractionType(effect.interactionType);
          updateModeButtons();
          // Show brush size for paint/smear types
          if (effect.interactionType === 'area-paint' || effect.interactionType === 'smear') {
            brushSizeGroup.style.display = 'block';
          }
          refresh();
        });

        modeRow.appendChild(fullBtn);
        modeRow.appendChild(interBtn);
        modeGroup.appendChild(modeRow);
        controlsContainer.appendChild(modeGroup);

        updateModeButtons();

        // ---- Brush size slider (hidden unless interactive + paint/smear) ----
        const { group: brushSizeGroup, input: brushSizeInput } = createSlider(
          'Brush Size', 5, 100, 1, 20,
        );
        brushSizeGroup.style.display = 'none';
        brushSizeInput.addEventListener('input', () => {
          brush.setBrushRadius(parseInt(brushSizeInput.value, 10));
        });
        controlsContainer.appendChild(brushSizeGroup);

        interactiveElements.push(fullBtn as unknown as HTMLButtonElement);
        interactiveElements.push(interBtn as unknown as HTMLButtonElement);
      }

      // ---- Tonal targeting ----
      tonalCtrl.mount(controlsContainer);
      tonalCtrl.onChange(() => refresh());
      interactiveElements.push(...tonalCtrl.getInteractiveElements());

      // ---- Progress / status (in right panel, NOT overlaying canvas) ----
      const progressGroup = document.createElement('div');
      progressGroup.className = 'effect-progress';
      progressGroup.style.display = 'none';

      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar';
      const progressFill = document.createElement('div');
      progressFill.className = 'progress-bar-fill';
      progressFill.style.width = '0%';
      progressBar.appendChild(progressFill);

      const statusText = document.createElement('div');
      statusText.className = 'status-text';
      progressGroup.appendChild(progressBar);
      progressGroup.appendChild(statusText);
      controlsContainer.appendChild(progressGroup);

      // ---- Action buttons ----
      const applyBtn = document.createElement('button');
      applyBtn.className = 'btn btn-primary';
      applyBtn.style.flex = '1';
      applyBtn.textContent = 'Apply';
      applyBtn.disabled = !actionEnabled;

      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn btn-secondary';
      resetBtn.style.flex = '1';
      resetBtn.textContent = 'Reset';

      applyBtn.addEventListener('click', () => {
        compositor.apply();
        const newSource = compositor.getSource();
        if (newSource) {
          callbacks.onApply(newSource);
        }
        brush.clearMask();
        refresh();
      });

      resetBtn.addEventListener('click', () => {
        compositor.reset();
        brush.clearMask();
        callbacks.onReset();
      });

      actionBar.appendChild(applyBtn);
      actionBar.appendChild(resetBtn);
      interactiveElements.push(applyBtn, resetBtn);

      // ---- Wire up brush controller ----
      const canvas = canvasContainer.querySelector('canvas') as HTMLCanvasElement | null;
      if (canvas) {
        brush.attach(canvas);
        brush.onChange(() => refresh());
        brush.onStrokeEnd(() => compositor.pushHistory());
      }

      // ---- Keyboard shortcut: Cmd+Z for undo ----
      function onKeyDown(e: KeyboardEvent): void {
        if ((e.metaKey || e.ctrlKey) && e.key === 'z' && isInteractiveMode) {
          e.preventDefault();
          if (compositor.undo()) {
            const mask = brush.getMask();
            // Restore mask from compositor's history is handled internally
            refresh();
          }
        }
      }
      window.addEventListener('keydown', onKeyDown);

      // ---- Initial render if source exists ----
      const source = callbacks.getSourceImage();
      if (source) {
        compositor.setSource(source);
        refresh();
      }

      return {
        setActionEnabled(enabled: boolean): void {
          actionEnabled = enabled;
          applyBtn.disabled = !enabled;
        },
        destroy(): void {
          brush.detach();
          compositor.destroy();
          window.removeEventListener('keydown', onKeyDown);
          getConfigFn = null;
          isInteractiveMode = false;
        },
      };
    },
  };

  return tool;
}
```

**Step 2: Commit**

```
feat: add generic effect tool factory
```

---

## Phase 2: Effects

Each effect is a single file exporting a function that returns a `Tool`.

### Task 8: Threshold effect

**Files:**
- Create: `src/effects/threshold.ts`

**Step 1: Create `src/effects/threshold.ts`**

```typescript
/**
 * Threshold effect — converts to black & white based on luminance cutoff.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

const thresholdEffect: PixelEffect = {
  id: 'threshold',
  label: 'Threshold',
  interactionType: 'none',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const threshold = config['threshold'] ?? 128;
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    for (let i = 0; i < data.length; i += 4) {
      const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const val = luminance > threshold ? 255 : 0;
      dst[i] = val;
      dst[i + 1] = val;
      dst[i + 2] = val;
      dst[i + 3] = data[i + 3];
    }

    return out;
  },
};

export const thresholdDef: EffectToolDef = {
  effect: thresholdEffect,
  sliders: [
    { key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1, defaultValue: 128, hint: 'Luminance cutoff for black vs white' },
  ],
  supportsInteractive: false,
};
```

**Step 2: Commit**

```
feat: add threshold effect
```

---

### Task 9: Channel Shift effect

**Files:**
- Create: `src/effects/channel-shift.ts`

**Step 1: Create `src/effects/channel-shift.ts`**

```typescript
/**
 * Channel Shift — displaces R, G, B channels in different directions.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

const channelShiftEffect: PixelEffect = {
  id: 'channel-shift',
  label: 'Channel Shift',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const intensity = config['intensity'] ?? 20;
    const mode = config['mode'] ?? 0;
    const dirX = config['directionX'] ?? 0;
    const dirY = config['directionY'] ?? 0;

    // Normalize direction or use intensity as magnitude when no direction
    let dx = dirX;
    let dy = dirY;
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag > 0) {
      dx = (dx / mag) * intensity;
      dy = (dy / mag) * intensity;
    } else {
      dx = intensity;
      dy = 0;
    }

    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        let rOx: number, rOy: number, gOx: number, gOy: number, bOx: number, bOy: number;

        switch (mode) {
          case 1: // R/B opposite horizontal, G vertical
            rOx = dx; rOy = 0;
            gOx = 0; gOy = dy;
            bOx = -dx; bOy = 0;
            break;
          case 2: // 120° angles
            rOx = dx; rOy = dy;
            gOx = dx * Math.cos(2.094) - dy * Math.sin(2.094);
            gOy = dx * Math.sin(2.094) + dy * Math.cos(2.094);
            bOx = dx * Math.cos(4.189) - dy * Math.sin(4.189);
            bOy = dx * Math.sin(4.189) + dy * Math.cos(4.189);
            break;
          case 3: // Circular
            rOx = dx; rOy = dy;
            gOx = -dy; gOy = dx;
            bOx = dy; bOy = -dx;
            break;
          default: // Mode 0: R shifts (dx,dy), G opposite, B stays
            rOx = dx; rOy = dy;
            gOx = -dx; gOy = -dy;
            bOx = 0; bOy = 0;
            break;
        }

        const rSx = clamp(Math.round(x - rOx), 0, width - 1);
        const rSy = clamp(Math.round(y - rOy), 0, height - 1);
        const gSx = clamp(Math.round(x - gOx), 0, width - 1);
        const gSy = clamp(Math.round(y - gOy), 0, height - 1);
        const bSx = clamp(Math.round(x - bOx), 0, width - 1);
        const bSy = clamp(Math.round(y - bOy), 0, height - 1);

        dst[i]     = data[(rSy * width + rSx) * 4];
        dst[i + 1] = data[(gSy * width + gSx) * 4 + 1];
        dst[i + 2] = data[(bSy * width + bSx) * 4 + 2];
        dst[i + 3] = data[i + 3];
      }
    }

    return out;
  },
};

export const channelShiftDef: EffectToolDef = {
  effect: channelShiftEffect,
  sliders: [
    { key: 'intensity', label: 'Intensity', min: 1, max: 80, step: 1, defaultValue: 20, hint: 'How far channels drift apart' },
  ],
  modes: [
    { key: 'mode', modes: ['Split', 'Cross', 'Tri-angle', 'Circular'], defaultIndex: 0 },
  ],
};
```

**Step 2: Commit**

```
feat: add channel shift effect
```

---

### Task 10: LCD effect

**Files:**
- Create: `src/effects/lcd.ts`

**Step 1: Create `src/effects/lcd.ts`**

```typescript
/**
 * LCD — RGB channel separation + vertical scanline grid.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

const lcdEffect: PixelEffect = {
  id: 'lcd',
  label: 'LCD',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const intensity = config['intensity'] ?? 30;
    const mode = config['mode'] ?? 0;
    const dirX = config['directionX'] ?? 0;
    const dirY = config['directionY'] ?? 0;

    // Normalize direction
    let dx = dirX;
    let dy = dirY;
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag > 0) {
      dx = (dx / mag) * intensity;
      dy = (dy / mag) * intensity;
    } else {
      dx = intensity;
      dy = 0;
    }

    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    // Pass 1: Channel separation (varies by mode)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        let rOx: number, rOy: number, gOx: number, gOy: number, bOx: number, bOy: number;

        switch (mode) {
          case 1: // Horizontal only
            rOx = dx; rOy = 0;
            gOx = 0; gOy = 0;
            bOx = -dx; bOy = 0;
            break;
          case 2: // Vertical only
            rOx = 0; rOy = dy || intensity;
            gOx = 0; gOy = 0;
            bOx = 0; bOy = -(dy || intensity);
            break;
          case 3: // Radial from center
            const cx = x - width / 2;
            const cy = y - height / 2;
            const cMag = Math.sqrt(cx * cx + cy * cy) || 1;
            const scale = intensity / cMag * 0.3;
            rOx = cx * scale; rOy = cy * scale;
            gOx = 0; gOy = 0;
            bOx = -cx * scale; bOy = -cy * scale;
            break;
          default: // Mode 0: Directional
            rOx = dx; rOy = dy;
            gOx = 0; gOy = 0;
            bOx = -dx; bOy = -dy;
            break;
        }

        const rSx = clamp(Math.round(x - rOx), 0, width - 1);
        const rSy = clamp(Math.round(y - rOy), 0, height - 1);
        const gSx = clamp(Math.round(x - gOx), 0, width - 1);
        const gSy = clamp(Math.round(y - gOy), 0, height - 1);
        const bSx = clamp(Math.round(x - bOx), 0, width - 1);
        const bSy = clamp(Math.round(y - bOy), 0, height - 1);

        dst[i]     = data[(rSy * width + rSx) * 4];
        dst[i + 1] = data[(gSy * width + gSx) * 4 + 1];
        dst[i + 2] = data[(bSy * width + bSx) * 4 + 2];
        dst[i + 3] = 255;
      }
    }

    // Pass 2: Scanline grid overlay
    // Intensity controls how visible the grid is (0 = no grid, 100 = full grid)
    const gridStrength = Math.min(1, intensity / 60);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const col = x % 3;

        // Each column emphasizes one channel, dims the other two
        const dimFactor = 0.15 + (1 - gridStrength) * 0.85; // At 0 strength, no dimming
        const boostFactor = 1 + gridStrength * 1.5; // Brightness compensation

        if (col === 0) {
          dst[i]     = clamp(Math.round(dst[i] * boostFactor), 0, 255);
          dst[i + 1] = clamp(Math.round(dst[i + 1] * dimFactor), 0, 255);
          dst[i + 2] = clamp(Math.round(dst[i + 2] * dimFactor), 0, 255);
        } else if (col === 1) {
          dst[i]     = clamp(Math.round(dst[i] * dimFactor), 0, 255);
          dst[i + 1] = clamp(Math.round(dst[i + 1] * boostFactor), 0, 255);
          dst[i + 2] = clamp(Math.round(dst[i + 2] * dimFactor), 0, 255);
        } else {
          dst[i]     = clamp(Math.round(dst[i] * dimFactor), 0, 255);
          dst[i + 1] = clamp(Math.round(dst[i + 1] * dimFactor), 0, 255);
          dst[i + 2] = clamp(Math.round(dst[i + 2] * boostFactor), 0, 255);
        }
      }
    }

    return out;
  },
};

export const lcdDef: EffectToolDef = {
  effect: lcdEffect,
  sliders: [
    { key: 'intensity', label: 'Intensity', min: 1, max: 100, step: 1, defaultValue: 30, hint: 'Channel separation + scanline strength' },
  ],
  modes: [
    { key: 'mode', modes: ['Directional', 'Horizontal', 'Vertical', 'Radial'], defaultIndex: 0 },
  ],
};
```

**Step 2: Commit**

```
feat: add LCD effect
```

---

### Task 11: Burn effect

**Files:**
- Create: `src/effects/burn.ts`

**Step 1: Create `src/effects/burn.ts`**

```typescript
/**
 * Burn — destructive contrast/exposure effects mimicking film damage.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(val: number): number {
  return val < 0 ? 0 : val > 255 ? 255 : val;
}

const burnEffect: PixelEffect = {
  id: 'burn',
  label: 'Burn',
  interactionType: 'none',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const intensity = (config['intensity'] ?? 50) / 100;
    const mode = config['mode'] ?? 0;
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      let nr: number, ng: number, nb: number;

      switch (mode) {
        case 1: { // Dodge: lighten midtones
          nr = 255 - ((255 - r) * (255 - r)) / 255;
          ng = 255 - ((255 - g) * (255 - g)) / 255;
          nb = 255 - ((255 - b) * (255 - b)) / 255;
          break;
        }
        case 2: { // Solarize: invert above midpoint
          const thresh = 128 * (1 - intensity * 0.5);
          nr = r > thresh ? 255 - r : r;
          ng = g > thresh ? 255 - g : g;
          nb = b > thresh ? 255 - b : b;
          break;
        }
        default: { // Mode 0: Burn — darken midtones
          nr = (r * r) / 255;
          ng = (g * g) / 255;
          nb = (b * b) / 255;
          break;
        }
      }

      // Blend by intensity
      dst[i]     = clamp(Math.round(r + (nr - r) * intensity));
      dst[i + 1] = clamp(Math.round(g + (ng - g) * intensity));
      dst[i + 2] = clamp(Math.round(b + (nb - b) * intensity));
      dst[i + 3] = data[i + 3];
    }

    return out;
  },
};

export const burnDef: EffectToolDef = {
  effect: burnEffect,
  sliders: [
    { key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, defaultValue: 50, hint: 'How destructive the burn effect is' },
  ],
  modes: [
    { key: 'mode', modes: ['Burn', 'Dodge', 'Solarize'], defaultIndex: 0 },
  ],
  supportsInteractive: false,
};
```

**Step 2: Commit**

```
feat: add burn effect
```

---

### Task 12: PIXLT effect

**Files:**
- Create: `src/effects/pixlt.ts`

**Step 1: Create `src/effects/pixlt.ts`**

```typescript
/**
 * PIXLT — mosaic pixelation effect.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

const pixltEffect: PixelEffect = {
  id: 'pixlt',
  label: 'PIXLT',
  interactionType: 'area-paint',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const blockSize = Math.max(2, Math.round(config['blockSize'] ?? 8));
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    for (let by = 0; by < height; by += blockSize) {
      for (let bx = 0; bx < width; bx += blockSize) {
        // Average color within block
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        const maxY = Math.min(by + blockSize, height);
        const maxX = Math.min(bx + blockSize, width);

        for (let y = by; y < maxY; y++) {
          for (let x = bx; x < maxX; x++) {
            const i = (y * width + x) * 4;
            rSum += data[i];
            gSum += data[i + 1];
            bSum += data[i + 2];
            count++;
          }
        }

        const avgR = Math.round(rSum / count);
        const avgG = Math.round(gSum / count);
        const avgB = Math.round(bSum / count);

        // Fill block with average
        for (let y = by; y < maxY; y++) {
          for (let x = bx; x < maxX; x++) {
            const i = (y * width + x) * 4;
            dst[i] = avgR;
            dst[i + 1] = avgG;
            dst[i + 2] = avgB;
            dst[i + 3] = data[i + 3];
          }
        }
      }
    }

    return out;
  },
};

export const pixltDef: EffectToolDef = {
  effect: pixltEffect,
  sliders: [
    { key: 'blockSize', label: 'Block Size', min: 2, max: 64, step: 1, defaultValue: 8, hint: 'Size of each pixel block' },
  ],
};
```

**Step 2: Commit**

```
feat: add PIXLT effect
```

---

### Task 13: Fill effect

**Files:**
- Create: `src/effects/fill.ts`

**Step 1: Create `src/effects/fill.ts`**

```typescript
/**
 * Fill — stamps color/noise into areas of the image.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

const fillEffect: PixelEffect = {
  id: 'fill',
  label: 'Fill',
  interactionType: 'area-paint',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const mode = config['mode'] ?? 0;
    const opacity = (config['opacity'] ?? 100) / 100;
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    // Pre-generate fill color/noise
    for (let i = 0; i < data.length; i += 4) {
      let fr: number, fg: number, fb: number;

      switch (mode) {
        case 1: { // Solid white
          fr = 255; fg = 255; fb = 255;
          break;
        }
        case 2: { // Solid black
          fr = 0; fg = 0; fb = 0;
          break;
        }
        default: { // Mode 0: Random noise
          fr = Math.random() * 255;
          fg = Math.random() * 255;
          fb = Math.random() * 255;
          break;
        }
      }

      // Blend with opacity
      dst[i]     = Math.round(data[i] * (1 - opacity) + fr * opacity);
      dst[i + 1] = Math.round(data[i + 1] * (1 - opacity) + fg * opacity);
      dst[i + 2] = Math.round(data[i + 2] * (1 - opacity) + fb * opacity);
      dst[i + 3] = data[i + 3];
    }

    return out;
  },
};

export const fillDef: EffectToolDef = {
  effect: fillEffect,
  sliders: [
    { key: 'opacity', label: 'Opacity', min: 10, max: 100, step: 5, defaultValue: 100, hint: 'How opaque the fill is' },
  ],
  modes: [
    { key: 'mode', modes: ['Noise', 'White', 'Black'], defaultIndex: 0 },
  ],
};
```

**Step 2: Commit**

```
feat: add fill effect
```

---

### Task 14: Gradient effect

**Files:**
- Create: `src/effects/gradient.ts`

**Step 1: Create `src/effects/gradient.ts`**

```typescript
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

    // Gradient colors — warm orange to cool blue (hardcoded for now, stylish default)
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

        // Project pixel onto gradient axis
        const dx = x - cx;
        const dy = y - cy;
        const proj = (dx * cosA + dy * sinA) / maxDist;
        const t = (proj + 1) / 2; // Normalize to 0-1

        // Interpolate gradient color
        const gr = colA.r + (colB.r - colA.r) * t;
        const gg = colA.g + (colB.g - colA.g) * t;
        const gb = colA.b + (colB.b - colA.b) * t;

        const sr = data[i];
        const sg = data[i + 1];
        const sb = data[i + 2];

        let br: number, bg: number, bb: number;

        switch (blendMode) {
          case 1: // Multiply
            br = (sr * gr) / 255;
            bg = (sg * gg) / 255;
            bb = (sb * gb) / 255;
            break;
          case 2: // Screen
            br = 255 - ((255 - sr) * (255 - gr)) / 255;
            bg = 255 - ((255 - sg) * (255 - gg)) / 255;
            bb = 255 - ((255 - sb) * (255 - gb)) / 255;
            break;
          case 3: // Color (hue+sat from gradient, luminance from source)
            const lum = 0.299 * sr + 0.587 * sg + 0.114 * sb;
            const gLum = 0.299 * gr + 0.587 * gg + 0.114 * gb;
            const ratio = gLum > 0 ? lum / gLum : 1;
            br = gr * ratio;
            bg = gg * ratio;
            bb = gb * ratio;
            break;
          default: // Mode 0: Overlay
            br = sr < 128 ? (2 * sr * gr) / 255 : 255 - (2 * (255 - sr) * (255 - gr)) / 255;
            bg = sg < 128 ? (2 * sg * gg) / 255 : 255 - (2 * (255 - sg) * (255 - gg)) / 255;
            bb = sb < 128 ? (2 * sb * gb) / 255 : 255 - (2 * (255 - sb) * (255 - gb)) / 255;
            break;
        }

        // Blend by intensity
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
```

**Step 2: Commit**

```
feat: add gradient effect
```

---

### Task 15: Mosh effect

**Files:**
- Create: `src/effects/mosh.ts`

**Step 1: Create `src/effects/mosh.ts`**

```typescript
/**
 * Mosh — datamoshing / compression corruption simulation.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

const moshEffect: PixelEffect = {
  id: 'mosh',
  label: 'Mosh',
  interactionType: 'smear',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const intensity = (config['intensity'] ?? 50) / 100;
    const blockSize = Math.max(4, Math.round(config['blockSize'] ?? 16));
    const mode = config['mode'] ?? 0;
    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    // Copy source first
    dst.set(data);

    // Seed pseudo-random with a fixed value for reproducibility per config
    let seed = Math.round(intensity * 1000 + blockSize * 7);
    function rand(): number {
      seed = (seed * 16807 + 0) % 2147483647;
      return (seed - 1) / 2147483646;
    }

    const numOps = Math.round(20 + intensity * 80);

    switch (mode) {
      case 1: { // Row glitch: shift entire rows
        for (let op = 0; op < numOps; op++) {
          const y = Math.floor(rand() * height);
          const rowHeight = Math.floor(1 + rand() * blockSize);
          const shift = Math.round((rand() - 0.5) * 2 * blockSize * intensity);

          for (let dy = 0; dy < rowHeight && y + dy < height; dy++) {
            for (let x = 0; x < width; x++) {
              const srcX = clamp(x - shift, 0, width - 1);
              const dstIdx = ((y + dy) * width + x) * 4;
              const srcIdx = ((y + dy) * width + srcX) * 4;
              dst[dstIdx] = data[srcIdx];
              dst[dstIdx + 1] = data[srcIdx + 1];
              dst[dstIdx + 2] = data[srcIdx + 2];
            }
          }
        }
        break;
      }

      case 2: { // Byte corruption: swap/duplicate chunks
        const chunkCount = Math.round(10 + intensity * 40);
        for (let c = 0; c < chunkCount; c++) {
          const chunkLen = Math.floor(4 + rand() * blockSize * 4) * 4; // Aligned to pixels
          const srcOff = Math.floor(rand() * (data.length - chunkLen));
          const dstOff = Math.floor(rand() * (data.length - chunkLen));
          for (let j = 0; j < chunkLen; j++) {
            dst[dstOff + j] = data[srcOff + j];
          }
        }
        break;
      }

      default: { // Mode 0: Block displacement
        for (let op = 0; op < numOps; op++) {
          const bx = Math.floor(rand() * width);
          const by = Math.floor(rand() * height);
          const bw = Math.floor(blockSize / 2 + rand() * blockSize);
          const bh = Math.floor(blockSize / 2 + rand() * blockSize);
          const shiftX = Math.round((rand() - 0.5) * 2 * blockSize * intensity);
          const shiftY = Math.round((rand() - 0.5) * 2 * blockSize * intensity);

          for (let y = by; y < Math.min(by + bh, height); y++) {
            for (let x = bx; x < Math.min(bx + bw, width); x++) {
              const sx = clamp(x + shiftX, 0, width - 1);
              const sy = clamp(y + shiftY, 0, height - 1);
              const dstIdx = (y * width + x) * 4;
              const srcIdx = (sy * width + sx) * 4;
              dst[dstIdx] = data[srcIdx];
              dst[dstIdx + 1] = data[srcIdx + 1];
              dst[dstIdx + 2] = data[srcIdx + 2];
            }
          }
        }
        break;
      }
    }

    return out;
  },
};

export const moshDef: EffectToolDef = {
  effect: moshEffect,
  sliders: [
    { key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, defaultValue: 50, hint: 'How corrupted the output looks' },
    { key: 'blockSize', label: 'Block Size', min: 4, max: 64, step: 2, defaultValue: 16, hint: 'Size of displaced blocks' },
  ],
  modes: [
    { key: 'mode', modes: ['Block Shift', 'Row Glitch', 'Byte Corrupt'], defaultIndex: 0 },
  ],
};
```

**Step 2: Commit**

```
feat: add mosh effect
```

---

## Phase 3: Integration

### Task 16: Update canvas.ts for effect stacking

The canvas manager needs a `setSourceImage` method so that when an effect is "applied", the processed result becomes the new source.

**Files:**
- Modify: `src/canvas.ts`

**Step 1: Add `setSourceImage` and `getOriginalSource` to canvas.ts**

Add a new private `originalSource` variable and two new public methods:

```typescript
let originalSource: ImageData | null = null;
```

In `loadImageFile`, after `sourceImage = ctx.getImageData(...)`, add:
```typescript
originalSource = sourceImage;
```

Add to the return object:
```typescript
function setSourceImage(imageData: ImageData): void {
  sourceImage = imageData;
  displayImageData(imageData);
}

function getOriginalSource(): ImageData | null {
  return originalSource;
}

function resetToOriginal(): void {
  if (originalSource) {
    sourceImage = originalSource;
    displayImageData(originalSource);
  }
}
```

Update return: `{ getSourceImage, displayImageData, getCanvas, setSourceImage, getOriginalSource, resetToOriginal }`

**Step 2: Commit**

```
feat: add setSourceImage and resetToOriginal to canvas manager
```

---

### Task 17: Update index.html navigation

**Files:**
- Modify: `index.html`

**Step 1: Replace the nav section**

Replace `index.html:22-29` (the `<nav>` element contents) with:

```html
<nav class="nav" id="tool-nav">
  <a class="nav-item active" data-tool="deepdream">DeepDream</a>
  <a class="nav-item" data-tool="style-transfer">Style Transfer</a>
  <a class="nav-item" data-tool="threshold">Threshold</a>
  <a class="nav-item" data-tool="channel-shift">Channel Shift</a>
  <a class="nav-item" data-tool="lcd">LCD</a>
  <a class="nav-item" data-tool="burn">Burn</a>
  <a class="nav-item" data-tool="pixlt">PIXLT</a>
  <a class="nav-item" data-tool="fill">Fill</a>
  <a class="nav-item" data-tool="gradient">Gradient</a>
  <a class="nav-item" data-tool="mosh">Mosh</a>
</nav>
```

Also update the version: `<span class="version">v0.3.0</span>`

**Step 2: Commit**

```
feat: update nav with all 10 tools, remove coming-soon placeholders
```

---

### Task 18: Update main.ts to register all tools

**Files:**
- Modify: `src/main.ts`

**Step 1: Add imports and register all effect tools**

Add at top of file:
```typescript
import { createEffectTool } from './effects/effect-tool.ts';
import { thresholdDef } from './effects/threshold.ts';
import { channelShiftDef } from './effects/channel-shift.ts';
import { lcdDef } from './effects/lcd.ts';
import { burnDef } from './effects/burn.ts';
import { pixltDef } from './effects/pixlt.ts';
import { fillDef } from './effects/fill.ts';
import { gradientDef } from './effects/gradient.ts';
import { moshDef } from './effects/mosh.ts';
```

After registering `styleTool`, add:

```typescript
// ---------------------------------------------------------------------------
// Pixel effect tools (no model loading needed)
// ---------------------------------------------------------------------------

const effectCallbacks = {
  getSourceImage: () => canvasManager.getSourceImage(),
  displayImageData: (img: ImageData) => canvasManager.displayImageData(img),
  onApply: (newSource: ImageData) => canvasManager.setSourceImage(newSource),
  onReset: () => canvasManager.resetToOriginal(),
};

const effectDefs = [thresholdDef, channelShiftDef, lcdDef, burnDef, pixltDef, fillDef, gradientDef, moshDef];

for (const def of effectDefs) {
  router.register(createEffectTool(def, effectCallbacks));
}
```

**Step 2: Update model swap logic**

The nav click listener for model swapping (lines 326-354) needs to only swap models for deepdream/style-transfer, not for glitch tools. The current code already handles this since it checks `toolId === 'style-transfer'` and `toolId === 'deepdream'`. However, when switching FROM a ML tool TO a glitch tool, we should dispose models to free GPU memory.

Add an else branch after the existing `toolId === 'deepdream'` check:

```typescript
else if (toolId !== 'style-transfer' && toolId !== 'deepdream') {
  // Switching to a glitch tool — free GPU memory if models are loaded
  if (model) {
    console.log('[model-swap] Disposing InceptionV3 for glitch tool');
    model.dispose();
    model = null;
    modelReady = false;
    window.__cvlt.model = null;
  }
  if (styleModel) {
    console.log('[model-swap] Disposing style models for glitch tool');
    styleModel.dispose();
    styleModel = null;
    styleModelReady = false;
    styleModelLoading = false;
    window.__cvlt.styleModel = null;
  }
}
```

**Step 3: Update readiness for glitch tools**

Glitch tools only need `imageReady` to enable the Apply button. The `cvlt:image-loaded` listener should also enable glitch tools:

```typescript
window.addEventListener('cvlt:image-loaded', () => {
  console.log('Image loaded — source ready');
  imageReady = true;
  updateDreamButton();
  updateStylizeButton();

  // Enable all currently active effect tools
  const active = router.getActiveTool();
  if (active && active.id !== 'deepdream' && active.id !== 'style-transfer') {
    // The effect tool's setActionEnabled is called through ToolControls
    // This is handled automatically by the effect-tool factory checking for source
  }
});
```

Actually, the effect-tool factory already calls `callbacks.getSourceImage()` on panel creation and on every refresh. The Apply button is controlled by the `setActionEnabled` method. We need a way to enable it when the image loads.

Add after the effect registration loop:
```typescript
// Enable effect tool Apply buttons when image loads
window.addEventListener('cvlt:image-loaded', () => {
  // Re-activate current tool to pick up new source
  const active = router.getActiveTool();
  if (active) {
    const toolId = active.id;
    if (toolId !== 'deepdream' && toolId !== 'style-transfer') {
      router.activate(toolId);
    }
  }
});
```

Wait — this would destroy and rebuild the tool. Better approach: the effect-tool factory should listen for the event itself, or main.ts should call setActionEnabled. Let's keep it simple and have main.ts track this:

Replace the above with just updating the existing `cvlt:image-loaded` handler to also update effect tools. The simplest way: have the router re-activate. But actually, the `activate` method skips if already active (`if (activeTool?.id === toolId) return;`). We need to either change that or take a different approach.

Simplest approach: The effect-tool's `createRightPanel` already checks for source on creation. When the image loads after the panel is already built, we just need to call `setActionEnabled(true)`. Store a reference:

In the registration loop, store references:

```typescript
const effectTools: Tool[] = [];
for (const def of effectDefs) {
  const tool = createEffectTool(def, effectCallbacks);
  router.register(tool);
  effectTools.push(tool);
}
```

In the `cvlt:image-loaded` handler, add logic to find the active tool's controls:
Actually this is getting complicated. The cleanest approach: have the effect-tool listen for `cvlt:image-loaded` directly within `createRightPanel`, and call refresh + enable.

Add to `effect-tool.ts`'s `createRightPanel`, after the initial render block:

```typescript
function onImageLoaded(): void {
  actionEnabled = true;
  applyBtn.disabled = false;
  refresh();
}
window.addEventListener('cvlt:image-loaded', onImageLoaded);
```

And in the `destroy` method:
```typescript
window.removeEventListener('cvlt:image-loaded', onImageLoaded);
```

**Step 4: Commit**

```
feat: register all 8 effect tools in main.ts with model swap support
```

---

### Task 19: CSS additions

**Files:**
- Modify: `src/style.css`

**Step 1: Remove `.coming-soon` and `.nav-item.disabled` styles**

Remove these CSS rules since there are no more disabled/coming-soon nav items:
- `.nav-item.disabled` (line 119-121)
- `.nav-item.disabled:hover` (line 123-125)
- `.nav-item .coming-soon` (line 127-131)

**Step 2: Add `.effect-progress` style**

Add before the pulse animation section:

```css
/* === Effect Progress (in right panel, not overlaying canvas) === */
.effect-progress {
  padding: 12px 0;
}
```

**Step 3: Commit**

```
feat: update CSS for glitch effect tools
```

---

### Task 20: Verify everything compiles

**Step 1:** Run `npx tsc --noEmit` from the project root. Fix any type errors.

**Step 2:** Start the dev server and verify:
- All 10 nav items appear and are clickable
- Switching between tools works (no JS errors)
- DeepDream and Style Transfer still work
- Load an image, switch to Threshold — slider changes preview
- Test LCD with interactive mode — drag on canvas
- Test PIXLT with interactive brush mode
- Verify tonal targeting sliders appear on all glitch tools
- Test Apply → switch tool → stack effects
- Test Reset → goes back to original

**Step 3: Commit**

```
feat: glitch effects suite v0.3.0 — verified working
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| **1** | 1-7 | Shared infrastructure: UI helpers, types, compositor, brush, tonal, tonal controls, effect-tool factory |
| **2** | 8-15 | 8 effects: Threshold, Channel Shift, LCD, Burn, PIXLT, Fill, Gradient, Mosh |
| **3** | 16-20 | Integration: canvas.ts update, nav update, main.ts registration, CSS, verification |

**Total new files:** 16
**Modified files:** 5 (canvas.ts, main.ts, index.html, style.css, deepdream-controls.ts, style-transfer/controls.ts)
**No new dependencies.**

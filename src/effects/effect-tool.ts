/**
 * Generic effect tool factory — wraps any PixelEffect into a full Tool.
 */

import type { Tool, ToolControls } from '../router.ts';
import type { EffectToolDef, EffectConfig } from './types.ts';
import { createCompositor } from './compositor.ts';
import { createBrushController } from './brush.ts';
import { createTonalControls } from './tonal-controls.ts';
import { computeTonalMask } from './tonal.ts';
import { createSlider, createModeToggle, createSectionLabel } from './ui-helpers.ts';

export interface EffectToolCallbacks {
  getSourceImage: () => ImageData | null;
  displayImageData: (imageData: ImageData) => void;
  onApply: (newSource: ImageData) => void;
  onReset: () => void;
}

export function createEffectTool(
  def: EffectToolDef,
  callbacks: EffectToolCallbacks,
): Tool {
  const { effect, sliders, modes } = def;
  const supportsInteractive = def.supportsInteractive ?? effect.interactionType !== 'none';
  const dragMapping = def.dragMapping ?? '1d';
  const stackingBrush = def.stackingBrush ?? false;

  const compositor = createCompositor();
  const brush = createBrushController();
  const tonalCtrl = createTonalControls();

  let isInteractiveMode = false;
  let getConfigFn: (() => EffectConfig) | null = null;
  let rafId = 0;

  // Persist slider/mode values across tool switches
  let savedConfig: EffectConfig | null = null;
  let savedOpacity = 100;

  // Global opacity slider reference (accessible from refresh)
  let opacityInput: HTMLInputElement | null = null;

  // For directional drag → slider sync
  let primarySliderInput: HTMLInputElement | null = null;
  let primarySliderValueEl: HTMLSpanElement | null = null;
  let dragBaseValue = 0;
  // Track last direction for 2D injection
  let lastDir = { x: 0, y: 0 };
  // Drag-bound slider references (accessible from refresh)
  const dragBoundInputs: Record<string, HTMLInputElement> = {};
  const dragBoundValueEls: Record<string, HTMLSpanElement> = {};
  // All slider references (accessible from refresh for intensity sync)
  const allSliderInputs: Record<string, HTMLInputElement> = {};
  const allSliderValueEls: Record<string, HTMLSpanElement> = {};
  // Brush mask history — managed here because the compositor's interactiveMask
  // gets overwritten by brush.getMask() every refresh, making compositor undo useless.
  const brushHistory: Float32Array[] = [];
  // Source image history — for stacking brush effects that auto-bake each stroke.
  // Undo restores the previous source (before the stroke was baked in).
  const sourceHistory: ImageData[] = [];
  // Snapshot of source when tool mounted, so Reset can fully revert stacking bakes.
  let initialSource: ImageData | null = null;
  // Whether the user explicitly clicked Apply — stacking brush auto-bakes on each
  // stroke, but switching tools without Apply should revert to initialSource.
  let userApplied = false;
  // Last image displayed on canvas — Apply commits exactly what the user sees
  // (includes tonal masking applied outside the compositor).
  let lastDisplayedOutput: ImageData | null = null;
  // After Apply, suppress re-rendering until the user moves a slider, changes
  // a mode, or interacts with the canvas.  Prevents the "double-stack" where
  // the same effect immediately re-applies on top of the freshly baked source.
  let effectSuppressed = false;

  function refresh(): void {
    if (window.__cvlt?.srcActive) return;
    const source = callbacks.getSourceImage();
    if (!source || !getConfigFn) return;

    // After Apply, stay dormant — show the baked source, don't re-render.
    if (effectSuppressed) {
      callbacks.displayImageData(source);
      return;
    }

    compositor.setSource(source);

    // Directional drag ↔ slider sync
    // Only overwrite sliders from brush direction while actively dragging.
    // When the user adjusts sliders manually, those values are the source of truth.
    // Directional drag ↔ slider sync also fires for point-fill in Full Image mode,
    // where the brush switches to 'directional' so dragging controls tolerance.
    const isDirectionalDrag = (isInteractiveMode && effect.interactionType === 'directional')
      || (!isInteractiveMode && effect.interactionType === 'point-fill');
    if (isDirectionalDrag) {
      if (brush.isDragging()) {
        const dir = brush.getDirection();
        lastDir = dir;

        if (dragMapping === '2d') {
          // 2D: update drag-bound sliders (X, Y) from drag position
          for (const sliderDef of sliders) {
            if (sliderDef.dragBind && dragBoundInputs[sliderDef.key]) {
              const raw = sliderDef.dragBind === 'x' ? dir.x : dir.y;
              const clamped = Math.max(sliderDef.min, Math.min(sliderDef.max, raw));
              const step = sliderDef.step || 1;
              const snapped = Math.round(clamped / step) * step;
              dragBoundInputs[sliderDef.key].value = String(snapped);
              dragBoundValueEls[sliderDef.key].textContent = String(snapped);
            }
          }

          // Map drag distance → intensity (first non-drag-bound slider).
          // Farther from center = more intense. Gives the canvas interaction
          // a unified feel — everything responds to the gesture, not just X/Y.
          const intensityDef = sliders.find(s => !s.dragBind && !s.noIntensityMap);
          if (intensityDef && allSliderInputs[intensityDef.key]) {
            const canvasEl = brush.getCanvas();
            const refDist = canvasEl
              ? Math.sqrt(canvasEl.width ** 2 + canvasEl.height ** 2) * 0.3
              : 300;
            const dist = Math.sqrt(dir.x ** 2 + dir.y ** 2);
            const raw = (dist / refDist) * intensityDef.max;
            const clamped = Math.max(intensityDef.min, Math.min(intensityDef.max, raw));
            const step = intensityDef.step || 1;
            const snapped = Math.round(clamped / step) * step;
            allSliderInputs[intensityDef.key].value = String(snapped);
            allSliderValueEls[intensityDef.key].textContent = String(snapped);
          }
        } else if (primarySliderInput) {
          // 1D: horizontal drag delta accumulates from dragBaseValue
          const canvasEl = brush.getCanvas() ?? document.getElementById('canvas') as HTMLCanvasElement | null;
          const canvasW = canvasEl?.width ?? 800;
          const sMin = parseFloat(primarySliderInput.min);
          const sMax = parseFloat(primarySliderInput.max);
          const range = sMax - sMin;
          const delta = (dir.x / canvasW) * range;
          const newVal = Math.max(sMin, Math.min(sMax, dragBaseValue + delta));
          const step = parseFloat(primarySliderInput.step) || 1;
          const snapped = Math.round(newVal / step) * step;
          primarySliderInput.value = String(snapped);
          if (primarySliderValueEl) primarySliderValueEl.textContent = String(snapped);
        }
      }
    }

    const config = getConfigFn();

    // For 2D effects without drag-bound sliders, inject directionX/Y (legacy)
    if (isInteractiveMode && dragMapping === '2d') {
      const hasDragBind = sliders.some(s => s.dragBind);
      if (!hasDragBind) {
        config['directionX'] = lastDir.x;
        config['directionY'] = lastDir.y;
      }
    }

    // Point-fill: inject the absolute click coordinates as seedX/seedY.
    // The brush stores these in its direction vector after a click.
    if (isInteractiveMode && effect.interactionType === 'point-fill') {
      const dir = brush.getDirection();
      config['seedX'] = dir.x;
      config['seedY'] = dir.y;
    }

    // For stacking brush in interactive mode, effect renders at full intensity —
    // the mask controls per-pixel blend. In full image mode, respect the slider.
    // Skip for point-fill: tolerance is a region-matching parameter, not intensity.
    if (stackingBrush && isInteractiveMode && sliders.length > 0
        && effect.interactionType !== 'point-fill') {
      config[sliders[0].key] = sliders[0].max;
    }

    compositor.setEffect(effect, config);

    if (isInteractiveMode
        && effect.interactionType !== 'directional'
        && effect.interactionType !== 'point-fill') {
      // When no painting has happened yet, pass a zero mask so the compositor
      // shows the source image — not the full effect. Without this, null mask
      // means "weight 1 everywhere" which causes a jarring jump when the first
      // brush stroke creates a fresh (all-zero) mask.
      const mask = brush.getMask();
      if (mask) {
        compositor.setInteractiveMask(mask);
      } else {
        compositor.setInteractiveMask(new Float32Array(source.width * source.height));
      }
    } else {
      compositor.setInteractiveMask(null);
    }

    // Tonal targeting is applied as a separate global pass, independent of the
    // brush mask.  This lets it work on stacking-brush effects even after strokes
    // have been baked into the source (where the brush mask is cleared to zero).
    compositor.setTonalMask(null);

    const output = compositor.composite();
    if (!output) return;

    // Global tonal pass — blend between a reference source and the composited
    // output.  For stacking brush the reference is initialSource (the image
    // before any strokes were baked), so adjusting tonal after painting still
    // masks the baked work.  For everything else, the reference is the current
    // source and the math is equivalent to the old iWeight*tWeight approach.
    const tonalConfig = tonalCtrl.getConfig();
    const tonalRef = (stackingBrush && initialSource) ? initialSource : source;
    const tonalMask = computeTonalMask(tonalRef, tonalConfig);

    if (tonalMask) {
      const dst = output.data;
      const ref = tonalRef.data;
      for (let i = 0; i < dst.length; i += 4) {
        const tw = tonalMask[i >> 2];
        if (tw >= 1) continue;          // fully in range — keep output as-is
        const inv = 1 - tw;
        dst[i]     = ref[i]     * inv + dst[i]     * tw;
        dst[i + 1] = ref[i + 1] * inv + dst[i + 1] * tw;
        dst[i + 2] = ref[i + 2] * inv + dst[i + 2] * tw;
      }
    }

    // Global opacity — blend effect output with source
    const opacity = opacityInput ? parseInt(opacityInput.value, 10) : 100;
    if (opacity < 100) {
      const dst = output.data;
      const src = source.data;
      const t = opacity / 100;
      const inv = 1 - t;
      for (let i = 0; i < dst.length; i += 4) {
        dst[i]     = src[i]     * inv + dst[i]     * t;
        dst[i + 1] = src[i + 1] * inv + dst[i + 1] * t;
        dst[i + 2] = src[i + 2] * inv + dst[i + 2] * t;
      }
    }

    callbacks.displayImageData(output);
    lastDisplayedOutput = output;
  }

  function debouncedRefresh(): void {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => refresh());
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
      controlsContainer.appendChild(createSectionLabel('Parameters'));

      // Mode toggles (effect modes like Split/Cross/Tri-angle)
      const modeGetters: Record<string, () => number> = {};
      const modeSetters: Record<string, (i: number) => void> = {};
      const modeGroups: HTMLDivElement[] = [];
      if (modes) {
        for (const modeDef of modes) {
          const { group, getMode, setMode } = createModeToggle(modeDef.modes, modeDef.defaultIndex ?? 0);
          modeGetters[modeDef.key] = getMode;
          modeSetters[modeDef.key] = setMode;
          group.style.marginBottom = '6px';
          modeGroups.push(group);
          controlsContainer.appendChild(group);
          group.addEventListener('click', () => { effectSuppressed = false; debouncedRefresh(); });
        }
      }

      // Interactive / Full Image toggle — right after mode, before sliders.
      // Directional effects are ALWAYS interactive — no toggle needed.
      let brushSizeGroup: HTMLDivElement | undefined;
      const showModeToggle = supportsInteractive && effect.interactionType !== 'directional';

      // Last mode group gets full margin if no interactive toggle follows
      if (modeGroups.length > 0 && !showModeToggle) {
        modeGroups[modeGroups.length - 1].style.marginBottom = '';
      }

      // Set interactive mode early so toggle buttons render with the correct state
      if (supportsInteractive) {
        isInteractiveMode = true;
      }

      if (showModeToggle) {
        const toggleGroup = document.createElement('div');
        toggleGroup.className = 'control-group';

        const interBtn = document.createElement('button');
        interBtn.className = 'btn btn-secondary';
        interBtn.style.flex = '1';
        interBtn.textContent = 'Interactive';

        const fullBtn = document.createElement('button');
        fullBtn.className = 'btn btn-secondary';
        fullBtn.style.flex = '1';
        fullBtn.textContent = 'Full Image';

        const toggleRow = document.createElement('div');
        toggleRow.style.display = 'flex';
        toggleRow.style.gap = '6px';

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
          effectSuppressed = false;
          // Point-fill in Full Image: switch to directional so drag controls tolerance
          brush.setInteractionType(effect.interactionType === 'point-fill' ? 'directional' : 'none');
          brush.clearMask();
          updateModeButtons();
          if (brushSizeGroup) brushSizeGroup.style.display = 'none';
          refresh();
        });

        interBtn.addEventListener('click', () => {
          isInteractiveMode = true;
          effectSuppressed = false;
          brush.setInteractionType(effect.interactionType);
          updateModeButtons();
          if (brushSizeGroup && (effect.interactionType === 'area-paint' || effect.interactionType === 'smear')) {
            brushSizeGroup.style.display = 'block';
          }
          refresh();
        });

        toggleRow.appendChild(interBtn);
        toggleRow.appendChild(fullBtn);
        toggleGroup.appendChild(toggleRow);
        controlsContainer.appendChild(toggleGroup);
        updateModeButtons();
      }

      // Effect-specific sliders
      const sliderInputs: Record<string, HTMLInputElement> = {};
      const sliderValueEls: Record<string, HTMLSpanElement> = {};
      const interactiveElements: (HTMLInputElement | HTMLSelectElement | HTMLButtonElement)[] = [];

      for (const sliderDef of sliders) {
        const { group, input, valueEl } = createSlider(
          sliderDef.label, sliderDef.min, sliderDef.max, sliderDef.step, sliderDef.defaultValue, sliderDef.hint,
        );
        sliderInputs[sliderDef.key] = input;
        sliderValueEls[sliderDef.key] = valueEl;
        // Store refs in outer scope so refresh() can update them
        allSliderInputs[sliderDef.key] = input;
        allSliderValueEls[sliderDef.key] = valueEl;
        if (sliderDef.dragBind) {
          dragBoundInputs[sliderDef.key] = input;
          dragBoundValueEls[sliderDef.key] = valueEl;
        }
        interactiveElements.push(input);
        const onSliderChange = (): void => {
          effectSuppressed = false;
          // When a drag-bound slider is changed manually, sync back to the brush
          // so the next drag starts from the current slider position.
          if (sliderDef.dragBind && effect.interactionType === 'directional') {
            const dir = brush.getDirection();
            const val = parseFloat(input.value);
            if (sliderDef.dragBind === 'x') {
              brush.setDirection(val, dir.y);
            } else {
              brush.setDirection(dir.x, val);
            }
          }
          debouncedRefresh();
        };
        input.addEventListener('input', onSliderChange);
        input.addEventListener('change', onSliderChange);
        controlsContainer.appendChild(group);
      }

      // Brush Size — grouped with other sliders (for area-paint / smear effects)
      if (supportsInteractive && (effect.interactionType === 'area-paint' || effect.interactionType === 'smear')) {
        const { group: bsGroup, input: brushSizeInput } = createSlider('Brush Size', 5, 200, 1, 50);
        brushSizeGroup = bsGroup;
        brushSizeInput.addEventListener('input', () => {
          brush.setBrushRadius(parseInt(brushSizeInput.value, 10));
        });
        // Hide when in Full Image mode
        if (showModeToggle && !isInteractiveMode) {
          brushSizeGroup.style.display = 'none';
        }
        controlsContainer.appendChild(brushSizeGroup);
      }

      // Global opacity slider
      const opacitySlider = createSlider('Opacity', 0, 100, 1, savedOpacity, 'Blend effect with original');
      opacityInput = opacitySlider.input;
      opacityInput.addEventListener('input', () => { effectSuppressed = false; debouncedRefresh(); });
      opacityInput.addEventListener('change', () => { effectSuppressed = false; debouncedRefresh(); });
      controlsContainer.appendChild(opacitySlider.group);

      // Track primary slider for directional drag sync.
      // Also set up for point-fill — in Full Image mode, drag controls tolerance.
      if (sliders.length > 0
          && (effect.interactionType === 'directional' || effect.interactionType === 'point-fill')) {
        primarySliderInput = sliderInputs[sliders[0].key];
        primarySliderValueEl = sliderValueEls[sliders[0].key];
        dragBaseValue = parseFloat(primarySliderInput.value);
      }

      // Build getConfig
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

      // Restore saved slider/mode values from previous session with this tool
      if (savedConfig) {
        for (const sliderDef of sliders) {
          if (savedConfig[sliderDef.key] != null) {
            const val = String(savedConfig[sliderDef.key]);
            sliderInputs[sliderDef.key].value = val;
            sliderValueEls[sliderDef.key].textContent = val;
          }
        }
        for (const [key, setMode] of Object.entries(modeSetters)) {
          if (savedConfig[key] != null) {
            setMode(savedConfig[key] as number);
          }
        }
      }

      // Interactive mode wiring (UI + isInteractiveMode already set above)
      if (supportsInteractive) {
        brush.setInteractionType(effect.interactionType);
        // Point-fill: start with sentinel (-1,-1) so no fill renders until first click.
        // Default direction (0,0) is a valid canvas coordinate and would fill from top-left.
        if (effect.interactionType === 'point-fill') {
          brush.setDirection(-1, -1);
        }
        // 2D effects use absolute direction (cursor-to-center, no reset between drags)
        if (dragMapping === '2d') {
          brush.setDirectionMode('absolute');
        }

        if (stackingBrush) {
          brush.setAdditive(true);
          // Wire first slider → brush intensity for area-paint stacking brush.
          // Skip for point-fill — tolerance is a region-matching param, not brush opacity.
          if (sliders.length > 0 && effect.interactionType !== 'point-fill') {
            const intensityInput = sliderInputs[sliders[0].key];
            const updateBrushIntensity = (): void => {
              const sMax = parseFloat(intensityInput.max) || 100;
              brush.setBrushIntensity(parseFloat(intensityInput.value) / sMax);
            };
            updateBrushIntensity();
            intensityInput.addEventListener('input', updateBrushIntensity);
          }
        }
      }

      // Tonal targeting
      tonalCtrl.mount(controlsContainer);
      tonalCtrl.onChange(() => { effectSuppressed = false; debouncedRefresh(); });
      interactiveElements.push(...tonalCtrl.getInteractiveElements());

      // Floating undo overlay on the canvas — appears when brush has history
      const undoOverlay = document.createElement('button');
      undoOverlay.className = 'canvas-undo-overlay';
      undoOverlay.title = 'Undo (⌘Z)';
      const undoSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      undoSvg.setAttribute('width', '16');
      undoSvg.setAttribute('height', '16');
      undoSvg.setAttribute('viewBox', '0 0 24 24');
      undoSvg.setAttribute('fill', 'none');
      undoSvg.setAttribute('stroke', 'currentColor');
      undoSvg.setAttribute('stroke-width', '2.5');
      undoSvg.setAttribute('stroke-linecap', 'round');
      undoSvg.setAttribute('stroke-linejoin', 'round');
      const undoPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      undoPath.setAttribute('d', 'M3 10h13a4 4 0 0 1 0 8H11');
      const undoArrow = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      undoArrow.setAttribute('points', '7 14 3 10 7 6');
      undoSvg.appendChild(undoPath);
      undoSvg.appendChild(undoArrow);
      undoOverlay.appendChild(undoSvg);
      undoOverlay.style.display = 'none';
      undoOverlay.addEventListener('click', () => {
        if (stackingBrush) {
          const prev = sourceHistory.pop();
          if (prev) {
            callbacks.onApply(prev);
            brush.clearMask();
            if (effect.interactionType === 'point-fill') brush.setDirection(-1, -1);
            refresh();
            updateUndoVisibility();
          }
        } else {
          const prev = brushHistory.pop();
          if (prev) {
            brush.setMask(prev);
            refresh();
            updateUndoVisibility();
          }
        }
      });
      canvasContainer.appendChild(undoOverlay);

      function updateUndoVisibility(): void {
        const hasHistory = stackingBrush ? sourceHistory.length > 0 : brushHistory.length > 0;
        undoOverlay.style.display = hasHistory ? '' : 'none';
      }

      // Action buttons
      const applyBtn = document.createElement('button');
      applyBtn.className = 'btn';
      applyBtn.style.flex = '1';
      applyBtn.style.background = '#4a7a5a';
      applyBtn.style.color = '#e8e8e8';
      applyBtn.style.borderColor = '#4a7a5a';
      applyBtn.textContent = 'Apply';
      applyBtn.disabled = true;
      applyBtn.addEventListener('mouseover', () => { if (!applyBtn.disabled) applyBtn.style.background = '#5a9a6a'; });
      applyBtn.addEventListener('mouseout', () => { applyBtn.style.background = '#4a7a5a'; });

      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn btn-secondary';
      resetBtn.style.flex = '1';
      resetBtn.textContent = 'Reset';

      applyBtn.addEventListener('click', () => {
        // Commit what the user sees — lastDisplayedOutput already includes the
        // global tonal pass, so it's the authoritative "what you see is what you get".
        const commit = lastDisplayedOutput;
        if (commit) {
          const img = new ImageData(new Uint8ClampedArray(commit.data), commit.width, commit.height);
          callbacks.onApply(img);
          initialSource = new ImageData(new Uint8ClampedArray(commit.data), commit.width, commit.height);
        } else {
          // Fallback — no tonal active, use compositor result directly
          compositor.apply();
          const newSource = compositor.getSource();
          if (newSource) {
            callbacks.onApply(newSource);
            initialSource = new ImageData(new Uint8ClampedArray(newSource.data), newSource.width, newSource.height);
          }
        }
        userApplied = true;
        effectSuppressed = true;
        brush.clearMask();
        brushHistory.length = 0;
        sourceHistory.length = 0;
        updateUndoVisibility();
        // Show the baked result without re-rendering the effect on top.
        const src = callbacks.getSourceImage();
        if (src) callbacks.displayImageData(src);
      });

      resetBtn.addEventListener('click', () => {
        // Clear the current effect preview (masks, history) but keep the source
        // as-is — Reset means "undo this effect", not "revert to original upload".
        brush.clearMask();
        brushHistory.length = 0;
        sourceHistory.length = 0;
        // For stacking brush, restore the source from before any strokes were baked
        if (stackingBrush && initialSource) {
          callbacks.onApply(new ImageData(
            new Uint8ClampedArray(initialSource.data), initialSource.width, initialSource.height,
          ));
        }
        updateUndoVisibility();
        const src = callbacks.getSourceImage();
        if (src) callbacks.displayImageData(src);
      });

      // Reset action bar layout (neural tools may have set it to column)
      actionBar.style.flexDirection = '';
      actionBar.appendChild(applyBtn);
      actionBar.appendChild(resetBtn);

      // Wire up brush controller
      const canvas = canvasContainer.querySelector('canvas') as HTMLCanvasElement | null;
      if (canvas) {
        brush.attach(canvas);
        brush.onChange(() => { effectSuppressed = false; debouncedRefresh(); });
        brush.onDragStart(() => {
          if (primarySliderInput) {
            dragBaseValue = parseFloat(primarySliderInput.value);
          }
          // Snapshot BEFORE the stroke so undo restores pre-stroke state.
          // For brush-based interactions and point-fill (each click bakes).
          const isBrush = effect.interactionType === 'area-paint'
            || effect.interactionType === 'smear'
            || effect.interactionType === 'point-fill';
          if (isBrush) {
            if (stackingBrush) {
              // Save source image — each stroke auto-bakes, so undo restores source
              const src = callbacks.getSourceImage();
              if (src) sourceHistory.push(new ImageData(new Uint8ClampedArray(src.data), src.width, src.height));
            } else {
              const currentMask = brush.getMask();
              brushHistory.push(currentMask ? new Float32Array(currentMask) : new Float32Array(0));
            }
          }
        });
        brush.onStrokeEnd(() => {
          // For stacking brush: auto-bake the stroke into the source so
          // changing parameters afterward doesn't affect already-painted areas.
          if (stackingBrush && isInteractiveMode) {
            refresh(); // Ensure compositor has latest mask state
            const result = compositor.composite();
            if (result) {
              callbacks.onApply(result);
              brush.clearMask();
            }
            // Point-fill: reset seed to sentinel so subsequent refreshes
            // don't re-apply the fill (the stroke is already baked).
            if (effect.interactionType === 'point-fill') {
              brush.setDirection(-1, -1);
            }
          }
          updateUndoVisibility();
        });
      }

      // Keyboard shortcuts
      function onKeyDown(e: KeyboardEvent): void {
        // Cmd+Z for undo
        const isBrush = effect.interactionType === 'area-paint'
          || effect.interactionType === 'smear'
          || effect.interactionType === 'point-fill';
        if ((e.metaKey || e.ctrlKey) && e.key === 'z' && isInteractiveMode && isBrush) {
          e.preventDefault();
          if (stackingBrush) {
            const prev = sourceHistory.pop();
            if (prev) {
              callbacks.onApply(prev);
              brush.clearMask();
              if (effect.interactionType === 'point-fill') brush.setDirection(-1, -1);
              refresh();
              updateUndoVisibility();
            }
          } else {
            const prev = brushHistory.pop();
            if (prev) {
              brush.setMask(prev);
              refresh();
              updateUndoVisibility();
            }
          }
        }
      }
      window.addEventListener('keydown', onKeyDown);

      // Enable Apply when image loads (including when user replaces the image)
      function onImageLoaded(): void {
        applyBtn.disabled = false;
        const src = callbacks.getSourceImage();
        if (src) {
          // Always update — user may have uploaded a new image while this tool is active.
          initialSource = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
          // Clear stale history from the previous image
          brushHistory.length = 0;
          sourceHistory.length = 0;
          brush.clearMask();
          if (effect.interactionType === 'point-fill') brush.setDirection(-1, -1);
          userApplied = false;
          effectSuppressed = false;
          updateUndoVisibility();
        }
        refresh();
      }
      window.addEventListener('cvlt:image-loaded', onImageLoaded);

      // Initial render if source exists
      const source = callbacks.getSourceImage();
      if (source) {
        applyBtn.disabled = false;
        initialSource = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
        compositor.setSource(source);
        refresh();
      }

      return {
        setActionEnabled(enabled: boolean): void {
          applyBtn.disabled = !enabled;
        },
        destroy(): void {
          // Save current slider/mode values so they persist across tool switches
          if (getConfigFn) savedConfig = getConfigFn();
          if (opacityInput) savedOpacity = parseInt(opacityInput.value, 10);
          cancelAnimationFrame(rafId);
          brush.detach();
          compositor.destroy();
          undoOverlay.remove();
          window.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('cvlt:image-loaded', onImageLoaded);
          getConfigFn = null;
          isInteractiveMode = false;
          // Stacking brush auto-bakes strokes into the source. If the user
          // switched away without clicking Apply, revert to the pre-tool snapshot.
          if (stackingBrush && !userApplied && initialSource) {
            callbacks.onApply(new ImageData(
              new Uint8ClampedArray(initialSource.data), initialSource.width, initialSource.height,
            ));
          }
          // Reset canvas to source (undo any unapplied effect preview)
          const src = callbacks.getSourceImage();
          if (src) callbacks.displayImageData(src);
        },
      };
    },
  };

  return tool;
}

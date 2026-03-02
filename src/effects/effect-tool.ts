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

  // For directional drag → slider sync
  let primarySliderInput: HTMLInputElement | null = null;
  let primarySliderValueEl: HTMLSpanElement | null = null;
  let dragBaseValue = 0;
  // Track last direction for 2D injection
  let lastDir = { x: 0, y: 0 };
  // Drag-bound slider references (accessible from refresh)
  const dragBoundInputs: Record<string, HTMLInputElement> = {};
  const dragBoundValueEls: Record<string, HTMLSpanElement> = {};
  // Brush mask history — managed here because the compositor's interactiveMask
  // gets overwritten by brush.getMask() every refresh, making compositor undo useless.
  const brushHistory: Float32Array[] = [];
  // Source image history — for stacking brush effects that auto-bake each stroke.
  // Undo restores the previous source (before the stroke was baked in).
  const sourceHistory: ImageData[] = [];
  // Snapshot of source when tool mounted, so Reset can fully revert stacking bakes.
  let initialSource: ImageData | null = null;

  function refresh(): void {
    if (window.__cvlt?.srcActive) return;
    const source = callbacks.getSourceImage();
    if (!source || !getConfigFn) return;

    compositor.setSource(source);

    // Directional drag → slider sync
    if (isInteractiveMode && effect.interactionType === 'directional') {
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

    const config = getConfigFn();

    // For 2D effects without drag-bound sliders, inject directionX/Y (legacy)
    if (isInteractiveMode && dragMapping === '2d') {
      const hasDragBind = sliders.some(s => s.dragBind);
      if (!hasDragBind) {
        config['directionX'] = lastDir.x;
        config['directionY'] = lastDir.y;
      }
    }

    // For stacking brush in interactive mode, effect renders at full intensity —
    // the mask controls per-pixel blend. In full image mode, respect the slider.
    if (stackingBrush && isInteractiveMode && sliders.length > 0) {
      config[sliders[0].key] = sliders[0].max;
    }

    compositor.setEffect(effect, config);

    if (isInteractiveMode && effect.interactionType !== 'directional') {
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

    const tonalConfig = tonalCtrl.getConfig();
    compositor.setTonalMask(computeTonalMask(source, tonalConfig));

    const output = compositor.composite();
    if (output) {
      callbacks.displayImageData(output);
    }
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
      const modeGroups: HTMLDivElement[] = [];
      if (modes) {
        for (const modeDef of modes) {
          const { group, getMode } = createModeToggle(modeDef.modes, modeDef.defaultIndex ?? 0);
          modeGetters[modeDef.key] = getMode;
          group.style.marginBottom = '6px';
          modeGroups.push(group);
          controlsContainer.appendChild(group);
          group.addEventListener('click', () => debouncedRefresh());
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
          brush.setInteractionType('none');
          brush.clearMask();
          updateModeButtons();
          if (brushSizeGroup) brushSizeGroup.style.display = 'none';
          refresh();
        });

        interBtn.addEventListener('click', () => {
          isInteractiveMode = true;
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
        // Store drag-bound slider refs in outer scope so refresh() can update them
        if (sliderDef.dragBind) {
          dragBoundInputs[sliderDef.key] = input;
          dragBoundValueEls[sliderDef.key] = valueEl;
        }
        interactiveElements.push(input);
        input.addEventListener('input', () => debouncedRefresh());
        controlsContainer.appendChild(group);
      }

      // Brush Size — grouped with other sliders (for area-paint / smear effects)
      if (supportsInteractive && (effect.interactionType === 'area-paint' || effect.interactionType === 'smear')) {
        const { group: bsGroup, input: brushSizeInput } = createSlider('Brush Size', 5, 100, 1, 20);
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

      // Track primary slider for directional drag sync
      if (sliders.length > 0 && effect.interactionType === 'directional') {
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

      // Interactive mode wiring (UI + isInteractiveMode already set above)
      if (supportsInteractive) {
        brush.setInteractionType(effect.interactionType);
        // 2D effects use absolute direction (cursor-to-center, no reset between drags)
        if (dragMapping === '2d') {
          brush.setDirectionMode('absolute');
        }

        if (stackingBrush) {
          brush.setAdditive(true);
          if (sliders.length > 0) {
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
      tonalCtrl.onChange(() => debouncedRefresh());
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
        compositor.apply();
        const newSource = compositor.getSource();
        if (newSource) {
          callbacks.onApply(newSource);
          // Update initialSource so future Reset reverts to post-apply state
          initialSource = new ImageData(new Uint8ClampedArray(newSource.data), newSource.width, newSource.height);
        }
        brush.clearMask();
        brushHistory.length = 0;
        sourceHistory.length = 0;
        updateUndoVisibility();
        refresh();
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
        brush.onChange(() => debouncedRefresh());
        brush.onDragStart(() => {
          if (primarySliderInput) {
            dragBaseValue = parseFloat(primarySliderInput.value);
          }
          // Snapshot BEFORE the stroke so undo restores pre-stroke state.
          // Only for brush-based interactions (area-paint / smear), not directional.
          const isBrush = effect.interactionType === 'area-paint' || effect.interactionType === 'smear';
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
          }
          updateUndoVisibility();
        });
      }

      // Keyboard shortcuts
      function onKeyDown(e: KeyboardEvent): void {
        // Cmd+Z for undo
        const isBrush = effect.interactionType === 'area-paint' || effect.interactionType === 'smear';
        if ((e.metaKey || e.ctrlKey) && e.key === 'z' && isInteractiveMode && isBrush) {
          e.preventDefault();
          if (stackingBrush) {
            const prev = sourceHistory.pop();
            if (prev) {
              callbacks.onApply(prev);
              brush.clearMask();
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

      // Enable Apply when image loads
      function onImageLoaded(): void {
        applyBtn.disabled = false;
        const src = callbacks.getSourceImage();
        if (src && !initialSource) {
          initialSource = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
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
          cancelAnimationFrame(rafId);
          brush.detach();
          compositor.destroy();
          undoOverlay.remove();
          window.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('cvlt:image-loaded', onImageLoaded);
          getConfigFn = null;
          isInteractiveMode = false;
          // Reset canvas to source (undo any unapplied effect preview)
          const src = callbacks.getSourceImage();
          if (src) callbacks.displayImageData(src);
        },
      };
    },
  };

  return tool;
}

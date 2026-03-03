/**
 * Re-Dream tool — local effect randomizer.
 *
 * Chains random destruction effects with randomized parameters.
 * No API calls, no credits — runs entirely in-browser.
 *
 * Features:
 *   - Drag on canvas: horizontal = iterations, vertical = intensity
 *   - Post-processing: opacity blend + tonal targeting
 */

import type { Tool, ToolControls } from '../router.ts';
import type { RedreamOptions } from './redream-engine.ts';
import { createSlider, createSectionLabel, createDivider } from '../effects/ui-helpers.ts';
import { createTonalControls } from '../effects/tonal-controls.ts';
import { blendDreamResult } from './dream-blend.ts';

// ---------------------------------------------------------------------------
// Controls manager
// ---------------------------------------------------------------------------

export interface RedreamControlsManager {
  getConfig(): RedreamOptions;
  setRedreaming(active: boolean): void;
  setStatus(message: string): void;
  setProgress(status: string): void;
  setActionEnabled(enabled: boolean): void;
  setHasResult(has: boolean): void;
  /** Store source + result for post-blend controls. */
  setDreamImages(source: ImageData, dream: ImageData): void;
  /** Get the blended result (with opacity + tonal applied). */
  getBlendedResult(): ImageData | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRedreamTool(callbacks: {
  onRedream: () => void;
  onApply: () => void;
  onReset: () => void;
  displayImageData: (img: ImageData) => void;
}): Tool & { controls: RedreamControlsManager } {
  let iterationsInput: HTMLInputElement;
  let intensityInput: HTMLInputElement;
  let opacityInput: HTMLInputElement;
  let redreamBtn: HTMLButtonElement;
  let applyBtn: HTMLButtonElement;
  let resetBtn: HTMLButtonElement;
  let progressGroup: HTMLDivElement;
  let statusText: HTMLDivElement;
  let interactiveElements: (HTMLInputElement | HTMLButtonElement)[] = [];
  let imageLoaded = false;

  // Post-blend state
  const tonalCtrl = createTonalControls();
  let blendSource: ImageData | null = null;
  let blendDream: ImageData | null = null;

  // Drag state
  let dragStartX = 0;
  let dragStartY = 0;
  let dragging = false;
  let dragStartIter = 0;
  let dragStartIntensity = 0;

  /** Re-blend and display whenever opacity or tonal sliders change. */
  function refreshBlend(): void {
    if (!blendSource || !blendDream) return;
    const opacity = parseFloat(opacityInput?.value ?? '100') / 100;
    const tonalConfig = tonalCtrl.getConfig();
    const blended = blendDreamResult(blendSource, blendDream, opacity, tonalConfig);
    callbacks.displayImageData(blended);
  }

  const controls: RedreamControlsManager = {
    getConfig(): RedreamOptions {
      return {
        iterations: parseInt(iterationsInput.value, 10),
        intensity: parseInt(intensityInput.value, 10),
      };
    },

    setRedreaming(active: boolean): void {
      for (const el of interactiveElements) {
        el.disabled = active;
      }
      if (redreamBtn) redreamBtn.textContent = active ? 'Re-Dreaming\u2026' : 'Re-Dream';
      if (progressGroup) {
        progressGroup.style.display = active ? 'block' : 'none';
      }
      if (statusText && !active) {
        statusText.classList.remove('pulse');
      }
    },

    setStatus(message: string): void {
      if (progressGroup) {
        progressGroup.style.display = 'block';
        progressGroup.querySelector('.progress-bar')?.setAttribute('style', 'display:none');
      }
      if (statusText) {
        statusText.style.marginTop = '0';
        statusText.textContent = message;
        statusText.classList.remove('pulse');
      }
    },

    setProgress(status: string): void {
      if (progressGroup) progressGroup.style.display = 'block';
      if (statusText) {
        statusText.textContent = status;
        statusText.classList.add('pulse');
      }
    },

    setActionEnabled(enabled: boolean): void {
      if (redreamBtn) redreamBtn.disabled = !enabled;
    },

    setHasResult(has: boolean): void {
      if (applyBtn) applyBtn.disabled = !has;
      if (resetBtn) resetBtn.disabled = !has;
    },

    setDreamImages(source: ImageData, dream: ImageData): void {
      blendSource = source;
      blendDream = dream;
    },

    getBlendedResult(): ImageData | null {
      if (!blendSource || !blendDream) return null;
      const opacity = parseFloat(opacityInput?.value ?? '100') / 100;
      const tonalConfig = tonalCtrl.getConfig();
      return blendDreamResult(blendSource, blendDream, opacity, tonalConfig);
    },
  };

  function updateRedreamEnabled(): void {
    if (redreamBtn) {
      redreamBtn.disabled = !imageLoaded;
    }
  }

  function onImageLoaded(): void {
    imageLoaded = true;
    updateRedreamEnabled();
  }

  // ---- Drag handlers (canvas interaction) ----

  function onCanvasMouseDown(e: MouseEvent): void {
    if (!imageLoaded) return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartIter = parseInt(iterationsInput.value, 10);
    dragStartIntensity = parseInt(intensityInput.value, 10);
    e.preventDefault();
  }

  function onCanvasMouseMove(e: MouseEvent): void {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    // Horizontal drag → iterations (1-6)
    const iterDelta = Math.round(dx / 60);
    const newIter = Math.max(1, Math.min(6, dragStartIter + iterDelta));
    iterationsInput.value = String(newIter);
    // Update displayed value
    const iterVal = iterationsInput.parentElement?.querySelector('.value');
    if (iterVal) iterVal.textContent = String(newIter);

    // Vertical drag → intensity (0-100), inverted (drag up = more)
    const intDelta = Math.round(-dy / 2);
    const newInt = Math.max(0, Math.min(100, dragStartIntensity + intDelta));
    intensityInput.value = String(newInt);
    const intVal = intensityInput.parentElement?.querySelector('.value');
    if (intVal) intVal.textContent = String(newInt);
  }

  function onCanvasMouseUp(): void {
    if (!dragging) return;
    dragging = false;
    // Auto-trigger re-dream on drag release if params changed
    const curIter = parseInt(iterationsInput.value, 10);
    const curInt = parseInt(intensityInput.value, 10);
    if (curIter !== dragStartIter || curInt !== dragStartIntensity) {
      callbacks.onRedream();
    }
  }

  // ---- Tool interface ----

  const tool: Tool & { controls: RedreamControlsManager } = {
    id: 'redream',
    label: 'Re-Dream',
    controls,

    createLeftPanel(_container: HTMLElement): (() => void) | null {
      return null;
    },

    createRightPanel(
      controlsContainer: HTMLElement,
      actionBar: HTMLElement,
      canvasContainer: HTMLElement,
    ): ToolControls {
      // Listen for image loaded events
      window.addEventListener('cvlt:image-loaded', onImageLoaded);

      // Check if canvas already has an image
      const existingCanvas = canvasContainer.querySelector('canvas');
      if (existingCanvas && !existingCanvas.hidden) {
        imageLoaded = true;
      }

      // ---- Description ----
      controlsContainer.appendChild(createSectionLabel('Re-Dream'));

      const desc = document.createElement('div');
      desc.className = 'control-hint';
      desc.style.fontSize = '0.75rem';
      desc.style.marginBottom = '8px';
      desc.style.lineHeight = '1.4';
      desc.textContent = 'Chains random destruction effects with randomized parameters. Drag on the canvas to adjust iterations (horizontal) and intensity (vertical), then release to re-dream.';
      controlsContainer.appendChild(desc);

      controlsContainer.appendChild(createDivider());

      // ---- Parameters ----
      controlsContainer.appendChild(createSectionLabel('Parameters'));

      const { group: iterGroup, input: iInput } = createSlider(
        'Iterations', 1, 6, 1, 2,
        'How many effects to chain',
      );
      iterationsInput = iInput;
      controlsContainer.appendChild(iterGroup);

      const { group: intGroup, input: nInput } = createSlider(
        'Intensity', 0, 100, 5, 30,
        'How far from default values',
      );
      intensityInput = nInput;
      controlsContainer.appendChild(intGroup);

      // ---- Post-processing: Opacity + Tonal ----
      controlsContainer.appendChild(createDivider());
      controlsContainer.appendChild(createSectionLabel('Post-Processing'));

      const { group: opacityGroup, input: opInput } = createSlider(
        'Opacity', 0, 100, 1, 100,
        'Blend between source and re-dream result',
      );
      opacityInput = opInput;
      opacityInput.addEventListener('input', () => refreshBlend());
      controlsContainer.appendChild(opacityGroup);

      tonalCtrl.mount(controlsContainer);
      tonalCtrl.onChange(() => refreshBlend());

      // ---- Progress overlay ----
      progressGroup = document.createElement('div');
      progressGroup.className = 'progress-overlay';
      progressGroup.style.display = 'none';

      statusText = document.createElement('div');
      statusText.className = 'status-text';
      statusText.textContent = '';

      progressGroup.appendChild(statusText);
      canvasContainer.appendChild(progressGroup);

      // ---- Canvas drag interaction ----
      canvasContainer.style.cursor = 'crosshair';
      canvasContainer.addEventListener('mousedown', onCanvasMouseDown);
      window.addEventListener('mousemove', onCanvasMouseMove);
      window.addEventListener('mouseup', onCanvasMouseUp);

      // ---- Action buttons ----
      redreamBtn = document.createElement('button');
      redreamBtn.className = 'btn btn-primary btn-dream';
      redreamBtn.textContent = 'Re-Dream';
      redreamBtn.disabled = !imageLoaded;
      redreamBtn.addEventListener('click', () => callbacks.onRedream());

      applyBtn = document.createElement('button');
      applyBtn.className = 'btn';
      applyBtn.style.flex = '1';
      applyBtn.style.background = '#4a7a5a';
      applyBtn.style.color = '#e8e8e8';
      applyBtn.style.borderColor = '#4a7a5a';
      applyBtn.textContent = 'Apply';
      applyBtn.disabled = true;
      applyBtn.addEventListener('mouseover', () => { if (!applyBtn.disabled) applyBtn.style.background = '#5a9a6a'; });
      applyBtn.addEventListener('mouseout', () => { applyBtn.style.background = '#4a7a5a'; });
      applyBtn.addEventListener('click', () => callbacks.onApply());

      resetBtn = document.createElement('button');
      resetBtn.className = 'btn btn-secondary';
      resetBtn.style.flex = '1';
      resetBtn.textContent = 'Reset';
      resetBtn.disabled = true;
      resetBtn.addEventListener('click', () => callbacks.onReset());

      // Stack: full-width Re-Dream on top, Apply + Reset row below
      actionBar.style.flexDirection = 'column';

      actionBar.appendChild(redreamBtn);

      const subRow = document.createElement('div');
      subRow.style.display = 'flex';
      subRow.style.gap = '6px';
      subRow.appendChild(applyBtn);
      subRow.appendChild(resetBtn);
      actionBar.appendChild(subRow);

      // ---- Track interactive elements ----
      interactiveElements = [
        iterationsInput,
        intensityInput,
        opacityInput,
        ...tonalCtrl.getInteractiveElements(),
        redreamBtn,
        applyBtn,
        resetBtn,
      ];

      return {
        setActionEnabled(enabled: boolean): void {
          redreamBtn.disabled = !enabled;
        },

        destroy(): void {
          window.removeEventListener('cvlt:image-loaded', onImageLoaded);
          canvasContainer.removeEventListener('mousedown', onCanvasMouseDown);
          window.removeEventListener('mousemove', onCanvasMouseMove);
          window.removeEventListener('mouseup', onCanvasMouseUp);
          canvasContainer.style.cursor = '';
          if (progressGroup.parentElement) {
            progressGroup.parentElement.removeChild(progressGroup);
          }
          interactiveElements = [];
        },
      };
    },
  };

  return tool;
}

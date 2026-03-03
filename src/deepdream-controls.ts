/**
 * DeepDream tool — layer selector, parameter sliders, progress bar, and
 * action buttons, packaged as a Tool for the router system.
 */

import { DREAM_LAYERS } from './model.ts';
import type { DreamLayerName } from './model.ts';
import type { DreamConfig } from './deepdream.ts';
import type { Tool, ToolControls } from './router.ts';
import { createSlider, createDivider } from './effects/ui-helpers.ts';
import { createTonalControls } from './effects/tonal-controls.ts';
import { blendDreamResult } from './generate/dream-blend.ts';

// ---------------------------------------------------------------------------
// Re-exports for main.ts backward compatibility
// ---------------------------------------------------------------------------

export type { DreamConfig };

// ---------------------------------------------------------------------------
// Layer descriptions (human-readable labels for dropdown)
// ---------------------------------------------------------------------------

const LAYER_DESCRIPTIONS: Record<DreamLayerName, string> = {
  mixed0: 'Fine grain',
  mixed1: 'Small textures',
  mixed2: 'Woven patterns',
  mixed3: 'Tiled repeats',
  mixed4: 'Organic shapes',
  mixed5: 'Swirling forms',
  mixed6: 'Complex shapes',
  mixed7: 'Large structures',
  mixed8: 'Dense distortion',
  mixed9: 'Bold warping',
  mixed10: 'Maximum chaos',
};

// ---------------------------------------------------------------------------
// ControlsManager interface (backward-compatible for main.ts)
// ---------------------------------------------------------------------------

export interface ControlsManager {
  /** Return the current dream config from UI values. */
  getConfig(): DreamConfig;
  /** Toggle UI disabled state and update dream button text. */
  setDreaming(active: boolean): void;
  /** Register a callback for the Dream button. */
  onDream(callback: () => void): void;
  /** Register a callback for the Reset button. */
  onReset(callback: () => void): void;
  /** Update the progress bar and status text. */
  setProgress(step: number, total: number): void;
  /** Update the status text directly. */
  setStatus(message: string): void;
  /** Enable or disable the Dream button externally. */
  setDreamEnabled(enabled: boolean): void;
  /** Show/hide Apply + Reset based on whether a result exists. */
  setHasResult(has: boolean): void;
  /** Show model loading state in the layer dropdown. */
  setModelLoading(loading: boolean, message?: string): void;
  /** Store source + dream result for post-blend controls. */
  setDreamImages(source: ImageData, dream: ImageData): void;
  /** Get the blended result (with opacity + tonal applied). */
  getBlendedResult(): ImageData | null;
}

// ---------------------------------------------------------------------------
// Factory — creates a DeepDream Tool
// ---------------------------------------------------------------------------

export function createDeepDreamTool(callbacks: {
  onDream: () => void;
  onApply: () => void;
  onReset: () => void;
  displayImageData: (img: ImageData) => void;
}): Tool & { controls: ControlsManager } {
  // Internal state shared between createRightPanel calls and the
  // ControlsManager facade. These are set when createRightPanel builds the UI.
  let layerSelect: HTMLSelectElement;
  let selectWrapper: HTMLDivElement;
  let intensityInput: HTMLInputElement;
  let iterationsInput: HTMLInputElement;
  let octavesInput: HTMLInputElement;
  let opacityInput: HTMLInputElement;
  let dreamBtn: HTMLButtonElement;
  let applyBtn: HTMLButtonElement;
  let resetBtn: HTMLButtonElement;
  let progressGroup: HTMLDivElement;
  let progressFill: HTMLDivElement;
  let statusText: HTMLDivElement;
  let interactiveElements: (HTMLInputElement | HTMLSelectElement | HTMLButtonElement)[] = [];

  // Post-blend state
  const tonalCtrl = createTonalControls();
  let blendSource: ImageData | null = null;
  let blendDream: ImageData | null = null;

  /** Re-blend and display whenever opacity or tonal sliders change. */
  function refreshBlend(): void {
    if (!blendSource || !blendDream) return;
    const opacity = parseFloat(opacityInput?.value ?? '100') / 100;
    const tonalConfig = tonalCtrl.getConfig();
    const blended = blendDreamResult(blendSource, blendDream, opacity, tonalConfig);
    callbacks.displayImageData(blended);
  }

  // ---- ControlsManager (backward-compatible API for main.ts) ----

  const controls: ControlsManager = {
    getConfig(): DreamConfig {
      return {
        layers: [layerSelect.value as DreamLayerName],
        intensity: parseFloat(intensityInput.value),
        iterations: parseInt(iterationsInput.value, 10),
        octaves: parseInt(octavesInput.value, 10),
        octaveScale: 1.3,
      };
    },

    setDreaming(active: boolean): void {
      for (const el of interactiveElements) {
        el.disabled = active;
      }
      dreamBtn.textContent = active ? 'Dreaming\u2026' : 'Dream';
      progressGroup.style.display = active ? 'block' : 'none';
      if (active) {
        progressGroup.querySelector('.progress-bar')?.removeAttribute('style');
        statusText.style.marginTop = '';
        progressFill.style.width = '0%';
        statusText.textContent = 'Initializing\u2026';
        statusText.classList.add('pulse');
      } else {
        progressFill.style.width = '0%';
        statusText.textContent = '';
        statusText.classList.remove('pulse');
      }
    },

    onDream(_callback: () => void): void {
      // No-op — callbacks are wired through createDeepDreamTool arguments
    },

    onReset(_callback: () => void): void {
      // No-op — callbacks are wired through createDeepDreamTool arguments
    },

    setProgress(step: number, total: number): void {
      const pct = Math.round((step / total) * 100);
      progressFill.style.width = `${pct}%`;
      statusText.textContent = `Step ${step} / ${total}  (${pct}%)`;
    },

    setStatus(message: string): void {
      progressGroup.style.display = 'block';
      progressGroup.querySelector('.progress-bar')?.setAttribute('style', 'display:none');
      statusText.style.marginTop = '0';
      statusText.textContent = message;
      statusText.classList.remove('pulse');
    },

    setDreamEnabled(enabled: boolean): void {
      if (dreamBtn) dreamBtn.disabled = !enabled;
    },

    setHasResult(has: boolean): void {
      if (applyBtn) applyBtn.disabled = !has;
      if (resetBtn) resetBtn.disabled = !has;
    },

    setModelLoading(loading: boolean, message?: string): void {
      if (!selectWrapper) return;
      if (loading) {
        layerSelect.disabled = true;
        layerSelect.style.display = 'none';
        // Add or update the loading label
        let loadingLabel = selectWrapper.querySelector('.select-loading') as HTMLDivElement | null;
        if (!loadingLabel) {
          loadingLabel = document.createElement('div');
          loadingLabel.className = 'select-loading pulse';
          selectWrapper.insertBefore(loadingLabel, layerSelect);
        }
        loadingLabel.textContent = message || 'Loading model\u2026';
      } else {
        layerSelect.disabled = false;
        layerSelect.style.display = '';
        const loadingLabel = selectWrapper.querySelector('.select-loading');
        if (loadingLabel) loadingLabel.remove();
      }
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

  // ---- Tool interface ----

  const tool: Tool & { controls: ControlsManager } = {
    id: 'deepdream',
    label: 'DeepDream',
    controls,

    createLeftPanel(_container: HTMLElement): (() => void) | null {
      // DeepDream has no left panel content
      return null;
    },

    createRightPanel(
      controlsContainer: HTMLElement,
      actionBar: HTMLElement,
      canvasContainer: HTMLElement,
    ): ToolControls {
      // ---- Section label ----
      const sectionLabel = document.createElement('div');
      sectionLabel.className = 'section-label';
      sectionLabel.textContent = 'Parameters';
      controlsContainer.appendChild(sectionLabel);

      // ---- Layer select ----
      const layerGroup = document.createElement('div');
      layerGroup.className = 'control-group';

      layerSelect = document.createElement('select');
      for (const layer of DREAM_LAYERS) {
        const option = document.createElement('option');
        option.value = layer;
        option.textContent = `${layer} \u2014 ${LAYER_DESCRIPTIONS[layer]}`;
        if (layer === 'mixed0') {
          option.selected = true;
        }
        layerSelect.appendChild(option);
      }

      selectWrapper = document.createElement('div') as HTMLDivElement;
      selectWrapper.className = 'custom-select';
      selectWrapper.appendChild(layerSelect);

      layerGroup.appendChild(selectWrapper);
      controlsContainer.appendChild(layerGroup);

      // ---- Intensity slider ----
      const { group: intensityGroup, input: iInput } = createSlider(
        'Intensity', 0.005, 0.15, 0.005, 0.02,
        'How hard each step pushes the pixels',
      );
      intensityInput = iInput;
      controlsContainer.appendChild(intensityGroup);

      // ---- Iterations slider ----
      const { group: iterationsGroup, input: itInput } = createSlider(
        'Iterations', 5, 100, 5, 20,
        'Number of gradient steps \u2014 more = deeper dream',
      );
      iterationsInput = itInput;
      controlsContainer.appendChild(iterationsGroup);

      // ---- Octaves slider ----
      const { group: octavesGroup, input: oInput } = createSlider(
        'Octaves', 1, 5, 1, 3,
        'Refinement passes that build up the effect',
      );
      octavesInput = oInput;
      controlsContainer.appendChild(octavesGroup);

      // ---- Post-processing: Opacity + Tonal ----
      controlsContainer.appendChild(createDivider());

      const postLabel = document.createElement('div');
      postLabel.className = 'section-label';
      postLabel.textContent = 'Post-Processing';
      controlsContainer.appendChild(postLabel);

      const { group: opacityGroup, input: opInput } = createSlider(
        'Opacity', 0, 100, 1, 100,
        'Blend between source and dream result',
      );
      opacityInput = opInput;
      opacityInput.addEventListener('input', () => refreshBlend());
      controlsContainer.appendChild(opacityGroup);

      tonalCtrl.mount(controlsContainer);
      tonalCtrl.onChange(() => refreshBlend());

      // ---- Progress bar (overlay inside canvas container) ----
      progressGroup = document.createElement('div');
      progressGroup.className = 'progress-overlay';
      progressGroup.style.display = 'none';

      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar';
      progressFill = document.createElement('div');
      progressFill.className = 'progress-bar-fill';
      progressFill.style.width = '0%';
      progressBar.appendChild(progressFill);

      statusText = document.createElement('div');
      statusText.className = 'status-text';
      statusText.textContent = '';

      progressGroup.appendChild(progressBar);
      progressGroup.appendChild(statusText);
      canvasContainer.appendChild(progressGroup);

      // ---- Action buttons: Dream (full-width), Apply + Reset (row below) ----
      actionBar.style.flexDirection = 'column';

      dreamBtn = document.createElement('button');
      dreamBtn.className = 'btn btn-primary btn-dream';
      dreamBtn.textContent = 'Dream';
      dreamBtn.disabled = true;
      dreamBtn.addEventListener('click', () => callbacks.onDream());

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

      actionBar.appendChild(dreamBtn);

      const subRow = document.createElement('div');
      subRow.style.display = 'flex';
      subRow.style.gap = '6px';
      subRow.appendChild(applyBtn);
      subRow.appendChild(resetBtn);
      actionBar.appendChild(subRow);

      // ---- Track interactive elements for disable-during-dream ----
      interactiveElements = [
        layerSelect,
        intensityInput,
        iterationsInput,
        octavesInput,
        opacityInput,
        ...tonalCtrl.getInteractiveElements(),
        dreamBtn,
        applyBtn,
        resetBtn,
      ];

      // ---- ToolControls ----
      return {
        setActionEnabled(enabled: boolean): void {
          dreamBtn.disabled = !enabled;
        },

        destroy(): void {
          // Remove progress overlay from canvas container
          if (progressGroup.parentElement) {
            progressGroup.parentElement.removeChild(progressGroup);
          }
          // controlsContainer and actionBar are cleared by the router
          interactiveElements = [];
        },
      };
    },
  };

  return tool;
}


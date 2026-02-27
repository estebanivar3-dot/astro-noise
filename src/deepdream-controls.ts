/**
 * DeepDream tool — layer selector, parameter sliders, progress bar, and
 * action buttons, packaged as a Tool for the router system.
 */

import { DREAM_LAYERS } from './model.ts';
import type { DreamLayerName } from './model.ts';
import type { DreamConfig } from './deepdream.ts';
import type { Tool, ToolControls } from './router.ts';
import { createSlider } from './effects/ui-helpers.ts';

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
}

// ---------------------------------------------------------------------------
// Factory — creates a DeepDream Tool
// ---------------------------------------------------------------------------

export function createDeepDreamTool(callbacks: {
  onDream: () => void;
  onReset: () => void;
}): Tool & { controls: ControlsManager } {
  // Internal state shared between createRightPanel calls and the
  // ControlsManager facade. These are set when createRightPanel builds the UI.
  let layerSelect: HTMLSelectElement;
  let intensityInput: HTMLInputElement;
  let iterationsInput: HTMLInputElement;
  let octavesInput: HTMLInputElement;
  let dreamBtn: HTMLButtonElement;
  let resetBtn: HTMLButtonElement;
  let progressGroup: HTMLDivElement;
  let progressFill: HTMLDivElement;
  let statusText: HTMLDivElement;
  let interactiveElements: (HTMLInputElement | HTMLSelectElement | HTMLButtonElement)[] = [];

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
      statusText.textContent = message;
      statusText.classList.remove('pulse');
    },

    setDreamEnabled(enabled: boolean): void {
      if (dreamBtn) dreamBtn.disabled = !enabled;
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

      const selectWrapper = document.createElement('div');
      selectWrapper.className = 'custom-select';
      selectWrapper.appendChild(layerSelect);

      layerGroup.appendChild(selectWrapper);
      controlsContainer.appendChild(layerGroup);

      // ---- Divider ----
      const divider = document.createElement('div');
      divider.className = 'control-divider';
      controlsContainer.appendChild(divider);

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

      // ---- Action buttons (Dream + Reset) ----
      dreamBtn = document.createElement('button');
      dreamBtn.className = 'btn btn-primary btn-dream';
      dreamBtn.textContent = 'Dream';
      dreamBtn.disabled = true;

      resetBtn = document.createElement('button');
      resetBtn.className = 'btn btn-secondary btn-dream';
      resetBtn.textContent = 'Reset';
      resetBtn.disabled = true;

      dreamBtn.addEventListener('click', () => callbacks.onDream());
      resetBtn.addEventListener('click', () => callbacks.onReset());

      actionBar.appendChild(dreamBtn);
      actionBar.appendChild(resetBtn);

      // ---- Track interactive elements for disable-during-dream ----
      interactiveElements = [
        layerSelect,
        intensityInput,
        iterationsInput,
        octavesInput,
        dreamBtn,
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


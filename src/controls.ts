/**
 * UI controls — layer selector, parameter sliders, progress bar, and action buttons.
 */

import { DREAM_LAYERS } from './model.ts';
import type { DreamLayerName } from './model.ts';
import type { DreamConfig } from './deepdream.ts';

// ---------------------------------------------------------------------------
// Layer descriptions (human-readable labels for dropdown)
// ---------------------------------------------------------------------------

const LAYER_DESCRIPTIONS: Record<DreamLayerName, string> = {
  mixed0: 'Edges and strokes',
  mixed1: 'Textures',
  mixed2: 'Complex textures',
  mixed3: 'Patterns and repeats',
  mixed4: 'Proto-eyes',
  mixed5: 'Swirls and spirals',
  mixed6: 'Faces emerge',
  mixed7: 'Animals and creatures',
  mixed8: 'High-level features',
  mixed9: 'Surreal objects',
  mixed10: 'Full hallucination',
};

// ---------------------------------------------------------------------------
// ControlsManager interface
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
// Factory
// ---------------------------------------------------------------------------

export function createControls(): ControlsManager {
  const container = document.getElementById('controls-container')!;
  const panelLeft = document.querySelector('.panel-left')!;

  // ---- Layer select ----

  const layerGroup = document.createElement('div');
  layerGroup.className = 'control-group';

  const layerLabel = document.createElement('div');
  layerLabel.className = 'control-label';
  const layerLabelText = document.createElement('span');
  layerLabelText.textContent = 'Layer';
  layerLabel.appendChild(layerLabelText);

  const layerSelect = document.createElement('select');
  for (const layer of DREAM_LAYERS) {
    const option = document.createElement('option');
    option.value = layer;
    option.textContent = `${layer} — ${LAYER_DESCRIPTIONS[layer]}`;
    if (layer === 'mixed3') {
      option.selected = true;
    }
    layerSelect.appendChild(option);
  }

  layerGroup.appendChild(layerLabel);
  layerGroup.appendChild(layerSelect);
  container.appendChild(layerGroup);

  // ---- Intensity slider ----

  const { group: intensityGroup, input: intensityInput } =
    createSlider('Intensity', 0.005, 0.15, 0.005, 0.02);
  container.appendChild(intensityGroup);

  // ---- Iterations slider ----

  const { group: iterationsGroup, input: iterationsInput } =
    createSlider('Iterations', 5, 100, 5, 20);
  container.appendChild(iterationsGroup);

  // ---- Octaves slider ----

  const { group: octavesGroup, input: octavesInput } =
    createSlider('Octaves', 1, 5, 1, 3);
  container.appendChild(octavesGroup);

  // ---- Progress bar ----

  const progressGroup = document.createElement('div');
  progressGroup.className = 'control-group';
  progressGroup.style.display = 'none';

  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar';
  const progressFill = document.createElement('div');
  progressFill.className = 'progress-bar-fill';
  progressFill.style.width = '0%';
  progressBar.appendChild(progressFill);

  const statusText = document.createElement('div');
  statusText.className = 'status-text';
  statusText.textContent = '';

  progressGroup.appendChild(progressBar);
  progressGroup.appendChild(statusText);
  container.appendChild(progressGroup);

  // ---- Action bar (Dream + Reset buttons) ----

  const actionBar = document.createElement('div');
  actionBar.className = 'action-bar';

  const dreamBtn = document.createElement('button');
  dreamBtn.className = 'btn btn-primary btn-dream';
  dreamBtn.textContent = 'Dream';
  dreamBtn.disabled = true;

  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn btn-dream';
  resetBtn.textContent = 'Reset';
  resetBtn.disabled = true;

  actionBar.appendChild(dreamBtn);
  actionBar.appendChild(resetBtn);
  panelLeft.appendChild(actionBar);

  // ---- Callbacks ----

  let dreamCallback: (() => void) | null = null;
  let resetCallback: (() => void) | null = null;

  dreamBtn.addEventListener('click', () => {
    if (dreamCallback) dreamCallback();
  });

  resetBtn.addEventListener('click', () => {
    if (resetCallback) resetCallback();
  });

  // ---- Helpers ----

  /** All interactive controls (inputs, selects, buttons) that should be
   *  disabled while dreaming. */
  const interactiveElements: (HTMLInputElement | HTMLSelectElement | HTMLButtonElement)[] = [
    layerSelect,
    intensityInput,
    iterationsInput,
    octavesInput,
    dreamBtn,
    resetBtn,
  ];

  // ---- Public API ----

  function getConfig(): DreamConfig {
    return {
      layers: [layerSelect.value as DreamLayerName],
      intensity: parseFloat(intensityInput.value),
      iterations: parseInt(iterationsInput.value, 10),
      octaves: parseInt(octavesInput.value, 10),
      octaveScale: 1.3,
    };
  }

  function setDreaming(active: boolean): void {
    for (const el of interactiveElements) {
      el.disabled = active;
    }

    dreamBtn.textContent = active ? 'Dreaming\u2026' : 'Dream';
    progressGroup.style.display = active ? 'block' : 'none';

    if (!active) {
      progressFill.style.width = '0%';
      statusText.textContent = '';
    }
  }

  function onDream(callback: () => void): void {
    dreamCallback = callback;
  }

  function onReset(callback: () => void): void {
    resetCallback = callback;
  }

  function setProgress(step: number, total: number): void {
    const pct = Math.round((step / total) * 100);
    progressFill.style.width = `${pct}%`;
    statusText.textContent = `Step ${step} / ${total}  (${pct}%)`;
  }

  function setStatus(message: string): void {
    progressGroup.style.display = 'block';
    statusText.textContent = message;
  }

  function setDreamEnabled(enabled: boolean): void {
    dreamBtn.disabled = !enabled;
  }

  return {
    getConfig,
    setDreaming,
    onDream,
    onReset,
    setProgress,
    setStatus,
    setDreamEnabled,
  };
}

// ---------------------------------------------------------------------------
// Slider helper
// ---------------------------------------------------------------------------

function createSlider(
  label: string,
  min: number,
  max: number,
  step: number,
  defaultValue: number,
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

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(defaultValue);

  input.addEventListener('input', () => {
    valueEl.textContent = input.value;
  });

  group.appendChild(labelRow);
  group.appendChild(input);

  return { group, input, valueEl };
}

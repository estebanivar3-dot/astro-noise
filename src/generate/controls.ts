/**
 * Generate tool — text-to-image via Hugging Face Inference API.
 *
 * Follows the same Tool interface pattern as Style Transfer:
 * factory function returns Tool & { controls }.
 */

import type { Tool, ToolControls } from '../router.ts';
import type { GenerateConfig } from './api.ts';
import { MODELS } from './api.ts';
import { createSlider, createSectionLabel, createDivider } from '../effects/ui-helpers.ts';
import { getStoredToken, buildTokenSection } from './token.ts';

// ---------------------------------------------------------------------------
// Controls manager interface
// ---------------------------------------------------------------------------

export interface GenerateControlsManager {
  getConfig(): GenerateConfig;
  setGenerating(active: boolean): void;
  setStatus(message: string): void;
  setProgress(status: string): void;
  setActionEnabled(enabled: boolean): void;
  hasToken(): boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createGenerateTool(callbacks: {
  onGenerate: () => void;
}): Tool & { controls: GenerateControlsManager } {
  // Internal state — set when panels are built
  let promptInput: HTMLTextAreaElement;
  let modelSelect: HTMLSelectElement;
  let customModelInput: HTMLInputElement;
  let customModelGroup: HTMLDivElement;
  let guidanceInput: HTMLInputElement;
  let stepsInput: HTMLInputElement;
  let generateBtn: HTMLButtonElement;
  let progressGroup: HTMLDivElement;
  let statusText: HTMLDivElement;
  let interactiveElements: (HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement)[] = [];

  // ---- Controls manager ----

  const controls: GenerateControlsManager = {
    getConfig(): GenerateConfig {
      const selectedModel = modelSelect.value;
      const model = selectedModel === '__custom__'
        ? customModelInput.value.trim()
        : selectedModel;

      const entry = MODELS.find((m) => m.id === selectedModel);

      return {
        prompt: promptInput.value,
        model: model || MODELS[0].id,
        token: getStoredToken() ?? '',
        guidance: parseFloat(guidanceInput.value),
        steps: parseInt(stepsInput.value, 10),
        provider: entry?.provider,
      };
    },

    setGenerating(active: boolean): void {
      for (const el of interactiveElements) {
        el.disabled = active;
      }
      if (generateBtn) generateBtn.textContent = active ? 'Generating\u2026' : 'Generate';
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
      if (generateBtn) generateBtn.disabled = !enabled;
    },

    hasToken(): boolean {
      return !!getStoredToken();
    },
  };

  function updateGenerateEnabled(): void {
    if (generateBtn) {
      generateBtn.disabled = !getStoredToken();
    }
  }

  // ---- Tool interface ----

  const tool: Tool & { controls: GenerateControlsManager } = {
    id: 'generate',
    label: 'Generate',
    controls,

    createLeftPanel(_container: HTMLElement): (() => void) | null {
      return null;
    },

    createRightPanel(
      controlsContainer: HTMLElement,
      actionBar: HTMLElement,
      canvasContainer: HTMLElement,
    ): ToolControls {
      // ---- API Token ----
      controlsContainer.appendChild(createSectionLabel('API Key'));
      buildTokenSection(controlsContainer, updateGenerateEnabled);

      controlsContainer.appendChild(createDivider());

      // ---- Prompt ----
      controlsContainer.appendChild(createSectionLabel('Prompt'));

      const promptGroup = document.createElement('div');
      promptGroup.className = 'control-group';

      promptInput = document.createElement('textarea');
      promptInput.rows = 3;
      promptInput.placeholder = 'Describe the image\u2026';
      promptInput.style.width = '100%';
      promptInput.style.fontFamily = 'inherit';
      promptInput.style.fontSize = '0.85rem';
      promptInput.style.padding = '8px';
      promptInput.style.background = 'var(--bg-element, #1a1a1a)';
      promptInput.style.color = 'inherit';
      promptInput.style.border = '1px solid var(--border, #333)';
      promptInput.style.borderRadius = '4px';
      promptInput.style.resize = 'vertical';
      promptInput.style.boxSizing = 'border-box';

      promptGroup.appendChild(promptInput);
      controlsContainer.appendChild(promptGroup);

      controlsContainer.appendChild(createDivider());

      // ---- Model ----
      controlsContainer.appendChild(createSectionLabel('Model'));

      const modelGroup = document.createElement('div');
      modelGroup.className = 'control-group';

      modelSelect = document.createElement('select');
      modelSelect.style.width = '100%';
      modelSelect.style.fontFamily = 'inherit';
      modelSelect.style.fontSize = '0.8rem';
      modelSelect.style.padding = '6px 8px';
      modelSelect.style.background = 'var(--bg-element, #1a1a1a)';
      modelSelect.style.color = 'inherit';
      modelSelect.style.border = '1px solid var(--border, #333)';
      modelSelect.style.borderRadius = '4px';

      for (const m of MODELS) {
        const opt = document.createElement('option');
        opt.value = m.id;
        const via = m.provider ? ` [${m.provider}]` : '';
        opt.textContent = `${m.label} \u2014 ${m.desc}${via}`;
        modelSelect.appendChild(opt);
      }

      const customOpt = document.createElement('option');
      customOpt.value = '__custom__';
      customOpt.textContent = 'Custom model ID\u2026';
      modelSelect.appendChild(customOpt);

      modelGroup.appendChild(modelSelect);

      // Custom model input (hidden by default)
      customModelGroup = document.createElement('div');
      customModelGroup.style.marginTop = '6px';
      customModelGroup.style.display = 'none';

      customModelInput = document.createElement('input');
      customModelInput.type = 'text';
      customModelInput.placeholder = 'org/model-name';
      customModelInput.style.width = '100%';
      customModelInput.style.fontFamily = 'inherit';
      customModelInput.style.fontSize = '0.8rem';
      customModelInput.style.padding = '4px 8px';
      customModelInput.style.background = 'var(--bg-element, #1a1a1a)';
      customModelInput.style.color = 'inherit';
      customModelInput.style.border = '1px solid var(--border, #333)';
      customModelInput.style.borderRadius = '4px';
      customModelInput.style.boxSizing = 'border-box';

      customModelGroup.appendChild(customModelInput);
      modelGroup.appendChild(customModelGroup);

      modelSelect.addEventListener('change', () => {
        customModelGroup.style.display = modelSelect.value === '__custom__' ? 'block' : 'none';
      });

      controlsContainer.appendChild(modelGroup);

      controlsContainer.appendChild(createDivider());

      // ---- Parameters ----
      controlsContainer.appendChild(createSectionLabel('Parameters'));

      const { group: guidanceGroup, input: gInput } = createSlider(
        'Guidance', 1, 20, 0.5, 7,
        'How closely to follow the prompt',
      );
      guidanceInput = gInput;
      controlsContainer.appendChild(guidanceGroup);

      const { group: stepsGroup, input: sInput } = createSlider(
        'Steps', 1, 50, 1, 20,
        'More steps = higher quality, slower',
      );
      stepsInput = sInput;
      controlsContainer.appendChild(stepsGroup);

      // ---- Progress overlay (inside canvas container) ----
      progressGroup = document.createElement('div');
      progressGroup.className = 'progress-overlay';
      progressGroup.style.display = 'none';

      statusText = document.createElement('div');
      statusText.className = 'status-text';
      statusText.textContent = '';

      progressGroup.appendChild(statusText);
      canvasContainer.appendChild(progressGroup);

      // ---- Action buttons ----
      generateBtn = document.createElement('button');
      generateBtn.className = 'btn btn-primary btn-dream';
      generateBtn.textContent = 'Generate';
      generateBtn.disabled = !getStoredToken();

      generateBtn.addEventListener('click', () => callbacks.onGenerate());

      actionBar.appendChild(generateBtn);

      // ---- Track interactive elements ----
      interactiveElements = [promptInput, modelSelect, customModelInput, guidanceInput, stepsInput, generateBtn];

      // ---- ToolControls ----
      return {
        setActionEnabled(enabled: boolean): void {
          generateBtn.disabled = !enabled;
        },

        destroy(): void {
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

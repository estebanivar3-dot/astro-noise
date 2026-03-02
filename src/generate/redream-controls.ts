/**
 * Re-Dream tool — local effect randomizer.
 *
 * Chains random destruction effects with randomized parameters.
 * No API calls, no credits — runs entirely in-browser.
 */

import type { Tool, ToolControls } from '../router.ts';
import type { RedreamOptions } from './redream-engine.ts';
import { createSlider, createSectionLabel, createDivider } from '../effects/ui-helpers.ts';

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
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRedreamTool(callbacks: {
  onRedream: () => void;
  onApply: () => void;
  onReset: () => void;
}): Tool & { controls: RedreamControlsManager } {
  let iterationsInput: HTMLInputElement;
  let intensityInput: HTMLInputElement;
  let redreamBtn: HTMLButtonElement;
  let applyBtn: HTMLButtonElement;
  let resetBtn: HTMLButtonElement;
  let progressGroup: HTMLDivElement;
  let statusText: HTMLDivElement;
  let interactiveElements: (HTMLInputElement | HTMLButtonElement)[] = [];
  let imageLoaded = false;

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
      desc.textContent = 'Chains random destruction effects with randomized parameters. Every click produces a unique result. Apply to lock it in.';
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

      // ---- Progress overlay ----
      progressGroup = document.createElement('div');
      progressGroup.className = 'progress-overlay';
      progressGroup.style.display = 'none';

      statusText = document.createElement('div');
      statusText.className = 'status-text';
      statusText.textContent = '';

      progressGroup.appendChild(statusText);
      canvasContainer.appendChild(progressGroup);

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
      interactiveElements = [iterationsInput, intensityInput, redreamBtn, applyBtn, resetBtn];

      return {
        setActionEnabled(enabled: boolean): void {
          redreamBtn.disabled = !enabled;
        },

        destroy(): void {
          window.removeEventListener('cvlt:image-loaded', onImageLoaded);
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

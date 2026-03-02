/**
 * Style Transfer tool — strength slider, action buttons, progress overlay,
 * and style-image picker, packaged as a Tool for the router system.
 */

import type { Tool, ToolControls } from '../router.ts';
import type { StyleConfig } from './stylize.ts';
import type { StylePicker } from './style-picker.ts';
import { createStylePicker } from './style-picker.ts';
import { createSlider } from '../effects/ui-helpers.ts';

// ---------------------------------------------------------------------------
// Controls manager interface (parallel to DeepDream's ControlsManager)
// ---------------------------------------------------------------------------

export interface StyleTransferControlsManager {
  /** Return the current style config from UI values. */
  getConfig(): StyleConfig;
  /** Toggle UI disabled state and update Stylize button text. */
  setStylizing(active: boolean): void;
  /** Register a callback for the Stylize button (no-op — wired via factory). */
  onStylize(callback: () => void): void;
  /** Register a callback for the Reset button (no-op — wired via factory). */
  onReset(callback: () => void): void;
  /** Update the status text directly. */
  setStatus(message: string): void;
  /** Update the progress bar fill (0-1 fraction). */
  setProgress(fraction: number): void;
  /** Enable or disable the Stylize button externally. */
  setActionEnabled(enabled: boolean): void;
  /** Set the Stylize button label (e.g. loading state, missing conditions). */
  setButtonLabel(label: string): void;
  /** Access the style picker (for reading the style image). */
  getStylePicker(): StylePicker | null;
  /** Show/hide Apply + Reset based on whether a result exists. */
  setHasResult(has: boolean): void;
}

// ---------------------------------------------------------------------------
// Factory — creates a Style Transfer Tool
// ---------------------------------------------------------------------------

export function createStyleTransferTool(callbacks: {
  onStylize: () => void;
  onApply: () => void;
  onReset: () => void;
}): Tool & { controls: StyleTransferControlsManager } {
  // Internal state — set when createRightPanel / createLeftPanel build the UI.
  let strengthInput: HTMLInputElement;
  let stylizeBtn: HTMLButtonElement;
  let applyBtn: HTMLButtonElement;
  let resetBtn: HTMLButtonElement;
  let progressGroup: HTMLDivElement;
  let progressFill: HTMLDivElement;
  let statusText: HTMLDivElement;
  let interactiveElements: (HTMLInputElement | HTMLButtonElement)[] = [];
  let stylePicker: StylePicker | null = null;

  // ---- Controls manager ----

  const controls: StyleTransferControlsManager = {
    getConfig(): StyleConfig {
      return {
        strength: parseFloat(strengthInput.value),
      };
    },

    setStylizing(active: boolean): void {
      for (const el of interactiveElements) {
        el.disabled = active;
      }
      if (stylizeBtn) stylizeBtn.textContent = active ? 'Stylizing\u2026' : 'Stylize';
      if (progressGroup) {
        progressGroup.style.display = active ? 'block' : 'none';
        if (!active && progressFill) {
          progressFill.style.width = '0%';
        }
      }
      if (statusText) {
        if (active) {
          progressGroup?.querySelector('.progress-bar')?.removeAttribute('style');
          statusText.style.marginTop = '';
          statusText.textContent = 'Stylizing\u2026';
          statusText.classList.add('pulse');
        } else {
          statusText.textContent = '';
          statusText.classList.remove('pulse');
        }
      }
    },

    onStylize(_callback: () => void): void {
      // No-op — callbacks are wired through createStyleTransferTool arguments
    },

    onReset(_callback: () => void): void {
      // No-op — callbacks are wired through createStyleTransferTool arguments
    },

    setStatus(message: string): void {
      if (progressGroup) {
        progressGroup.style.display = 'block';
        progressGroup.querySelector('.progress-bar')?.setAttribute('style', 'display:none');
      }
      if (statusText) {
        statusText.style.marginTop = '0';
        statusText.textContent = message;
      }
    },

    setProgress(fraction: number): void {
      if (progressFill) {
        progressFill.style.width = `${Math.round(fraction * 100)}%`;
      }
      if (statusText) {
        const pct = Math.round(fraction * 100);
        statusText.textContent = pct < 100 ? `Stylizing… ${pct}%` : 'Finalizing…';
      }
    },

    setActionEnabled(enabled: boolean): void {
      if (stylizeBtn) stylizeBtn.disabled = !enabled;
    },

    setButtonLabel(label: string): void {
      if (stylizeBtn) stylizeBtn.textContent = label;
    },

    getStylePicker(): StylePicker | null {
      return stylePicker;
    },

    setHasResult(has: boolean): void {
      if (applyBtn) applyBtn.disabled = !has;
      if (resetBtn) resetBtn.disabled = !has;
    },
  };

  // ---- Tool interface ----

  const tool: Tool & { controls: StyleTransferControlsManager } = {
    id: 'style-transfer',
    label: 'Style Transfer',
    controls,

    createLeftPanel(container: HTMLElement): (() => void) | null {
      stylePicker = createStylePicker(container, (_imageData: ImageData) => {
        // The parent (main.ts) handles readiness gating — nothing to do here
        // except dispatch a custom event so main.ts can react.
        window.dispatchEvent(new CustomEvent('cvlt:style-selected'));
      });

      return () => {
        if (stylePicker) {
          stylePicker.destroy();
          stylePicker = null;
        }
      };
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

      // ---- Strength slider ----
      const { group: strengthGroup, input: sInput } = createSlider(
        'Strength', 0.0, 1.0, 0.05, 1.0,
        'How much style to apply \u2014 0 = content only, 1 = full style',
      );
      strengthInput = sInput;
      controlsContainer.appendChild(strengthGroup);

      // ---- Progress overlay (inside canvas container) ----
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

      // ---- Action buttons: Stylize (full-width), Apply + Reset (row below) ----
      actionBar.style.flexDirection = 'column';

      stylizeBtn = document.createElement('button');
      stylizeBtn.className = 'btn btn-primary btn-dream';
      stylizeBtn.textContent = 'Stylize';
      stylizeBtn.disabled = true;
      stylizeBtn.addEventListener('click', () => callbacks.onStylize());

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

      actionBar.appendChild(stylizeBtn);

      const subRow = document.createElement('div');
      subRow.style.display = 'flex';
      subRow.style.gap = '6px';
      subRow.appendChild(applyBtn);
      subRow.appendChild(resetBtn);
      actionBar.appendChild(subRow);

      // ---- Track interactive elements for disable-during-stylize ----
      interactiveElements = [strengthInput, stylizeBtn, applyBtn, resetBtn];

      // ---- ToolControls ----
      return {
        setActionEnabled(enabled: boolean): void {
          stylizeBtn.disabled = !enabled;
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


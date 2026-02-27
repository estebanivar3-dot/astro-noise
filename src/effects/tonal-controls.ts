/**
 * Tonal targeting UI section — shared across all effect tools.
 */

import type { TonalConfig } from './tonal.ts';
import { createSlider, createSectionLabel, createDivider } from './ui-helpers.ts';

export interface TonalControls {
  getConfig(): TonalConfig;
  mount(container: HTMLElement): void;
  onChange(callback: () => void): void;
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

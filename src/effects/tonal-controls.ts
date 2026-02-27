/**
 * Tonal targeting UI section — shared across all effect tools.
 */

import type { TonalConfig } from './tonal.ts';
import { createSlider, createDivider } from './ui-helpers.ts';

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
  let shadowValueEl: HTMLSpanElement;
  let midtoneValueEl: HTMLSpanElement;
  let highlightValueEl: HTMLSpanElement;
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

      const headerRow = document.createElement('div');
      headerRow.style.display = 'flex';
      headerRow.style.justifyContent = 'space-between';
      headerRow.style.alignItems = 'center';
      headerRow.style.marginBottom = '16px';

      const label = document.createElement('div');
      label.className = 'section-label';
      label.style.marginBottom = '0';
      label.textContent = 'Tonal Targeting';

      const resetBtn = document.createElement('button');
      resetBtn.textContent = 'Reset';
      resetBtn.style.fontSize = '11px';
      resetBtn.style.padding = '2px 8px';
      resetBtn.style.background = 'transparent';
      resetBtn.style.border = '1px solid var(--border)';
      resetBtn.style.color = 'var(--fg-muted)';
      resetBtn.style.fontFamily = 'var(--font)';
      resetBtn.style.cursor = 'pointer';
      resetBtn.style.textTransform = 'uppercase';
      resetBtn.style.letterSpacing = '0.06em';
      resetBtn.addEventListener('click', () => {
        shadowInput.value = '1';
        midtoneInput.value = '1';
        highlightInput.value = '1';
        shadowValueEl.textContent = '1';
        midtoneValueEl.textContent = '1';
        highlightValueEl.textContent = '1';
        changeCallback?.();
      });

      headerRow.appendChild(label);
      headerRow.appendChild(resetBtn);
      container.appendChild(headerRow);

      const { group: sGroup, input: sInput, valueEl: sVal } = createSlider('Shadows', 0, 1, 0.05, 1);
      shadowInput = sInput;
      shadowValueEl = sVal;
      shadowInput.addEventListener('input', () => changeCallback?.());
      container.appendChild(sGroup);

      const { group: mGroup, input: mInput, valueEl: mVal } = createSlider('Midtones', 0, 1, 0.05, 1);
      midtoneInput = mInput;
      midtoneValueEl = mVal;
      midtoneInput.addEventListener('input', () => changeCallback?.());
      container.appendChild(mGroup);

      const { group: hGroup, input: hInput, valueEl: hVal } = createSlider('Highlights', 0, 1, 0.05, 1);
      highlightInput = hInput;
      highlightValueEl = hVal;
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

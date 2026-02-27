/**
 * Shared UI helpers for building tool control panels.
 */

export function createSlider(
  label: string,
  min: number,
  max: number,
  step: number,
  defaultValue: number,
  hint?: string,
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
  group.appendChild(labelRow);

  if (hint) {
    const hintEl = document.createElement('div');
    hintEl.className = 'control-hint';
    hintEl.textContent = hint;
    group.appendChild(hintEl);
  }

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(defaultValue);

  input.addEventListener('input', () => {
    valueEl.textContent = input.value;
  });

  group.appendChild(input);

  return { group, input, valueEl };
}

export function createModeToggle(
  modes: string[],
  defaultIndex: number = 0,
): { group: HTMLDivElement; getMode: () => number; setMode: (i: number) => void } {
  const group = document.createElement('div');
  group.className = 'control-group';

  const btn = document.createElement('button');
  btn.className = 'btn btn-secondary';
  btn.style.width = '100%';

  let currentIndex = defaultIndex;

  function update(): void {
    btn.textContent = `Mode ${currentIndex + 1}: ${modes[currentIndex]}`;
  }
  update();

  btn.addEventListener('click', () => {
    currentIndex = (currentIndex + 1) % modes.length;
    update();
  });

  group.appendChild(btn);

  return {
    group,
    getMode: () => currentIndex,
    setMode: (i: number) => { currentIndex = i; update(); },
  };
}

export function createSectionLabel(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'section-label';
  el.textContent = text;
  return el;
}

export function createDivider(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'control-divider';
  return el;
}

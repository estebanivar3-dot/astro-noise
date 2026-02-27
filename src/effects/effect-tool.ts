/**
 * Generic effect tool factory — wraps any PixelEffect into a full Tool.
 */

import type { Tool, ToolControls } from '../router.ts';
import type { EffectToolDef, EffectConfig } from './types.ts';
import { createCompositor } from './compositor.ts';
import { createBrushController } from './brush.ts';
import { createTonalControls } from './tonal-controls.ts';
import { computeTonalMask } from './tonal.ts';
import { createSlider, createModeToggle, createSectionLabel, createDivider } from './ui-helpers.ts';

export interface EffectToolCallbacks {
  getSourceImage: () => ImageData | null;
  displayImageData: (imageData: ImageData) => void;
  onApply: (newSource: ImageData) => void;
  onReset: () => void;
}

export function createEffectTool(
  def: EffectToolDef,
  callbacks: EffectToolCallbacks,
): Tool {
  const { effect, sliders, modes } = def;
  const supportsInteractive = def.supportsInteractive ?? effect.interactionType !== 'none';

  const compositor = createCompositor();
  const brush = createBrushController();
  const tonalCtrl = createTonalControls();

  let isInteractiveMode = false;
  let getConfigFn: (() => EffectConfig) | null = null;
  let rafId = 0;
  let showingOriginal = false;

  function refresh(): void {
    if (showingOriginal) return;
    const source = callbacks.getSourceImage();
    if (!source || !getConfigFn) return;

    compositor.setSource(source);
    const config = getConfigFn();

    if (isInteractiveMode && effect.interactionType === 'directional') {
      const dir = brush.getDirection();
      config['directionX'] = dir.x;
      config['directionY'] = dir.y;
    }

    compositor.setEffect(effect, config);

    if (isInteractiveMode && effect.interactionType !== 'directional') {
      compositor.setInteractiveMask(brush.getMask());
    } else {
      compositor.setInteractiveMask(null);
    }

    const tonalConfig = tonalCtrl.getConfig();
    compositor.setTonalMask(computeTonalMask(source, tonalConfig));

    const output = compositor.composite();
    if (output) {
      callbacks.displayImageData(output);
    }
  }

  function debouncedRefresh(): void {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => refresh());
  }

  const tool: Tool = {
    id: effect.id,
    label: effect.label,

    createLeftPanel(_container: HTMLElement): (() => void) | null {
      return null;
    },

    createRightPanel(
      controlsContainer: HTMLElement,
      actionBar: HTMLElement,
      canvasContainer: HTMLElement,
    ): ToolControls {
      controlsContainer.appendChild(createSectionLabel('Parameters'));

      // Mode toggles
      const modeGetters: Record<string, () => number> = {};
      if (modes) {
        for (const modeDef of modes) {
          const { group, getMode } = createModeToggle(modeDef.modes, modeDef.defaultIndex ?? 0);
          modeGetters[modeDef.key] = getMode;
          controlsContainer.appendChild(group);
          group.addEventListener('click', () => debouncedRefresh());
        }
      }

      // Effect-specific sliders
      const sliderInputs: Record<string, HTMLInputElement> = {};
      const interactiveElements: (HTMLInputElement | HTMLSelectElement | HTMLButtonElement)[] = [];

      for (const sliderDef of sliders) {
        const { group, input } = createSlider(
          sliderDef.label, sliderDef.min, sliderDef.max, sliderDef.step, sliderDef.defaultValue, sliderDef.hint,
        );
        sliderInputs[sliderDef.key] = input;
        interactiveElements.push(input);
        input.addEventListener('input', () => debouncedRefresh());
        controlsContainer.appendChild(group);
      }

      // Build getConfig
      getConfigFn = (): EffectConfig => {
        const config: EffectConfig = {};
        for (const sliderDef of sliders) {
          config[sliderDef.key] = parseFloat(sliderInputs[sliderDef.key].value);
        }
        for (const [key, getMode] of Object.entries(modeGetters)) {
          config[key] = getMode();
        }
        return config;
      };

      // Interactive mode toggle
      let brushSizeGroup: HTMLDivElement | undefined;

      if (supportsInteractive) {
        controlsContainer.appendChild(createDivider());
        controlsContainer.appendChild(createSectionLabel('Mode'));

        const modeGroup = document.createElement('div');
        modeGroup.className = 'control-group';

        const interBtn = document.createElement('button');
        interBtn.className = 'btn btn-secondary';
        interBtn.style.flex = '1';
        interBtn.textContent = 'Interactive';

        const fullBtn = document.createElement('button');
        fullBtn.className = 'btn btn-secondary';
        fullBtn.style.flex = '1';
        fullBtn.textContent = 'Full Image';

        const modeRow = document.createElement('div');
        modeRow.style.display = 'flex';
        modeRow.style.gap = '6px';

        function updateModeButtons(): void {
          fullBtn.style.background = !isInteractiveMode ? 'var(--fg)' : 'transparent';
          fullBtn.style.color = !isInteractiveMode ? 'var(--bg-dark)' : 'var(--fg-dim)';
          fullBtn.style.borderColor = !isInteractiveMode ? 'var(--fg)' : 'var(--border)';
          interBtn.style.background = isInteractiveMode ? 'var(--fg)' : 'transparent';
          interBtn.style.color = isInteractiveMode ? 'var(--bg-dark)' : 'var(--fg-dim)';
          interBtn.style.borderColor = isInteractiveMode ? 'var(--fg)' : 'var(--border)';
        }

        const { group: bsGroup, input: brushSizeInput } = createSlider('Brush Size', 5, 100, 1, 20);
        brushSizeGroup = bsGroup;
        brushSizeInput.addEventListener('input', () => {
          brush.setBrushRadius(parseInt(brushSizeInput.value, 10));
        });

        // Start in interactive mode by default
        isInteractiveMode = true;
        brush.setInteractionType(effect.interactionType);
        if (effect.interactionType === 'area-paint' || effect.interactionType === 'smear') {
          brushSizeGroup.style.display = 'block';
        } else {
          brushSizeGroup.style.display = 'none';
        }

        fullBtn.addEventListener('click', () => {
          isInteractiveMode = false;
          brush.setInteractionType('none');
          brush.clearMask();
          updateModeButtons();
          if (brushSizeGroup) brushSizeGroup.style.display = 'none';
          refresh();
        });

        interBtn.addEventListener('click', () => {
          isInteractiveMode = true;
          brush.setInteractionType(effect.interactionType);
          updateModeButtons();
          if (brushSizeGroup && (effect.interactionType === 'area-paint' || effect.interactionType === 'smear')) {
            brushSizeGroup.style.display = 'block';
          }
          refresh();
        });

        // Interactive first (left), Full Image second (right)
        modeRow.appendChild(interBtn);
        modeRow.appendChild(fullBtn);
        modeGroup.appendChild(modeRow);
        controlsContainer.appendChild(modeGroup);
        controlsContainer.appendChild(brushSizeGroup);

        updateModeButtons();
      }

      // Tonal targeting
      tonalCtrl.mount(controlsContainer);
      tonalCtrl.onChange(() => debouncedRefresh());
      interactiveElements.push(...tonalCtrl.getInteractiveElements());

      // Action buttons
      const applyBtn = document.createElement('button');
      applyBtn.className = 'btn btn-primary';
      applyBtn.style.flex = '1';
      applyBtn.textContent = 'Apply';
      applyBtn.disabled = true;

      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn btn-secondary';
      resetBtn.style.flex = '1';
      resetBtn.textContent = 'Reset';

      // Show Original button (hold to preview source)
      const origBtn = document.createElement('button');
      origBtn.className = 'btn btn-secondary';
      origBtn.style.flex = '0 0 auto';
      origBtn.style.padding = '14px 12px';
      origBtn.style.fontSize = '11px';
      origBtn.textContent = 'SRC';
      origBtn.title = 'Hold to show original (\\)';

      function showOriginal(): void {
        showingOriginal = true;
        const source = callbacks.getSourceImage();
        if (source) callbacks.displayImageData(source);
        origBtn.style.background = 'var(--fg)';
        origBtn.style.color = 'var(--bg-dark)';
      }

      function hideOriginal(): void {
        showingOriginal = false;
        origBtn.style.background = 'transparent';
        origBtn.style.color = 'var(--fg-dim)';
        refresh();
      }

      origBtn.addEventListener('mousedown', showOriginal);
      origBtn.addEventListener('mouseup', hideOriginal);
      origBtn.addEventListener('mouseleave', () => {
        if (showingOriginal) hideOriginal();
      });

      applyBtn.addEventListener('click', () => {
        compositor.apply();
        const newSource = compositor.getSource();
        if (newSource) {
          callbacks.onApply(newSource);
        }
        brush.clearMask();
        refresh();
      });

      resetBtn.addEventListener('click', () => {
        compositor.reset();
        brush.clearMask();
        callbacks.onReset();
      });

      actionBar.appendChild(applyBtn);
      actionBar.appendChild(origBtn);
      actionBar.appendChild(resetBtn);

      // Wire up brush controller
      const canvas = canvasContainer.querySelector('canvas') as HTMLCanvasElement | null;
      if (canvas) {
        brush.attach(canvas);
        brush.onChange(() => debouncedRefresh());
        brush.onStrokeEnd(() => compositor.pushHistory());
      }

      // Keyboard shortcuts
      function onKeyDown(e: KeyboardEvent): void {
        // Cmd+Z for undo
        if ((e.metaKey || e.ctrlKey) && e.key === 'z' && isInteractiveMode) {
          e.preventDefault();
          if (compositor.undo()) {
            refresh();
          }
        }
        // Backslash for show original
        if (e.key === '\\') {
          e.preventDefault();
          showOriginal();
        }
      }
      function onKeyUp(e: KeyboardEvent): void {
        if (e.key === '\\' && showingOriginal) {
          hideOriginal();
        }
      }
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);

      // Enable Apply when image loads
      function onImageLoaded(): void {
        applyBtn.disabled = false;
        refresh();
      }
      window.addEventListener('cvlt:image-loaded', onImageLoaded);

      // Initial render if source exists
      const source = callbacks.getSourceImage();
      if (source) {
        applyBtn.disabled = false;
        compositor.setSource(source);
        refresh();
      }

      return {
        setActionEnabled(enabled: boolean): void {
          applyBtn.disabled = !enabled;
        },
        destroy(): void {
          cancelAnimationFrame(rafId);
          brush.detach();
          compositor.destroy();
          window.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('keyup', onKeyUp);
          window.removeEventListener('cvlt:image-loaded', onImageLoaded);
          getConfigFn = null;
          isInteractiveMode = false;
          showingOriginal = false;
        },
      };
    },
  };

  return tool;
}

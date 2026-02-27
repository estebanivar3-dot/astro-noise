import './style.css';
import * as tf from '@tensorflow/tfjs';
import { createCanvasManager } from './canvas.ts';
import { loadDreamModel } from './model.ts';
import { createDeepDreamTool } from './deepdream-controls.ts';
import { createRouter } from './router.ts';
import { deepDream } from './deepdream.ts';
import { exportCanvas } from './export.ts';
import { createStyleTransferTool } from './style-transfer/controls.ts';
import { loadStyleTransferModel } from './style-transfer/model.ts';
import { stylizeImage } from './style-transfer/stylize.ts';
import type { DreamModel } from './model.ts';
import type { StyleTransferModel } from './style-transfer/model.ts';
import { createEffectTool } from './effects/effect-tool.ts';
import type { EffectToolCallbacks } from './effects/effect-tool.ts';
import { thresholdDef } from './effects/threshold.ts';
import { channelShiftDef } from './effects/channel-shift.ts';
import { lcdDef } from './effects/lcd.ts';
import { burnDef } from './effects/burn.ts';
import { pixltDef } from './effects/pixlt.ts';
import { fillDef } from './effects/fill.ts';
import { gradientDef } from './effects/gradient.ts';
import { moshDef } from './effects/mosh.ts';

declare global {
  interface Window {
    __cvlt: Record<string, unknown>;
  }
}

console.log('CVLT TOOLS loaded');

const canvasManager = createCanvasManager();

// ---------------------------------------------------------------------------
// Router setup
// ---------------------------------------------------------------------------

const nav = document.getElementById('tool-nav')!;
const leftContent = document.getElementById('left-panel-content')!;
const controlsContainer = document.getElementById('controls-container')!;
const actionBar = document.getElementById('action-bar')!;
const canvasContainer = document.getElementById('canvas-container')!;

const router = createRouter({
  nav,
  leftContent,
  controlsContainer,
  actionBar,
  canvasContainer,
});

// ---------------------------------------------------------------------------
// Track readiness — DeepDream: image + model
// ---------------------------------------------------------------------------

let imageReady = false;
let modelReady = false;
let model: DreamModel | null = null;

// ---------------------------------------------------------------------------
// DeepDream tool
// ---------------------------------------------------------------------------

const dreamTool = createDeepDreamTool({
  onDream: async () => {
    const sourceImage = canvasManager.getSourceImage();
    if (!sourceImage || !model) return;

    const config = dreamTool.controls.getConfig();
    dreamTool.controls.setDreaming(true);

    try {
      const totalSteps = config.octaves * config.iterations;

      const result = await deepDream(sourceImage, model, config, (progress) => {
        const step = progress.octave * config.iterations + progress.iteration + 1;
        dreamTool.controls.setProgress(step, totalSteps);
      });

      canvasManager.displayImageData(result);
      dreamTool.controls.setStatus('Dream complete');
    } catch (err) {
      console.error('DeepDream failed:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      dreamTool.controls.setStatus(`Error: ${message}`);
    } finally {
      dreamTool.controls.setDreaming(false);
    }
  },

  onReset: () => {
    const sourceImage = canvasManager.getSourceImage();
    if (sourceImage) {
      canvasManager.displayImageData(sourceImage);
    }
  },
});

router.register(dreamTool);

// ---------------------------------------------------------------------------
// Style Transfer tool
// ---------------------------------------------------------------------------

let styleModelReady = false;
let styleModel: StyleTransferModel | null = null;
let styleImageReady = false;
let styleModelLoading = false;

const styleTool = createStyleTransferTool({
  onStylize: async () => {
    const sourceImage = canvasManager.getSourceImage();
    const picker = styleTool.controls.getStylePicker();
    const styleImage = picker?.getStyleImage() ?? null;
    if (!sourceImage || !styleImage || !styleModel) return;

    const config = styleTool.controls.getConfig();
    styleTool.controls.setStylizing(true);
    styleTool.controls.setStatus('Stylizing\u2026');

    try {
      const result = await stylizeImage(sourceImage, styleImage, styleModel, config);
      canvasManager.displayImageData(result);
      styleTool.controls.setStatus('Stylization complete');
    } catch (err) {
      console.error('Style transfer failed:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      styleTool.controls.setStatus(`Error: ${message}`);
    } finally {
      styleTool.controls.setStylizing(false);
    }
  },

  onReset: () => {
    const sourceImage = canvasManager.getSourceImage();
    if (sourceImage) {
      canvasManager.displayImageData(sourceImage);
    }
  },
});

router.register(styleTool);

// ---------------------------------------------------------------------------
// Pixel effect tools (no model loading needed)
// ---------------------------------------------------------------------------

const effectCallbacks: EffectToolCallbacks = {
  getSourceImage: () => canvasManager.getSourceImage(),
  displayImageData: (img: ImageData) => canvasManager.displayImageData(img),
  onApply: (newSource: ImageData) => canvasManager.setSourceImage(newSource),
  onReset: () => canvasManager.resetToOriginal(),
};

const effectDefs = [thresholdDef, channelShiftDef, lcdDef, burnDef, pixltDef, fillDef, gradientDef, moshDef];

for (const def of effectDefs) {
  router.register(createEffectTool(def, effectCallbacks));
}

// ---------------------------------------------------------------------------
// Activate default tool and expose debug API
// ---------------------------------------------------------------------------

router.activate('deepdream');

window.__cvlt = { canvasManager, router };

// ---------------------------------------------------------------------------
// Readiness gates
// ---------------------------------------------------------------------------

function updateDreamButton(): void {
  dreamTool.controls.setDreamEnabled(imageReady && modelReady);
}

function updateStylizeButton(): void {
  const picker = styleTool.controls.getStylePicker();
  const hasStyleImage = styleImageReady && picker?.getStyleImage() != null;
  styleTool.controls.setActionEnabled(imageReady && hasStyleImage && styleModelReady);
}

window.addEventListener('cvlt:image-loaded', () => {
  console.log('Image loaded \u2014 source ready');
  imageReady = true;
  updateDreamButton();
  updateStylizeButton();
});

window.addEventListener('cvlt:style-selected', () => {
  console.log('Style image selected');
  styleImageReady = true;
  updateStylizeButton();
});

// ---------------------------------------------------------------------------
// DeepDream model loading (eager — starts on app load)
// ---------------------------------------------------------------------------

function createStatusElement(): HTMLDivElement {
  const status = document.createElement('div');
  status.className = 'model-status pulse';
  status.textContent = 'Loading model\u2026';

  const rightPanelContent = document.getElementById('right-panel-content');
  if (rightPanelContent) {
    rightPanelContent.prepend(status);
  }
  return status;
}

async function initModel(): Promise<DreamModel | null> {
  const status = createStatusElement();

  try {
    await tf.setBackend('webgl');
    console.log('TF.js backend:', tf.getBackend());

    const loaded = await loadDreamModel((fraction: number) => {
      const pct = Math.round(fraction * 100);
      status.textContent = `Loading model\u2026 ${pct}%`;
    });

    status.textContent = 'Model ready';
    status.classList.remove('pulse');
    setTimeout(() => status.remove(), 2000);

    console.log('InceptionV3 model loaded successfully');
    return loaded;
  } catch (err) {
    console.error('Failed to load model:', err);
    status.textContent = '';
    status.style.color = '#ef4444';

    const msg = document.createElement('span');
    msg.textContent =
      'Failed to load model. Ensure files exist in public/models/inception_v3/. ';
    status.appendChild(msg);

    const code = document.createElement('code');
    code.textContent = 'python scripts/convert-model.py';
    code.style.fontSize = '0.85em';
    status.appendChild(code);

    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'Retry';
    retryBtn.style.marginLeft = '8px';
    retryBtn.addEventListener('click', () => {
      status.remove();
      initModel().then((m) => {
        if (m) {
          model = m;
          modelReady = true;
          window.__cvlt.model = m;
          updateDreamButton();
        }
      });
    });
    status.appendChild(retryBtn);

    return null;
  }
}

const modelPromise = initModel();

modelPromise.then((m) => {
  if (m) {
    model = m;
    modelReady = true;
    window.__cvlt.model = m;
    updateDreamButton();
  }
});

// ---------------------------------------------------------------------------
// Style Transfer model loading (lazy — loads on first tool activation)
// ---------------------------------------------------------------------------

async function initStyleModel(): Promise<StyleTransferModel | null> {
  if (styleModelLoading || styleModelReady) return styleModel;
  styleModelLoading = true;

  // Free GPU memory by disposing InceptionV3 before loading style models.
  // WebGL can't hold all three models simultaneously.
  if (model) {
    console.log('[model-swap] Disposing InceptionV3 to free GPU memory');
    model.dispose();
    model = null;
    modelReady = false;
    window.__cvlt.model = null;
    updateDreamButton();
  }

  const status = document.createElement('div');
  status.className = 'model-status pulse';
  status.textContent = 'Loading style models\u2026';

  const rightPanelContent = document.getElementById('right-panel-content');
  if (rightPanelContent) {
    rightPanelContent.prepend(status);
  }

  try {
    // Ensure WebGL backend is active (may already be set by DeepDream).
    if (!tf.getBackend()) {
      await tf.setBackend('webgl');
    }

    const loaded = await loadStyleTransferModel((fraction: number) => {
      const pct = Math.round(fraction * 100);
      status.textContent = `Loading style models\u2026 ${pct}%`;
    });

    status.textContent = 'Style models ready';
    status.classList.remove('pulse');
    setTimeout(() => status.remove(), 2000);

    console.log('Style Transfer models loaded successfully');
    styleModel = loaded;
    styleModelReady = true;
    styleModelLoading = false;
    window.__cvlt.styleModel = loaded;
    updateStylizeButton();
    return loaded;
  } catch (err) {
    console.error('Failed to load style models:', err);
    styleModelLoading = false;
    status.textContent = '';
    status.style.color = '#ef4444';

    const errorMessage = err instanceof Error ? err.message : String(err);
    const msg = document.createElement('span');
    msg.textContent = `Failed to load style models: ${errorMessage} `;
    status.appendChild(msg);

    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'Retry';
    retryBtn.style.marginLeft = '8px';
    retryBtn.addEventListener('click', () => {
      status.remove();
      initStyleModel();
    });
    status.appendChild(retryBtn);

    return null;
  }
}

// Listen for tool activation to swap models in/out of GPU memory.
// Only one tool's model(s) live in WebGL at a time to avoid OOM freezes.
nav.addEventListener('click', (e: Event) => {
  const target = (e.target as HTMLElement).closest('.nav-item[data-tool]') as HTMLElement | null;
  if (!target) return;
  const toolId = target.getAttribute('data-tool');

  if (toolId === 'style-transfer' && !styleModelReady && !styleModelLoading) {
    queueMicrotask(() => initStyleModel());
  } else if (toolId === 'deepdream' && !modelReady) {
    // Returning to DeepDream — dispose style models, reload InceptionV3.
    queueMicrotask(async () => {
      if (styleModel) {
        console.log('[model-swap] Disposing style transfer models');
        styleModel.dispose();
        styleModel = null;
        styleModelReady = false;
        styleModelLoading = false;
        window.__cvlt.styleModel = null;
      }

      const loaded = await initModel();
      if (loaded) {
        model = loaded;
        modelReady = true;
        window.__cvlt.model = loaded;
        updateDreamButton();
      }
    });
  } else if (toolId !== 'style-transfer' && toolId !== 'deepdream') {
    // Switching to a glitch tool — free GPU memory if models are loaded
    queueMicrotask(() => {
      if (model) {
        console.log('[model-swap] Disposing InceptionV3 for glitch tool');
        model.dispose();
        model = null;
        modelReady = false;
        window.__cvlt.model = null;
      }
      if (styleModel) {
        console.log('[model-swap] Disposing style models for glitch tool');
        styleModel.dispose();
        styleModel = null;
        styleModelReady = false;
        styleModelLoading = false;
        window.__cvlt.styleModel = null;
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Export handler (shared across all tools)
// ---------------------------------------------------------------------------

const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
exportBtn.addEventListener('click', () => {
  exportCanvas(canvasManager.getCanvas(), 'png');
});

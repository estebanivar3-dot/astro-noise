import './style.css';
import * as tf from '@tensorflow/tfjs';
import { createCanvasManager } from './canvas.ts';
import { loadDreamModel } from './model.ts';
import { createDeepDreamTool } from './deepdream-controls.ts';
import { createRouter } from './router.ts';
import { deepDream } from './deepdream.ts';
import { exportCanvas } from './export.ts';
import type { DreamModel } from './model.ts';

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
// Track readiness — both image and model must be available to dream
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
router.activate('deepdream');

window.__cvlt = { canvasManager, router };

// ---------------------------------------------------------------------------
// Readiness gate — enable Dream button when image + model are both ready
// ---------------------------------------------------------------------------

function updateDreamButton(): void {
  dreamTool.controls.setDreamEnabled(imageReady && modelReady);
}

window.addEventListener('cvlt:image-loaded', () => {
  console.log('Image loaded — source ready');
  imageReady = true;
  updateDreamButton();
});

// ---------------------------------------------------------------------------
// Model loading with progress UI
// ---------------------------------------------------------------------------

function createStatusElement(): HTMLDivElement {
  const status = document.createElement('div');
  status.className = 'model-status';
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
// Export handler (shared across all tools)
// ---------------------------------------------------------------------------

const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
exportBtn.addEventListener('click', () => {
  exportCanvas(canvasManager.getCanvas(), 'png');
});

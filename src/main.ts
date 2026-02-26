import './style.css';
import { createCanvasManager } from './canvas';
import { loadDreamModel } from './model';
import type { DreamModel } from './model';

declare global {
  interface Window {
    __cvlt: Record<string, unknown>;
  }
}

console.log('CVLT TOOLS loaded');

const canvasManager = createCanvasManager();

window.__cvlt = { canvasManager };

window.addEventListener('cvlt:image-loaded', () => {
  console.log('Image loaded — source ready');
});

// ---------------------------------------------------------------------------
// Model loading with progress UI
// ---------------------------------------------------------------------------

function createStatusElement(): HTMLDivElement {
  const status = document.createElement('div');
  status.className = 'model-status';
  status.textContent = 'Loading model\u2026';

  const panelContent = document.querySelector('.panel-content');
  if (panelContent) {
    panelContent.prepend(status);
  }
  return status;
}

async function initModel(): Promise<DreamModel | null> {
  const status = createStatusElement();

  try {
    const model = await loadDreamModel((fraction: number) => {
      const pct = Math.round(fraction * 100);
      status.textContent = `Loading model\u2026 ${pct}%`;
    });

    status.textContent = 'Model ready';
    setTimeout(() => status.remove(), 2000);

    console.log('InceptionV3 model loaded successfully');
    return model;
  } catch (err) {
    console.error('Failed to load model:', err);
    status.textContent =
      'Failed to load model. Make sure the converted InceptionV3 files exist ' +
      'in public/models/inception_v3/. Run: python scripts/convert-model.py';
    status.style.color = '#b91c1c';
    return null;
  }
}

const modelPromise = initModel();

modelPromise.then((model) => {
  if (model) {
    window.__cvlt.model = model;
  }
});

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
import { scanlinesDef } from './effects/scanlines.ts';
import { burnDef } from './effects/burn.ts';
import { pixelateDef } from './effects/pixelate.ts';
import { noiseDef } from './effects/noise.ts';
import { colorizeDef } from './effects/colorize.ts';
import { gradientDef } from './effects/gradient.ts';
import { squaresDef } from './effects/squares.ts';
import { solarizeDef } from './effects/solarize.ts';
import { chromaticDef } from './effects/chromatic-aberration.ts';
import { fillDef } from './effects/fill.ts';
import { datamoshDef } from './effects/datamosh.ts';
import { slitScanDef } from './effects/slit-scan.ts';
import { fractalEchoDef } from './effects/fractal-echo.ts';
import { seamCarveDef } from './effects/seam-carve.ts';
import { feedbackDef } from './effects/feedback-loop.ts';
import { createGenerateTool } from './generate/controls.ts';
import { generateImage } from './generate/api.ts';
import { pixelSortDef } from './effects/pixel-sort.ts';
import { ditherDef } from './effects/dither.ts';
import { displacementDef } from './effects/displacement.ts';
import { meltDef } from './effects/melt.ts';
import { erosionDef } from './effects/erosion.ts';
import { turbulenceDef } from './effects/turbulence.ts';
import { growthDef } from './effects/growth.ts';
import { worleyDef } from './effects/worley.ts';
import { reactionDiffusionDef } from './effects/reaction-diffusion.ts';
import { createRedreamTool } from './generate/redream-controls.ts';
import { redream } from './generate/redream-engine.ts';

declare global {
  interface Window {
    __cvlt: { srcActive: boolean };
  }
}

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

let lastDreamResult: ImageData | null = null;

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

      dreamTool.controls.setDreaming(false);
      lastDreamResult = result;
      dreamTool.controls.setDreamImages(sourceImage, result);
      canvasManager.displayImageData(result);
      dreamTool.controls.setHasResult(true);
      dreamTool.controls.setStatus('Dream complete — Apply to keep');
    } catch (err) {
      dreamTool.controls.setDreaming(false);
      const message = err instanceof Error ? err.message : 'Unknown error';
      dreamTool.controls.setStatus(`Error: ${message}`);
    }
  },

  onApply: () => {
    // Apply the blended result (with opacity + tonal) as the new source
    const blended = dreamTool.controls.getBlendedResult();
    if (blended) {
      canvasManager.setSourceImage(blended);
      lastDreamResult = null;
      dreamTool.controls.setHasResult(false);
      dreamTool.controls.setStatus('Applied — this is your new source');
    } else if (lastDreamResult) {
      canvasManager.setSourceImage(lastDreamResult);
      lastDreamResult = null;
      dreamTool.controls.setHasResult(false);
      dreamTool.controls.setStatus('Applied — this is your new source');
    }
  },

  onReset: () => {
    lastDreamResult = null;
    canvasManager.resetToOriginal();
    dreamTool.controls.setHasResult(false);
    dreamTool.controls.setStatus('');
  },

  displayImageData: (img: ImageData) => canvasManager.displayImageData(img),
});

router.register(dreamTool);

// ---------------------------------------------------------------------------
// Style Transfer tool
// ---------------------------------------------------------------------------

let styleModelReady = false;
let styleModel: StyleTransferModel | null = null;
let styleImageReady = false;
let styleModelLoading = false;

let lastStyleResult: ImageData | null = null;

const styleTool = createStyleTransferTool({
  onStylize: async () => {
    const sourceImage = canvasManager.getSourceImage();
    const picker = styleTool.controls.getStylePicker();
    const styleImg = picker?.getStyleImage() ?? null;

    if (!sourceImage) {
      styleTool.controls.setStatus('Load a content image first');
      return;
    }
    if (!styleImg) {
      styleTool.controls.setStatus('Select a style image first');
      return;
    }
    if (!styleModel) {
      styleTool.controls.setStatus('Style model still loading\u2026');
      return;
    }

    const config = styleTool.controls.getConfig();
    styleTool.controls.setStylizing(true);
    styleTool.controls.setProgress(0);

    try {
      const result = await stylizeImage(sourceImage, styleImg, styleModel, config, (fraction) => {
        styleTool.controls.setProgress(fraction);
      });

      styleTool.controls.setStylizing(false);
      lastStyleResult = result;
      canvasManager.displayImageData(result);
      styleTool.controls.setHasResult(true);
      styleTool.controls.setStatus('Stylization complete — Apply to keep');
    } catch (err) {
      styleTool.controls.setStylizing(false);
      const message = err instanceof Error ? err.message : 'Unknown error';
      styleTool.controls.setStatus(`Error: ${message}`);
    }
  },

  onApply: () => {
    if (lastStyleResult) {
      canvasManager.setSourceImage(lastStyleResult);
      lastStyleResult = null;
      styleTool.controls.setHasResult(false);
      styleTool.controls.setStatus('Applied — this is your new source');
    }
  },

  onReset: () => {
    lastStyleResult = null;
    canvasManager.resetToOriginal();
    styleTool.controls.setHasResult(false);
    styleTool.controls.setStatus('');
  },
});

router.register(styleTool);

// ---------------------------------------------------------------------------
// Generate tool (HF Inference API — no model loading)
// ---------------------------------------------------------------------------

const generateTool = createGenerateTool({
  onGenerate: async () => {
    const config = generateTool.controls.getConfig();
    if (!config.prompt.trim()) {
      generateTool.controls.setStatus('Enter a prompt');
      return;
    }
    if (!config.token) {
      generateTool.controls.setStatus('Enter your HF API token first');
      return;
    }
    generateTool.controls.setGenerating(true);
    try {
      const imageData = await generateImage(config, (status) => {
        generateTool.controls.setProgress(status);
      });
      canvasManager.loadGeneratedImage(imageData);
      generateTool.controls.setStatus('Done \u2014 switch to any effect to destroy it');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      generateTool.controls.setStatus(`Error: ${msg}`);
    } finally {
      generateTool.controls.setGenerating(false);
    }
  },
});

router.register(generateTool);

// ---------------------------------------------------------------------------
// Pixel effect tools (no model loading needed)
// ---------------------------------------------------------------------------

const effectCallbacks: EffectToolCallbacks = {
  getSourceImage: () => canvasManager.getSourceImage(),
  displayImageData: (img: ImageData) => canvasManager.displayImageData(img),
  onApply: (newSource: ImageData) => canvasManager.setSourceImage(newSource),
  onReset: () => canvasManager.resetToOriginal(),
};

const effectDefs = [
  thresholdDef, channelShiftDef, scanlinesDef, burnDef, solarizeDef,
  pixelateDef, noiseDef, colorizeDef, gradientDef, squaresDef,
  chromaticDef, fillDef, datamoshDef,
  slitScanDef, fractalEchoDef, seamCarveDef, feedbackDef,
  pixelSortDef, ditherDef, displacementDef,
  meltDef, erosionDef, turbulenceDef, growthDef, worleyDef, reactionDiffusionDef,
];

for (const def of effectDefs) {
  router.register(createEffectTool(def, effectCallbacks));
}

// ---------------------------------------------------------------------------
// Re-Dream tool (local effect randomizer)
// ---------------------------------------------------------------------------

let lastRedreamResult: ImageData | null = null;

const redreamTool = createRedreamTool({
  onRedream: () => {
    const source = canvasManager.getSourceImage();
    if (!source) {
      redreamTool.controls.setStatus('Load an image first');
      return;
    }

    const config = redreamTool.controls.getConfig();
    redreamTool.controls.setRedreaming(true);
    try {
      const result = redream(source, effectDefs, config, (status) => {
        redreamTool.controls.setProgress(status);
      });
      lastRedreamResult = result;
      redreamTool.controls.setDreamImages(source, result);
      canvasManager.displayImageData(result);
      redreamTool.controls.setHasResult(true);
      redreamTool.controls.setStatus('Done — Apply to keep, or Re-Dream again');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Re-dream failed';
      redreamTool.controls.setStatus(`Error: ${msg}`);
    } finally {
      redreamTool.controls.setRedreaming(false);
    }
  },

  onApply: () => {
    // Apply the blended result (with opacity + tonal) as the new source
    const blended = redreamTool.controls.getBlendedResult();
    if (blended) {
      canvasManager.setSourceImage(blended);
      lastRedreamResult = null;
      redreamTool.controls.setHasResult(false);
      redreamTool.controls.setStatus('Applied — this is your new source');
    } else if (lastRedreamResult) {
      canvasManager.setSourceImage(lastRedreamResult);
      lastRedreamResult = null;
      redreamTool.controls.setHasResult(false);
      redreamTool.controls.setStatus('Applied — this is your new source');
    }
  },

  onReset: () => {
    lastRedreamResult = null;
    canvasManager.resetToOriginal();
    redreamTool.controls.setHasResult(false);
    redreamTool.controls.setStatus('');
  },

  displayImageData: (img: ImageData) => canvasManager.displayImageData(img),
});

router.register(redreamTool);

// ---------------------------------------------------------------------------
// Activate default tool
// ---------------------------------------------------------------------------

router.activate('deepdream');

window.__cvlt = { srcActive: false };

// ---------------------------------------------------------------------------
// Global SRC (Show Original) — hold to preview source image
// ---------------------------------------------------------------------------

{
  const panelLeft = document.querySelector('.panel-left') as HTMLElement;
  const srcWrapper = document.createElement('div');
  srcWrapper.className = 'src-btn-wrapper';

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'btn btn-secondary upload-btn';
  uploadBtn.textContent = 'Upload Image';
  uploadBtn.addEventListener('click', () => {
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    fileInput.value = '';
    fileInput.click();
  });

  const srcBtn = document.createElement('button');
  srcBtn.className = 'src-btn';
  srcBtn.textContent = 'SRC \u2014 Hold to see original';
  srcBtn.title = 'Hold to show original image (\\)';

  srcWrapper.appendChild(uploadBtn);
  srcWrapper.appendChild(srcBtn);
  panelLeft.appendChild(srcWrapper);

  let savedCanvas: ImageData | null = null;

  function showOriginal(): void {
    if (window.__cvlt.srcActive) return;
    const cvs = canvasManager.getCanvas();
    if (cvs.hidden) return; // no image loaded
    const ctx = cvs.getContext('2d')!;
    savedCanvas = ctx.getImageData(0, 0, cvs.width, cvs.height);
    const original = canvasManager.getOriginalSource();
    if (original) canvasManager.displayImageData(original);
    window.__cvlt.srcActive = true;
    srcBtn.classList.add('active');
  }

  function hideOriginal(): void {
    if (!window.__cvlt.srcActive) return;
    window.__cvlt.srcActive = false;
    srcBtn.classList.remove('active');
    if (savedCanvas) {
      canvasManager.displayImageData(savedCanvas);
      savedCanvas = null;
    }
  }

  srcBtn.addEventListener('mousedown', showOriginal);
  srcBtn.addEventListener('mouseup', hideOriginal);
  srcBtn.addEventListener('mouseleave', () => { if (window.__cvlt.srcActive) hideOriginal(); });

  window.addEventListener('keydown', (e) => {
    if (e.key === '\\') { e.preventDefault(); showOriginal(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === '\\' && window.__cvlt.srcActive) hideOriginal();
  });
}

// ---------------------------------------------------------------------------
// Readiness gates
// ---------------------------------------------------------------------------

function updateDreamButton(): void {
  dreamTool.controls.setDreamEnabled(imageReady && modelReady);
}

function updateStylizeButton(): void {
  const picker = styleTool.controls.getStylePicker();
  const hasStyleImage = styleImageReady && picker?.getStyleImage() != null;
  const ready = imageReady && hasStyleImage && styleModelReady;
  styleTool.controls.setActionEnabled(ready);

  // Show the blocking reason on the button itself
  if (ready) {
    styleTool.controls.setButtonLabel('Stylize');
  } else if (styleModelLoading) {
    // Label is updated by the loading progress callback — don't overwrite
  } else if (!styleModelReady) {
    styleTool.controls.setButtonLabel('Loading models\u2026');
  } else if (!imageReady) {
    styleTool.controls.setButtonLabel('Load an image first');
  } else if (!hasStyleImage) {
    styleTool.controls.setButtonLabel('Select a style image');
  }
}

window.addEventListener('cvlt:image-loaded', () => {
  imageReady = true;
  updateDreamButton();
  updateStylizeButton();
});

window.addEventListener('cvlt:style-selected', () => {
  styleImageReady = true;
  updateStylizeButton();
});

// ---------------------------------------------------------------------------
// DeepDream model loading (eager — starts on app load)
// ---------------------------------------------------------------------------

async function initModel(): Promise<DreamModel | null> {
  dreamTool.controls.setModelLoading(true, 'Loading model\u2026');

  try {
    await tf.setBackend('webgl');

    const loaded = await loadDreamModel((fraction: number) => {
      const pct = Math.round(fraction * 100);
      dreamTool.controls.setModelLoading(true, `Loading model\u2026 ${pct}%`);
    });

    dreamTool.controls.setModelLoading(false);
    return loaded;
  } catch (_err) {
    dreamTool.controls.setModelLoading(true, 'Failed to load model');
    return null;
  }
}

const modelPromise = initModel();

modelPromise.then((m) => {
  if (m) {
    model = m;
    modelReady = true;
    updateDreamButton();
  }
});

// Listen for tool activation to swap models in/out of GPU memory.
// Only one tool's model(s) live in WebGL at a time to avoid OOM freezes.
//
// A generation counter prevents race conditions when the user rapidly
// switches tools — stale async loads are discarded on completion.
let modelSwapGeneration = 0;

nav.addEventListener('click', (e: Event) => {
  const target = (e.target as HTMLElement).closest('.nav-item[data-tool]') as HTMLElement | null;
  if (!target) return;
  const toolId = target.getAttribute('data-tool');

  modelSwapGeneration++;
  const myGeneration = modelSwapGeneration;

  if (toolId === 'style-transfer' && !styleModelReady && !styleModelLoading) {
    queueMicrotask(async () => {
      // Dispose InceptionV3 before loading style models.
      if (model) {
        model.dispose();
        model = null;
        modelReady = false;
        updateDreamButton();
      }

      styleModelLoading = true;
      styleTool.controls.setButtonLabel('Loading models\u2026');
      styleTool.controls.setStatus('Loading style models\u2026');

      try {
        if (!tf.getBackend()) await tf.setBackend('webgl');

        const loaded = await loadStyleTransferModel((fraction: number) => {
          const pct = Math.round(fraction * 100);
          styleTool.controls.setButtonLabel(`Loading models\u2026 ${pct}%`);
          styleTool.controls.setStatus(`Loading style models\u2026 ${pct}%`);
        });

        // Stale check: user navigated away while we were loading.
        if (myGeneration !== modelSwapGeneration) {
          loaded.dispose();
          styleModelLoading = false;
          return;
        }

        styleModel = loaded;
        styleModelReady = true;
        styleModelLoading = false;
        updateStylizeButton();
        styleTool.controls.setStatus('Style models loaded — ready');
      } catch (_err) {
        styleModelLoading = false;
        styleTool.controls.setButtonLabel('Model failed to load');
        styleTool.controls.setStatus('Failed to load style models');
      }
    });
  } else if (toolId === 'deepdream' && !modelReady) {
    // Returning to DeepDream — dispose style models, reload InceptionV3.
    queueMicrotask(async () => {
      if (styleModel) {
        styleModel.dispose();
        styleModel = null;
        styleModelReady = false;
        styleModelLoading = false;
      }

      const loaded = await initModel();

      // Stale check
      if (myGeneration !== modelSwapGeneration) {
        if (loaded) loaded.dispose();
        return;
      }

      if (loaded) {
        model = loaded;
        modelReady = true;
        updateDreamButton();
      }
    });
  } else if (toolId !== 'style-transfer' && toolId !== 'deepdream') {
    // Switching to a glitch tool — free GPU memory if models are loaded
    queueMicrotask(() => {
      if (model) {
        model.dispose();
        model = null;
        modelReady = false;
      }
      if (styleModel) {
        styleModel.dispose();
        styleModel = null;
        styleModelReady = false;
        styleModelLoading = false;
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

// ---------------------------------------------------------------------------
// Mobile nav toggle
// ---------------------------------------------------------------------------

const hamburger = document.getElementById('mobile-hamburger');
const mobileToolName = document.getElementById('mobile-tool-name');

hamburger?.addEventListener('click', () => {
  document.body.classList.toggle('nav-open');
});

window.addEventListener('cvlt:tool-changed', ((e: CustomEvent) => {
  document.body.classList.remove('nav-open');
  if (mobileToolName) mobileToolName.textContent = e.detail.label;
}) as EventListener);

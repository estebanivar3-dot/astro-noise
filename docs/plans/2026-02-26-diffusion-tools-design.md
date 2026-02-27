# CVLT TOOLS — Diffusion Tools Design

## Overview

Add three Stable Diffusion-based tools to the existing Image Destruction Toolkit: img2img, Inpaint, and InstructEdit. All inference runs on-device in the browser via Transformers.js (ONNX Runtime Web). Models download from Hugging Face CDN on first use and are cached by the browser. No API keys, no cloud compute, no user-facing downloads.

## Layout Change

Current two-panel layout becomes three-panel:

```
Current:
[ sidebar 300px ][ canvas (flex) ]

New:
[ prompt ~300px ][ canvas (flex) ][ parameters ~300px ]
```

- **Left panel (prompt)**: brand header + tool nav at top, text prompt input at bottom. Shared across all diffusion tools. For DeepDream, prompt input is hidden (not applicable).
- **Center (canvas)**: unchanged — drop zone, canvas, progress overlay. Extended with mask painting overlay for Inpaint tool.
- **Right panel (parameters)**: tool-specific controls (sliders, selects), action buttons (Dream/Generate/Inpaint/Edit), export button at bottom. Swaps content when active tool changes.

### Design Aesthetic

Maintain existing CVLT brutalist style:
- JetBrains Mono, #0a0a0a backgrounds, #e8e8e8 foreground
- Square corners, 1px borders, uppercase labels
- No rounded corners, no light theme, no Inter font
- Figma reference was layout-only — adapt to existing CSS variables and patterns

## Tools

### 1. img2img

Transform an uploaded image using a text prompt with controllable destruction strength.

**Left panel**: Text prompt — "describe what this should become"
**Right panel controls**:
- Strength slider (0.0–1.0) — how much to deviate from the original
- Steps slider (1–8, SD Turbo uses few steps)
- Seed input (number, randomize button)
**Flow**: upload image → type prompt → set strength → Generate → result on canvas

### 2. Inpaint

Paint a mask region on the image, then regenerate it with a text prompt.

**Left panel**: Text prompt — "what should fill the masked area"
**Right panel controls**:
- Brush size slider (5–100px)
- Clear mask button
- Steps slider (1–30)
- Seed input
**Canvas**: when Inpaint is active, clicking/dragging on the canvas paints a semi-transparent red mask on an overlay canvas. Mask data is extracted and sent to the inpainting pipeline.
**Flow**: upload image → paint mask on canvas → type prompt → Inpaint → result on canvas

### 3. InstructEdit

Edit an image using a natural language instruction (InstructPix2Pix).

**Left panel**: Text instruction — "make it look underwater", "add fire", "turn it to flesh"
**Right panel controls**:
- Image guidance scale slider (1.0–3.0) — how much to preserve the original
- Text guidance scale slider (5.0–15.0) — how strongly to follow the instruction
- Steps slider (5–30)
- Seed input
**Flow**: upload image → type instruction → Edit → result on canvas

## Models

| Tool | Model | Approx Size | Pipeline |
|------|-------|-------------|----------|
| img2img | SD Turbo (stabilityai/sd-turbo) | ~1.5GB | img2img |
| Inpaint | SD 1.5 Inpainting (runwayml/stable-diffusion-inpainting) | ~1.7GB | inpainting |
| InstructEdit | InstructPix2Pix (timbrooks/instruct-pix2pix) | ~1.7GB | img2img with dual guidance |

All models loaded via Transformers.js from Hugging Face CDN. Downloaded once, cached in browser Cache API. Each tool downloads its model on first activation — not all at once.

## Architecture

### New dependencies
- `@huggingface/transformers` — Transformers.js for diffusion pipelines

### Module structure

```
src/
  main.ts              — app entry, tool router (MODIFY)
  canvas.ts            — canvas manager (MODIFY — add mask overlay)
  controls.ts          — DeepDream controls (KEEP, rename to deepdream-controls.ts)
  deepdream.ts         — DeepDream algorithm (KEEP)
  model.ts             — InceptionV3 model (KEEP)
  export.ts            — export utility (KEEP)
  style.css            — styles (MODIFY — three-panel layout, new components)

  router.ts            — NEW: tool switching, panel swapping
  prompt-panel.ts      — NEW: left panel with prompt input
  diffusion/
    pipeline.ts        — NEW: shared diffusion pipeline manager (load, cache, run)
    img2img.ts         — NEW: img2img tool controls + execution
    inpaint.ts         — NEW: inpaint tool controls + execution
    instruct-edit.ts   — NEW: InstructEdit tool controls + execution
    mask-canvas.ts     — NEW: mask painting overlay for inpaint
```

### Tool router

Nav items in left panel header. Clicking a tool:
1. Sets active tool state
2. Swaps right panel content (different createControls function per tool)
3. Shows/hides prompt input in left panel (hidden for DeepDream)
4. Shows/hides mask overlay on canvas (only for Inpaint)

### Model manager (pipeline.ts)

- Lazy-loads models per tool on first use
- Shows download progress in a status element (same pattern as InceptionV3 loading)
- Caches pipeline instances so switching tools doesn't re-download
- WebGPU backend preferred, falls back to WASM

### Mask canvas (mask-canvas.ts)

- Transparent overlay `<canvas>` positioned on top of the main canvas
- Only visible when Inpaint tool is active
- Mouse/touch events draw semi-transparent red circles
- `getMaskImageData()` exports the mask as black/white ImageData for the pipeline
- Clear mask button resets the overlay

### Shared patterns

- All tools share the same canvas manager for displaying results
- All tools share the same export functionality
- All tools share the prompt panel (left side)
- Progress reporting uses the same overlay pattern as DeepDream
- Model loading status uses the same pattern as InceptionV3

## HTML structure change

```html
<div id="app">
  <main class="app-main">
    <aside class="panel-left">
      <!-- brand header -->
      <!-- tool nav -->
      <!-- prompt input (bottom) -->
    </aside>
    <section class="panel-center">
      <!-- canvas container + drop zone + mask overlay -->
    </section>
    <aside class="panel-right">
      <!-- tool-specific controls -->
      <!-- action buttons -->
      <!-- export button -->
    </aside>
  </main>
</div>
```

## WebGPU requirement

Diffusion models require WebGPU for acceptable performance. The app should:
- Check for WebGPU support on tool activation
- Show a clear message if not supported: "Diffusion tools require Chrome 113+ with WebGPU"
- DeepDream continues to work on WebGL (existing behavior)

# CVLT TOOLS Phase 1 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a browser-based image destruction tool with real DeepDream (InceptionV3 via TensorFlow.js), drag-and-drop canvas, layer selector, intensity slider, and export — matching the Figma design's light conversational-AI layout.

**Architecture:** Vite + vanilla TypeScript app. Two-panel layout: left panel with effect controls, right panel with canvas. TensorFlow.js loads InceptionV3, creates a multi-output "dream model" exposing mixed layers, then performs gradient ascent on the input image to amplify layer activations. Processing happens at 512x512 max for WebGL memory safety, result displayed at full resolution.

**Tech Stack:** Vite, TypeScript, TensorFlow.js (@tensorflow/tfjs), Canvas API, InceptionV3 (converted to TF.js layers format)

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/style.css`
- Create: `.gitignore`

**Step 1: Initialize Vite project with TypeScript**

```bash
cd /Users/esteban/Desktop/cvlt-tools
npm create vite@latest . -- --template vanilla-ts
```

If it asks to overwrite, select yes (it will preserve our `docs/` folder).

**Step 2: Install dependencies**

```bash
cd /Users/esteban/Desktop/cvlt-tools
npm install @tensorflow/tfjs
npm install -D typescript
```

**Step 3: Update .gitignore**

Add these lines to `.gitignore`:

```
node_modules/
dist/
public/models/
*.local
```

The `public/models/` line keeps the large InceptionV3 model files (~95MB) out of git.

**Step 4: Verify dev server starts**

```bash
cd /Users/esteban/Desktop/cvlt-tools
npm run dev
```

Expected: Vite dev server starts on `http://localhost:5173` with default template page.

**Step 5: Commit**

```bash
cd /Users/esteban/Desktop/cvlt-tools
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src/ .gitignore
git commit -m "feat: scaffold Vite + TypeScript project with TensorFlow.js"
```

---

## Task 2: HTML Shell and CSS Layout

**Files:**
- Modify: `index.html`
- Modify: `src/style.css`
- Modify: `src/main.ts`

**Step 1: Write the HTML shell**

Replace `index.html` with the two-panel layout structure. Header with app title and export button. Main area split into left aside panel (380px, effect controls) and right section (canvas with drop zone). Drop zone includes a hidden file input.

**Step 2: Write the CSS matching Figma design**

Design tokens from Figma reference:
- `--bg-primary: #f6f6f6` (page background)
- `--bg-panel: #ffffff` (panels)
- `--bg-input: #e5e5e5` (input backgrounds)
- `--text-primary: #101828` (main text)
- `--text-secondary: #667085` (secondary text)
- `--radius-lg: 16px` (panels), `--radius-md: 14px` (inputs)
- `--panel-width: 380px`, `--header-height: 56px`
- Font: Inter, weights 400/500/600

Layout: flexbox column (header + main), main is flexbox row (aside + section). Canvas container uses flexbox centering. Drop zone is dashed border with hover state. Custom range slider styling (4px track, 16px round thumb). Progress bar (3px height, accent fill).

**Step 3: Clear the default main.ts**

Replace `src/main.ts` with just the style import and a console log.

**Step 4: Verify layout renders correctly**

```bash
cd /Users/esteban/Desktop/cvlt-tools
npm run dev
```

Open `http://localhost:5173` — should see two-panel layout with left panel (380px white), right panel (gray with dashed drop zone), and header.

**Step 5: Commit**

```bash
cd /Users/esteban/Desktop/cvlt-tools
git add index.html src/style.css src/main.ts
git commit -m "feat: two-panel layout matching Figma design"
```

---

## Task 3: Image Drop Zone and Canvas Display

**Files:**
- Create: `src/canvas.ts`
- Modify: `src/main.ts`

**Step 1: Create the canvas module**

Create `src/canvas.ts` with a `createCanvasManager()` factory that returns:
- `getSourceImage(): ImageData | null` — the original loaded image
- `displayImageData(imageData: ImageData): void` — render to canvas
- `getCanvas(): HTMLCanvasElement` — for export

Implementation:
- Attach click, dragover, dragleave, drop listeners to drop zone
- On file drop/select: create Image from object URL, draw to canvas, store as sourceImage via getImageData
- Hide drop zone, show canvas, enable export button
- Dispatch `cvlt:image-loaded` custom event on window

**Step 2: Wire it up in main.ts**

Import and call `createCanvasManager()`. Listen for `cvlt:image-loaded` event. Expose on `window.__cvlt` for debugging.

**Step 3: Test manually**

Drag `HB828lVW8AEo-I6.jpeg` onto the drop zone. Expected: image displays on canvas, export button enables.

**Step 4: Commit**

```bash
cd /Users/esteban/Desktop/cvlt-tools
git add src/canvas.ts src/main.ts
git commit -m "feat: image drag-and-drop with canvas display"
```

---

## Task 4: Model Conversion Script

**Files:**
- Create: `scripts/convert-model.py`
- Create: `scripts/requirements.txt`

This task sets up the InceptionV3 model for TensorFlow.js.

**Step 1: Create requirements.txt**

```
tensorflow>=2.15
tensorflowjs>=4.0
```

**Step 2: Write the conversion script**

`scripts/convert-model.py`:
- Import `tf.keras.applications.InceptionV3` with `include_top=False`, `weights='imagenet'`, `input_shape=(None, None, 3)`
- Print all mixed layer names for reference
- Use `tfjs.converters.save_keras_model(base_model, OUTPUT_DIR)` to save to `public/models/inception_v3/`
- Print total model size

**Step 3: Run the conversion**

```bash
cd /Users/esteban/Desktop/cvlt-tools
pip3 install -r scripts/requirements.txt
python3 scripts/convert-model.py
```

Expected: Downloads InceptionV3 weights (~92MB), converts to TF.js format, saves `model.json` + shard `.bin` files to `public/models/inception_v3/`.

**Step 4: Verify model files exist**

```bash
ls -la /Users/esteban/Desktop/cvlt-tools/public/models/inception_v3/
```

**Step 5: Commit (script only, not the model files)**

```bash
cd /Users/esteban/Desktop/cvlt-tools
git add scripts/
git commit -m "feat: add InceptionV3 model conversion script"
```

---

## Task 5: TensorFlow.js Model Loading

**Files:**
- Create: `src/model.ts`
- Modify: `src/main.ts`

**Step 1: Create the model loading module**

Create `src/model.ts` with:

**Constants:**
- `DREAM_LAYERS` — array of all 11 mixed layer names ('mixed0' through 'mixed10')
- `DreamLayerName` type
- `MODEL_URL = '/models/inception_v3/model.json'`

**`loadDreamModel(onProgress?)`:**
- Calls `tf.loadLayersModel(MODEL_URL, { onProgress })`
- Returns `DreamModel` object with:
  - `baseModel` — the loaded tf.LayersModel
  - `predict(input, layers)` — creates multi-output model on the fly from requested layer names, returns array of activation tensors
  - `dispose()` — cleanup

**`preprocessForInception(tensor3D)`:**
- Convert to float, divide by 127.5, subtract 1 (maps [0,255] to [-1,1])
- Expand dims to batch [1, H, W, 3]

**`deprocessFromInception(tensor4D)`:**
- Squeeze batch dim, add 1, multiply by 127.5, clip [0,255], cast to int

**Step 2: Add model loading to main.ts**

Show loading progress in a status div prepended to `.panel-content`. On success show "Model ready" then remove. On failure show helpful error with the conversion script command.

**Step 3: Verify model loads in browser**

```bash
cd /Users/esteban/Desktop/cvlt-tools
npm run dev
```

Expected: Left panel shows "Loading model... X%" then "Model ready".

**Step 4: Commit**

```bash
cd /Users/esteban/Desktop/cvlt-tools
git add src/model.ts src/main.ts
git commit -m "feat: TensorFlow.js InceptionV3 model loading with progress"
```

---

## Task 6: DeepDream Core Algorithm

**Files:**
- Create: `src/deepdream.ts`

This is the heart of the app — gradient ascent on layer activations.

**Step 1: Create the DeepDream processing module**

Create `src/deepdream.ts` with:

**`DreamConfig` interface:**
- `layers: DreamLayerName[]` — which mixed layers to dream on
- `intensity: number` — gradient step size (0.005 to 0.15)
- `iterations: number` — gradient ascent steps per octave (5 to 100)
- `octaves: number` — multi-scale passes (1 to 5)
- `octaveScale: number` — scale factor between octaves (1.2 to 1.5)

**`DEFAULT_CONFIG`:**
- layers: ['mixed3'], intensity: 0.02, iterations: 20, octaves: 3, octaveScale: 1.3

**`deepDream(sourceImageData, model, config, onProgress?)` algorithm:**

1. Calculate processing dimensions (max 512px on longest side for WebGL safety)
2. Convert ImageData to tensor, resize, preprocess for InceptionV3 [-1,1]
3. For each octave (0 to config.octaves-1):
   a. Calculate octave dimensions using `octaveScale^(octave - octaves + 1)`
   b. Resize working image to octave size
   c. For each iteration:
      - Compute gradient of dream loss w.r.t. input using `tf.grad()`
      - Dream loss = sum of means of all selected layer activations
      - Normalize gradient by dividing by abs mean + epsilon
      - Add normalized gradient * intensity to image (gradient ASCENT)
      - Call `tf.nextFrame()` every 5 steps for UI responsiveness
      - Report progress via callback
4. Resize result back to original dimensions
5. Deprocess from [-1,1] to [0,255] and convert to ImageData
6. Dispose all tensors

**Helper `computeDreamGradient(input, model, layerNames)`:**
- Use `tf.grad()` with a function that:
  - Calls `model.predict(input, layerNames)` to get activations
  - Returns sum of `.mean()` of each activation tensor

**Helper `tensorToImageData(tensor3D)`:**
- Read tensor data, build ImageData with RGBA channels

**Step 2: Verify it compiles**

```bash
cd /Users/esteban/Desktop/cvlt-tools
npx tsc --noEmit
```

Expected: No type errors.

**Step 3: Commit**

```bash
cd /Users/esteban/Desktop/cvlt-tools
git add src/deepdream.ts
git commit -m "feat: DeepDream core algorithm with multi-octave gradient ascent"
```

---

## Task 7: UI Controls — Layer Selector and Sliders

**Files:**
- Create: `src/controls.ts`
- Modify: `src/main.ts`

**Step 1: Create the controls module**

Create `src/controls.ts` with a `createControls()` factory:

**Layer descriptions map** (human-readable for dropdown):
- mixed0: "Edges and strokes"
- mixed1-2: "Textures" / "Complex textures"
- mixed3-5: "Patterns and repeats" / "Proto-eyes" / "Swirls and spirals"
- mixed6-8: "Faces emerge" / "Animals and creatures" / "High-level features"
- mixed9-10: "Surreal objects" / "Full hallucination"

**UI elements built with DOM methods (createElement, textContent, appendChild):**
- Layer select dropdown with all 11 mixed layers + descriptions
- Intensity range slider (min 0.005, max 0.15, step 0.005, default 0.02)
- Iterations range slider (min 5, max 100, step 5, default 20)
- Octaves range slider (min 1, max 5, step 1, default 3)
- Progress bar (hidden until dreaming)
- Status text
- Dream button and Reset button in action bar at panel bottom

**Returns `ControlsManager`:**
- `getConfig(): DreamConfig`
- `setDreaming(active: boolean)` — toggles disabled state and button text
- `onDream(callback)` / `onReset(callback)` — register handlers
- `setProgress(step, total)` — update progress bar width and status text

**Step 2: Wire controls into main.ts**

- Import controls and deepdream
- On Dream click: get source image and config, call `deepDream()` with progress callback, display result
- On Reset click: restore original source image to canvas
- Handle errors with status message

**Step 3: Verify the full UI renders and Dream works end-to-end**

```bash
cd /Users/esteban/Desktop/cvlt-tools
npm run dev
```

Expected: Full UI with controls. Drop image, click Dream, see progress, see dreamed result.

**Step 4: Commit**

```bash
cd /Users/esteban/Desktop/cvlt-tools
git add src/controls.ts src/main.ts
git commit -m "feat: DeepDream controls with layer selector, sliders, and dream/reset buttons"
```

---

## Task 8: Export Functionality

**Files:**
- Create: `src/export.ts`
- Modify: `src/main.ts`

**Step 1: Create the export module**

Create `src/export.ts`:
- `exportCanvas(canvas, format, quality)` function
- Supports 'png', 'jpeg', 'webp' formats
- Uses `canvas.toDataURL()` with appropriate mime type
- Creates temporary anchor element, sets download attribute to `cvlt-dream.{format}`, triggers click

**Step 2: Wire export button in main.ts**

Add click listener on `#export-btn` that calls `exportCanvas(canvas, 'png')`.

**Step 3: Test export**

Load image, run Dream, click Export. Expected: downloads `cvlt-dream.png`.

**Step 4: Commit**

```bash
cd /Users/esteban/Desktop/cvlt-tools
git add src/export.ts src/main.ts
git commit -m "feat: PNG export from canvas"
```

---

## Task 9: Error Handling and Polish

**Files:**
- Modify: `src/main.ts`
- Modify: `src/deepdream.ts`
- Modify: `src/model.ts`

**Step 1: Add WebGL backend check**

At top of main.ts, call `tf.setBackend('webgl')` and log the backend.

**Step 2: Add memory cleanup logging to deepDream**

Track `tf.memory().numTensors` before and after processing. Log tensor count to help catch memory leaks during development.

**Step 3: Add model load retry**

Update the model error state to include a reload button and the conversion script command.

**Step 4: Verify error states**

Test with missing model files (should show helpful error). Test with model present (should load and work).

**Step 5: Commit**

```bash
cd /Users/esteban/Desktop/cvlt-tools
git add src/main.ts src/deepdream.ts src/model.ts
git commit -m "feat: WebGL backend, memory cleanup, and error handling"
```

---

## Task 10: Integration Test — Full Dream Pipeline

**Files:** None new — this is a manual end-to-end verification.

**Step 1: Start the dev server**

```bash
cd /Users/esteban/Desktop/cvlt-tools
npm run dev
```

**Step 2: Full workflow test**

1. Open `http://localhost:5173`
2. Wait for "Model ready" in left panel
3. Drag `/Users/esteban/Downloads/HB828lVW8AEo-I6.jpeg` onto drop zone
4. Image should appear on canvas
5. Select layer "mixed3 — Patterns and repeats"
6. Set intensity to 0.02, iterations to 20, octaves to 3
7. Click "Dream"
8. Progress bar should animate through 60 steps (3 octaves x 20 iterations)
9. Canvas should update with dreamed image — expect swirly, pattern-amplified version
10. Click "Export" — should download PNG
11. Click "Reset" — should revert to original image
12. Try again with "mixed7 — Animals and creatures" at intensity 0.05
13. Expect more creature-like/face-like hallucinations

**Step 3: Test different layers**

| Layer | Expected Visual |
|-------|----------------|
| mixed0-2 | Subtle texture enhancement, stroke-like patterns |
| mixed3-5 | Repeating patterns, swirls, proto-objects |
| mixed6-8 | Faces, eyes, animal features emerge |
| mixed9-10 | Full surreal hallucinations, complex objects |

**Step 4: Final commit**

If everything works:

```bash
cd /Users/esteban/Desktop/cvlt-tools
git add -A
git commit -m "feat: CVLT TOOLS Phase 1 complete — DeepDream in the browser"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Vite + TS scaffold | `package.json`, `vite.config.ts` |
| 2 | Two-panel layout (Figma match) | `index.html`, `src/style.css` |
| 3 | Image drag-and-drop + canvas | `src/canvas.ts` |
| 4 | Model conversion script | `scripts/convert-model.py` |
| 5 | TF.js model loading | `src/model.ts` |
| 6 | DeepDream algorithm | `src/deepdream.ts` |
| 7 | UI controls (sliders, buttons) | `src/controls.ts` |
| 8 | PNG export | `src/export.ts` |
| 9 | Error handling + polish | Various |
| 10 | End-to-end integration test | Manual |

**Total estimated time:** 2-3 hours of focused implementation.

**After Phase 1:** The foundation is in place. Phase 2 can add more AI effects (Neural Style Transfer, Feature Amplification), the chat interface, and the full effect stack system.

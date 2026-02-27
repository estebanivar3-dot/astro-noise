# Glitch Effects Suite + Tonal Targeting — Design

## Overview

Add 8 pixel-based glitch effects to CVLT TOOLS, each as a first-class tool in the nav sidebar. All effects share a common compositor infrastructure that provides interactive canvas control, tonal targeting (shadows/midtones/highlights), non-destructive editing with undo, and effect stacking.

## Architecture: Per-Pixel Effect Pipeline

Every glitch effect is a pure function: `(sourcePixels, config) → processedPixels`. A shared compositor handles blending, masking, and undo.

```
Source ImageData
       ↓
  Effect Function(source, config) → Processed ImageData (cached)
       ↓
  Compositor:
    output[i] = source[i] × (1 - weight) + processed[i] × weight
    where weight = interactiveMask[i] × tonalMask[i]
       ↓
  Canvas Display
```

### Two Modes Per Effect

- **Full image mode**: Interactive mask is all 1s — effect applies everywhere. User adjusts sliders, sees result in real-time.
- **Interactive mode**: Interactive mask starts at 0. Mouse interaction on the canvas controls the effect. The interaction varies per effect:
  - **Directional** (LCD, Channel Shift): drag sets offset direction/magnitude
  - **Area paint** (PIXLT, Fill): drag/click applies effect under cursor
  - **Smear** (Mosh): drag corrupts along path

### Effect Stacking

- Switching tools WITHOUT applying → resets to source, enters new tool fresh
- Clicking "Apply" → bakes result as new source image, can stack another effect
- "Reset" → reverts to original uploaded image (before any applies)

### Non-Destructive Undo (Interactive Mode)

- Each mouse-up (end of stroke/interaction) pushes a mask snapshot to history
- Cmd+Z pops the stack, restores previous mask, recomposites
- Lightweight: only stores Float32Array mask snapshots, not full images

## Shared Infrastructure

### PixelEffect Interface

```typescript
interface PixelEffect {
  id: string;
  apply(source: ImageData, config: Record<string, number>): ImageData;
}
```

Effects know nothing about masks, brushes, or compositing. Pure pixel transforms.

### Compositor (`compositor.ts`)

Manages:
- `processedCache: ImageData | null` — full-image result, recomputed when config changes
- `interactiveMask: Float32Array` — per-pixel 0–1 (full-image mode = all 1s)
- `tonalMask: Float32Array` — per-pixel 0–1 from tonal targeting
- `historyStack: Float32Array[]` — mask snapshots for undo
- `composite()` — blends source + processed using both masks
- `apply()` — bakes composite into new source image (for stacking)

### Interactive Canvas Control (`brush.ts`)

Mouse event handler on the canvas element. Behavior is configurable per effect:

| Interaction type | Mouse behavior | Mask update |
|---|---|---|
| `area-paint` | Drag paints circular area | Sets mask to 1 under cursor with configurable radius + feathered edge |
| `directional` | Drag sets direction vector from drag start to current position | Updates config (offsetX, offsetY), triggers full re-render |
| `stamp` | Click fills at position | Sets mask to 1 in a region around click |
| `smear` | Drag corrupts along path | Sets mask to 1 along drag path |

### Tonal Targeting (`tonal.ts` + `tonal-controls.ts`)

Global section that appears in every tool's right panel:

- Computes per-pixel luminance: `L = 0.299R + 0.587G + 0.114B`
- Three sliders: Shadows, Midtones, Highlights (each 0–100%, default 100%)
- Generates `tonalMask` with smooth transitions between ranges (no hard cutoffs)
- Shadow range: L < 85, Midtone range: 85 < L < 170, Highlight range: L > 170
- Feathered transitions prevent banding artifacts

## The 8 Effects

### 1. Threshold (`threshold.ts`)

Black & white conversion based on luminance cutoff.

- **Config**: `threshold` (0–255, default 128)
- **Algorithm**: `luminance > threshold ? 255 : 0`
- **Interaction**: Full image only (no interactive mode — single slider is sufficient)
- **Controls**: Threshold slider

### 2. Channel Shift (`channel-shift.ts`)

Displaces R, G, B channels in different spatial directions.

- **Config**: `offsetX` (-50–50), `offsetY` (-50–50), `mode` (1–4)
- **Algorithm**: Sample each channel from offset positions
- **Modes**:
  1. R shifts (x,y), G shifts (-x,-y), B stays
  2. R/B shift opposite horizontal, G shifts vertical
  3. All three at 120° angles
  4. Circular rotation
- **Interaction**: `directional` — drag on canvas sets offset vector
- **Controls**: Mode toggle, intensity slider

### 3. LCD (`lcd.ts`)

RGB channel separation + vertical scanline grid. The GOAT.

- **Config**: `intensity` (0–100), `mode` (1–4), `directionX`, `directionY`
- **Algorithm**:
  1. Channel offset: displace R/G/B by intensity × direction (same as channel shift)
  2. Scanline grid: modulate each pixel by `x % 3` column — R cells, G cells, B cells
  3. Brightness compensation: multiply by ~2.5 to counteract 1/3 light reduction
- **Modes**: Different channel offset patterns (which channels go which direction)
- **Interaction**: `directional` — drag controls offset direction
- **Controls**: Mode toggle, intensity slider

### 4. Burn (`burn.ts`)

Destructive contrast/exposure effects mimicking film damage.

- **Config**: `intensity` (0–100), `mode` (1–3)
- **Modes**:
  1. Burn: `pixel² / 255` — darkens midtones, crushes shadows
  2. Dodge: `255 - (255 - pixel)² / 255` — lightens midtones
  3. Solarize: invert pixels above threshold — partial negative
- **Interaction**: Full image mode (slider-driven)
- **Controls**: Mode toggle, intensity slider

### 5. PIXLT (`pixlt.ts`)

Mosaic pixelation — groups pixels into blocks.

- **Config**: `blockSize` (2–64, default 8)
- **Algorithm**: Average color within each blockSize × blockSize block, fill block with average
- **Interaction**: `area-paint` — drag to pixelate under cursor. In full-image mode, pixelates everything.
- **Controls**: Block size slider, brush size slider (interactive mode)

### 6. Fill (`fill.ts`)

Stamps color into areas of the image.

- **Config**: `mode` (random/solid), `color` (hex for solid), `opacity` (0–100)
- **Algorithm**:
  - Random: each pixel gets random RGB values (noise)
  - Solid: flat color fill
- **Interaction**: `stamp` / `area-paint` — click/drag to fill areas
- **Controls**: Mode toggle, color picker (solid mode), opacity slider, brush size slider

### 7. Gradient (`gradient.ts`)

Maps a color gradient across the image via blend modes.

- **Config**: `angle` (0–360°), `colorA` (hex), `colorB` (hex), `blendMode` (overlay/multiply/screen/color)
- **Algorithm**: Generate gradient ramp at angle, blend with source using selected mode
- **Interaction**: Full image mode (slider-driven)
- **Controls**: Angle slider, two color pickers, blend mode toggle

### 8. Mosh (`mosh.ts`)

Datamoshing / compression corruption simulation.

- **Config**: `intensity` (0–100), `blockSize` (8–64), `mode` (1–3)
- **Modes**:
  1. Block shift: randomly displace rectangular blocks
  2. Row glitch: shift entire pixel rows by random offsets
  3. Byte corruption: swap/duplicate raw pixel data chunks
- **Interaction**: `smear` — drag to corrupt along path. Full-image mode applies everywhere.
- **Controls**: Mode toggle, intensity slider, block size slider

## UI Layout

### Navigation (Left Panel)

```
CVLT TOOLS
Image Destruction Toolkit
v0.3.0

DeepDream
Style Transfer
Threshold
Channel Shift
LCD
Burn
PIXLT
Fill
Gradient
Mosh
```

All nav items are the same format — no grouping, no dividers, no "coming soon" labels. Glitch tools don't require model loading so they activate instantly.

### Right Panel (Per Tool)

All controls live in the right panel. Nothing overlays the canvas.

```
┌─────────────────────────┐
│ PARAMETERS              │
│                         │
│ [Effect-specific sliders│
│  and mode toggles]      │
│                         │
│ ─── MODE ─────────────  │
│ (•) Full Image          │
│ ( ) Interactive          │
│                         │
│ [Brush/interaction      │
│  settings if interactive│
│  mode is active]        │
│                         │
│ ─── TONAL TARGETING ──  │
│ Shadows      [====] 100%│
│ Midtones     [====] 100%│
│ Highlights   [====] 100%│
│                         │
├─────────────────────────┤
│ [Apply]  [Reset]        │
├─────────────────────────┤
│ [Export PNG]        ⌘S  │
└─────────────────────────┘
```

### Left Panel

Empty for all glitch effects (same as DeepDream). Reserved for future use (presets, history log, etc).

## File Structure

```
src/
├── effects/
│   ├── types.ts              # PixelEffect interface, InteractionType, shared types
│   ├── compositor.ts         # Mask blending, caching, apply/bake, undo history
│   ├── brush.ts              # Mouse event → mask updates, interaction type dispatch
│   ├── tonal.ts              # Luminance mask generation
│   ├── tonal-controls.ts     # Shared tonal targeting UI section builder
│   ├── effect-tool.ts        # Generic tool factory (wraps any PixelEffect into a Tool)
│   ├── threshold.ts          # Threshold effect
│   ├── channel-shift.ts      # Channel Shift effect
│   ├── lcd.ts                # LCD effect
│   ├── burn.ts               # Burn effect
│   ├── pixlt.ts              # PIXLT effect
│   ├── fill.ts               # Fill effect
│   ├── gradient.ts           # Gradient effect
│   └── mosh.ts               # Mosh effect
├── main.ts                   # Updated: register all 10 tools
├── router.ts                 # Unchanged
├── canvas.ts                 # Minor: expose source image setter for effect stacking
└── ... existing files unchanged
```

Key file: `effect-tool.ts` — a generic factory that takes any `PixelEffect` + its control definitions and produces a complete `Tool` object (right panel UI, compositor wiring, interaction handling). This means each effect file only needs to define `apply()` + its config schema. The tool wrapper handles everything else.

## What's Excluded (YAGNI)

- No layer system beyond single interactive mask
- No preset system
- No GIF export
- No effect chaining (stack by applying sequentially)
- No WebGL shaders — pure CPU pixel manipulation
- Tonal targeting only on glitch effects (DeepDream/Style Transfer can add later)
- No redo (only undo)

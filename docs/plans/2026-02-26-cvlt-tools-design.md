# CVLT TOOLS — Design Document

> "Put your image into a machine that dreams about it wrong."

## Overview

Browser-based image destruction toolkit with AI-powered conversational controls. Combines slider-based manual control with natural language interaction via Transformers.js. No backend, no signup, works offline after initial model download.

## Target Audience

Graphic designers working in underground/punk/zine/streetwear aesthetics who want effects beyond standard glitch tools — organic, biological, AI-adjacent distortions that create uncanny, dream-like imagery for social media and digital output.

## Visual Direction

- Layout inspired by conversational AI app pattern (Figma reference: chat panel left, canvas right)
- Soft, light color palette (#f6f6f6 backgrounds, #e5e5e5 input areas, white panels, #101828 text)
- Clean interface contrasts with destructive output — calm container, chaotic content
- Rounded corners (16px panels, 14px inputs), Inter font family
- Responsive but desktop-first (1280px+ primary target)

## Layout

```
+------------------------------------------+
|  CVLT TOOLS                    [Export]   |
+------------+-----------------------------+
|            |                             |
| Chat &     |                             |
| Effects    |     Canvas                  |
| Panel      |     (drop zone /            |
| (~380px)   |      processed image)       |
|            |                             |
| - AI Chat  |                             |
| - Effect   |                             |
|   Stack    |                             |
| - Sliders  |                             |
|            |                             |
+------------+-----------------------------+
| [chat input: "destroy this image..."]    |
+------------------------------------------+
```

### Left Panel
- Header: app name + new/reset buttons
- Chat history: scrollable, shows AI responses and user commands
- Effect stack: collapsible sections, each with on/off toggle + sliders
- Effects are draggable to reorder (stack order matters)
- Chat input at bottom with send button

### Right Canvas
- Initially shows drop zone ("Drop an image to begin")
- After image load: shows processed result in real-time
- Supports drag-and-drop and file picker
- Export overlay button (PNG, JPEG with quality control, WebP)

## Effects

### AI (Transformers.js Powered)

1. **Chat Interpreter**
   - Small LLM (SmolLM-360M or similar) runs in browser via Transformers.js
   - Interprets natural language: "make it look like a fever dream" -> sets multiple effect params
   - ~200MB one-time download, cached in browser storage

2. **Region Segmentation**
   - Segment-anything-style model for targeting regions
   - "glitch only the background", "melt the face"
   - Generates masks that feed into other effects

3. **Edge Diffusion**
   - AI-detected edges become smear/bleed paths
   - That half-resolved diffusion model aesthetic
   - Controls: bleed amount, edge sensitivity, color bleed vs luminance bleed

4. **Noise Erosion**
   - Structured noise added then selectively resolved
   - Simulates diffusion model stopped at 30-70% denoising
   - Controls: noise level, resolution steps, structure preservation

### Resonance (Feedback & Recursion)

5. **Feedback Loop**
   - Output -> transform -> feed back in, N iterations
   - Transform options: zoom, rotate, shift, color drift
   - Controls: iterations (1-50), transform type, transform amount

6. **Fractal Echo**
   - Image echoes inward/outward at decreasing scales
   - Creates recursive mirror/mandala effects
   - Controls: echo count, scale factor, blend mode

7. **Cellular Automata**
   - Game of Life rules using pixel brightness as alive/dead
   - Image regions eat each other, grow, die
   - Controls: rules (Life, Highlife, custom), generations, threshold

8. **Slit-Scan**
   - Each pixel row/column reads from different spatial offset
   - Stretches and warps reality in uncanny ways
   - Controls: direction, offset curve, scan speed

9. **Seam Carve (Broken)**
   - Content-aware resize intentionally corrupted
   - Faces compress, buildings fold, space collapses
   - Controls: target size, energy function (broken), iterations

### Noise (Organic Interference)

10. **Reaction-Diffusion**
    - Turing patterns grown on image data
    - Produces veins, coral, alien skin, organic growth
    - Controls: feed rate, kill rate, diffusion speed, iterations

11. **Domain Warping**
    - Stacked noise functions feeding into each other
    - Creates alien landscape / early AI art distortion
    - Controls: octaves, warp intensity, noise type, scale

12. **Pixel Migration**
    - Pixels drift based on brightness/hue/saturation rules
    - Image appears to melt or flow organically
    - Controls: migration rule, speed, iterations, attraction

13. **Frequency Mangle**
    - FFT image -> delete/swap/corrupt frequency bands -> inverse FFT
    - Creates "something is wrong but you can't say what" feeling
    - Controls: affected bands, corruption type, mix amount

14. **Random Kernels**
    - Randomly generated convolution filters
    - Unpredictable results — roll the dice
    - Controls: kernel size, randomize button, intensity

15. **Voronoi Shatter**
    - Organic cell decomposition of image
    - Each cell gets its own color treatment
    - Controls: cell count, edge thickness, color mode

### Essentials

16. **Grain** — amount, size, monochrome toggle
17. **Threshold** — B&W crush, adjustable level
18. **Channel Shift** — RGB offset amounts per channel
19. **Pixel Sort** — direction, threshold, sort-by (brightness/hue/sat)
20. **Halftone** — dot size, angle, CMYK mode

## Effect Stack Behavior

- Effects are applied in stack order (top to bottom)
- Each effect has: on/off toggle, collapse/expand, drag handle
- Reordering changes the output (pixel sort before grain ≠ grain before pixel sort)
- "Randomize All" button for happy accidents
- Presets: save/load effect stack configurations

## AI Chat Behavior

- Chat bar at bottom of left panel
- User types natural language or commands
- System interprets and adjusts sliders accordingly
- Chat shows what was changed: "Set grain to 0.8, enabled threshold at 0.4, added feedback loop x3"
- Keywords map to presets: "zine", "vhs", "fever dream", "underwater", "deep fried"
- Supports "more", "less", "undo", "reset"

## Technical Architecture

### Frontend
- **Single HTML file** with embedded CSS/JS (or small build with Vite)
- **Canvas API** for 2D effects (pixel sort, grain, threshold, channel shift, halftone)
- **WebGL/GPU.js** for compute-heavy effects (reaction-diffusion, domain warping, FFT, feedback loops)
- **Transformers.js** for LLM chat + image segmentation

### Processing Pipeline
1. User drops image -> stored as source ImageData
2. Effect stack iterates top-to-bottom
3. Each effect reads current buffer, applies transform, writes back
4. Canvas displays final buffer
5. Export reads final buffer

### Performance
- Effects run on requestAnimationFrame when parameters change
- Heavy effects (reaction-diffusion, cellular automata) use WebGL shaders
- Debounce slider changes to avoid excessive recomputation
- "Preview quality" toggle: process at half-res while adjusting, full-res on release

### AI Models (Transformers.js)
- **Chat/Command**: SmolLM-360M-Instruct (small, fast, runs in browser)
- **Segmentation**: SAM-base or similar (for region targeting)
- Models downloaded on first use, cached in IndexedDB
- App fully functional without AI (sliders still work)

## Export

- **PNG** — lossless, full quality
- **JPEG** — with quality slider (low quality = intentional compression artifacts as effect)
- **WebP** — modern format, good quality/size ratio
- Export at original resolution or custom size

## Future Considerations (not v1)

- Video frame processing
- GIF export with animation (effects over time)
- Shareable preset links
- Layer system (multiple images composited)
- MIDI controller mapping for live performance

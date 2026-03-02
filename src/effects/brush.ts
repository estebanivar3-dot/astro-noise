/**
 * Interactive canvas control — handles mouse events on the canvas
 * and translates them into mask updates or directional vectors.
 */

import type { InteractionType } from './types.ts';

export type DirectionMode = 'relative' | 'absolute';

export interface BrushController {
  attach(canvas: HTMLCanvasElement): void;
  detach(): void;
  setInteractionType(type: InteractionType): void;
  setBrushRadius(radius: number): void;
  setBrushSoftness(softness: number): void;
  /** Set brush opacity for stacking mode (0-1). Each stroke adds this much. */
  setBrushIntensity(intensity: number): void;
  /** When true, strokes accumulate additively instead of painting to 1.0 */
  setAdditive(additive: boolean): void;
  /** 'relative' = offset from drag start (default). 'absolute' = offset from canvas center. */
  setDirectionMode(mode: DirectionMode): void;
  getMask(): Float32Array | null;
  getDirection(): { x: number; y: number };
  getCanvas(): HTMLCanvasElement | null;
  clearMask(): void;
  setMask(mask: Float32Array): void;
  onChange(callback: () => void): void;
  onDragStart(callback: () => void): void;
  onStrokeEnd(callback: () => void): void;
}

export function createBrushController(): BrushController {
  let canvas: HTMLCanvasElement | null = null;
  let interactionType: InteractionType = 'none';
  let brushRadius = 20;
  let brushSoftness = 0.5;
  let brushIntensity = 1.0;
  let additive = false;
  let directionMode: DirectionMode = 'relative';
  let mask: Float32Array | null = null;
  let directionX = 0;
  let directionY = 0;
  let isDrawing = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let changeCallback: (() => void) | null = null;
  let dragStartCallback: (() => void) | null = null;
  let strokeEndCallback: (() => void) | null = null;

  // Cursor overlay
  let cursorOverlay: HTMLDivElement | null = null;

  let onMouseDown: ((e: MouseEvent) => void) | null = null;
  let onMouseMove: ((e: MouseEvent) => void) | null = null;
  let onMouseUp: ((e: MouseEvent) => void) | null = null;
  let onMouseMoveCanvas: ((e: MouseEvent) => void) | null = null;
  let onMouseLeaveCanvas: ((e: MouseEvent) => void) | null = null;

  function canvasCoords(e: MouseEvent): { x: number; y: number } {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }

  function paintCircle(cx: number, cy: number): void {
    if (!mask || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    const r = brushRadius;
    const minX = Math.max(0, cx - r);
    const maxX = Math.min(w - 1, cx + r);
    const minY = Math.max(0, cy - r);
    const maxY = Math.min(h - 1, cy + r);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist > r) continue;
        const idx = y * w + x;
        const edgeFactor = brushSoftness > 0
          ? 1 - Math.pow(dist / r, 1 / brushSoftness)
          : (dist < r ? 1 : 0);
        const val = Math.max(0, edgeFactor);
        if (additive) {
          // Stacking: each stroke adds brushIntensity * shape to the mask
          mask[idx] = Math.min(1, mask[idx] + brushIntensity * val);
        } else {
          mask[idx] = Math.max(mask[idx], val);
        }
      }
    }
  }

  function ensureMask(): void {
    if (!canvas) return;
    if (!mask || mask.length !== canvas.width * canvas.height) {
      mask = new Float32Array(canvas.width * canvas.height);
    }
  }

  function createCursorOverlay(): void {
    if (cursorOverlay) return;
    cursorOverlay = document.createElement('div');
    cursorOverlay.style.position = 'absolute';
    cursorOverlay.style.pointerEvents = 'none';
    cursorOverlay.style.border = '1.5px solid rgba(255,255,255,0.7)';
    cursorOverlay.style.borderRadius = '50%';
    cursorOverlay.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.4)';
    cursorOverlay.style.display = 'none';
    cursorOverlay.style.zIndex = '10';
    // Insert into canvas parent
    if (canvas?.parentElement) {
      canvas.parentElement.style.position = 'relative';
      canvas.parentElement.appendChild(cursorOverlay);
    }
  }

  function removeCursorOverlay(): void {
    if (cursorOverlay) {
      cursorOverlay.remove();
      cursorOverlay = null;
    }
  }

  function updateCursorPosition(e: MouseEvent): void {
    if (!cursorOverlay || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const displayRadius = brushRadius * scaleX;
    const diameter = displayRadius * 2;

    cursorOverlay.style.width = `${diameter}px`;
    cursorOverlay.style.height = `${diameter}px`;
    cursorOverlay.style.left = `${e.clientX - rect.left - displayRadius + canvas.offsetLeft}px`;
    cursorOverlay.style.top = `${e.clientY - rect.top - displayRadius + canvas.offsetTop}px`;
    cursorOverlay.style.display = 'block';
  }

  function showBrushCursor(): boolean {
    return interactionType === 'area-paint' || interactionType === 'smear';
  }

  return {
    attach(c: HTMLCanvasElement): void {
      canvas = c;

      // Apply cursor style for the already-set interactionType
      // (setInteractionType is called before attach, so the cursor wasn't applied yet)
      if (interactionType === 'none') {
        canvas.style.cursor = 'default';
      } else if (interactionType === 'area-paint' || interactionType === 'smear') {
        canvas.style.cursor = 'none';
      } else {
        canvas.style.cursor = 'crosshair';
      }

      onMouseDown = (e: MouseEvent) => {
        if (interactionType === 'none') return;
        isDrawing = true;
        const { x, y } = canvasCoords(e);
        dragStartX = x;
        dragStartY = y;

        // Ensure mask exists before dragStart so history can snapshot it
        if (interactionType === 'area-paint' || interactionType === 'smear') {
          ensureMask();
        }
        dragStartCallback?.();

        if (interactionType === 'directional' && directionMode === 'absolute' && canvas) {
          directionX = x - canvas.width / 2;
          directionY = y - canvas.height / 2;
          changeCallback?.();
        } else if (interactionType === 'area-paint' || interactionType === 'smear') {
          paintCircle(x, y);
          changeCallback?.();
        }
      };

      onMouseMove = (e: MouseEvent) => {
        if (!isDrawing) return;
        const { x, y } = canvasCoords(e);

        if (interactionType === 'directional') {
          if (directionMode === 'absolute' && canvas) {
            // Absolute: direction from canvas center
            directionX = x - canvas.width / 2;
            directionY = y - canvas.height / 2;
          } else {
            // Relative: direction from drag start
            directionX = x - dragStartX;
            directionY = y - dragStartY;
          }
          changeCallback?.();
        } else if (interactionType === 'area-paint' || interactionType === 'smear') {
          paintCircle(x, y);
          changeCallback?.();
        }
      };

      onMouseUp = () => {
        if (!isDrawing) return;
        isDrawing = false;
        strokeEndCallback?.();
      };

      // Cursor overlay for brush size
      onMouseMoveCanvas = (e: MouseEvent) => {
        if (showBrushCursor()) {
          if (!cursorOverlay) createCursorOverlay();
          updateCursorPosition(e);
        }
      };

      onMouseLeaveCanvas = () => {
        if (cursorOverlay) cursorOverlay.style.display = 'none';
      };

      canvas.addEventListener('mousedown', onMouseDown);
      canvas.addEventListener('mousemove', onMouseMoveCanvas);
      canvas.addEventListener('mouseleave', onMouseLeaveCanvas);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },

    detach(): void {
      if (canvas && onMouseDown) {
        canvas.removeEventListener('mousedown', onMouseDown);
      }
      if (canvas && onMouseMoveCanvas) {
        canvas.removeEventListener('mousemove', onMouseMoveCanvas);
      }
      if (canvas && onMouseLeaveCanvas) {
        canvas.removeEventListener('mouseleave', onMouseLeaveCanvas);
      }
      if (onMouseMove) {
        window.removeEventListener('mousemove', onMouseMove);
      }
      if (onMouseUp) {
        window.removeEventListener('mouseup', onMouseUp);
      }
      removeCursorOverlay();
      if (typeof window !== 'undefined' && window.__cvlt) {
        window.__cvlt.brushInteraction = 'none';
      }
      canvas = null;
      onMouseDown = null;
      onMouseMove = null;
      onMouseUp = null;
      onMouseMoveCanvas = null;
      onMouseLeaveCanvas = null;
    },

    setInteractionType(type: InteractionType): void {
      interactionType = type;
      // Broadcast so canvas knows whether clicks should open the file picker
      if (typeof window !== 'undefined' && window.__cvlt) {
        window.__cvlt.brushInteraction = type;
      }
      if (canvas) {
        if (type === 'none') {
          canvas.style.cursor = 'default';
        } else if (type === 'area-paint' || type === 'smear') {
          canvas.style.cursor = 'none'; // brush overlay replaces native cursor
        } else {
          canvas.style.cursor = 'crosshair';
        }
      }
      if (!showBrushCursor()) {
        removeCursorOverlay();
      }
    },

    setBrushRadius(r: number): void { brushRadius = r; },
    setBrushSoftness(s: number): void { brushSoftness = s; },
    setBrushIntensity(i: number): void { brushIntensity = i; },
    setAdditive(a: boolean): void { additive = a; },
    setDirectionMode(mode: DirectionMode): void { directionMode = mode; },
    getMask(): Float32Array | null { return mask; },
    getDirection(): { x: number; y: number } { return { x: directionX, y: directionY }; },
    getCanvas(): HTMLCanvasElement | null { return canvas; },

    clearMask(): void {
      if (mask) mask.fill(0);
      directionX = 0;
      directionY = 0;
    },

    setMask(m: Float32Array): void {
      mask = new Float32Array(m);
    },

    onChange(callback: () => void): void { changeCallback = callback; },
    onDragStart(callback: () => void): void { dragStartCallback = callback; },
    onStrokeEnd(callback: () => void): void { strokeEndCallback = callback; },
  };
}

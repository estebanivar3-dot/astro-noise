/**
 * Interactive canvas control — handles mouse events on the canvas
 * and translates them into mask updates or directional vectors.
 */

import type { InteractionType } from './types.ts';

export interface BrushController {
  attach(canvas: HTMLCanvasElement): void;
  detach(): void;
  setInteractionType(type: InteractionType): void;
  setBrushRadius(radius: number): void;
  setBrushSoftness(softness: number): void;
  getMask(): Float32Array | null;
  getDirection(): { x: number; y: number };
  clearMask(): void;
  setMask(mask: Float32Array): void;
  onChange(callback: () => void): void;
  onStrokeEnd(callback: () => void): void;
}

export function createBrushController(): BrushController {
  let canvas: HTMLCanvasElement | null = null;
  let interactionType: InteractionType = 'none';
  let brushRadius = 20;
  let brushSoftness = 0.5;
  let mask: Float32Array | null = null;
  let directionX = 0;
  let directionY = 0;
  let isDrawing = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let changeCallback: (() => void) | null = null;
  let strokeEndCallback: (() => void) | null = null;

  let onMouseDown: ((e: MouseEvent) => void) | null = null;
  let onMouseMove: ((e: MouseEvent) => void) | null = null;
  let onMouseUp: ((e: MouseEvent) => void) | null = null;

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
        mask[idx] = Math.max(mask[idx], Math.max(0, edgeFactor));
      }
    }
  }

  function ensureMask(): void {
    if (!canvas) return;
    if (!mask || mask.length !== canvas.width * canvas.height) {
      mask = new Float32Array(canvas.width * canvas.height);
    }
  }

  return {
    attach(c: HTMLCanvasElement): void {
      canvas = c;

      onMouseDown = (e: MouseEvent) => {
        if (interactionType === 'none') return;
        isDrawing = true;
        const { x, y } = canvasCoords(e);
        dragStartX = x;
        dragStartY = y;

        if (interactionType === 'area-paint' || interactionType === 'smear') {
          ensureMask();
          paintCircle(x, y);
          changeCallback?.();
        }
      };

      onMouseMove = (e: MouseEvent) => {
        if (!isDrawing) return;
        const { x, y } = canvasCoords(e);

        if (interactionType === 'directional') {
          directionX = x - dragStartX;
          directionY = y - dragStartY;
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

      canvas.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },

    detach(): void {
      if (canvas && onMouseDown) {
        canvas.removeEventListener('mousedown', onMouseDown);
      }
      if (onMouseMove) {
        window.removeEventListener('mousemove', onMouseMove);
      }
      if (onMouseUp) {
        window.removeEventListener('mouseup', onMouseUp);
      }
      canvas = null;
      onMouseDown = null;
      onMouseMove = null;
      onMouseUp = null;
    },

    setInteractionType(type: InteractionType): void {
      interactionType = type;
      if (canvas) {
        canvas.style.cursor = type === 'none' ? 'default' : 'crosshair';
      }
    },

    setBrushRadius(r: number): void { brushRadius = r; },
    setBrushSoftness(s: number): void { brushSoftness = s; },
    getMask(): Float32Array | null { return mask; },
    getDirection(): { x: number; y: number } { return { x: directionX, y: directionY }; },

    clearMask(): void {
      if (mask) mask.fill(0);
      directionX = 0;
      directionY = 0;
    },

    setMask(m: Float32Array): void {
      mask = new Float32Array(m);
    },

    onChange(callback: () => void): void { changeCallback = callback; },
    onStrokeEnd(callback: () => void): void { strokeEndCallback = callback; },
  };
}

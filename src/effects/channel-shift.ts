/**
 * Channel Shift — displaces R, G, B channels in different directions.
 */

import type { PixelEffect, EffectConfig, EffectToolDef } from './types.ts';

function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

const channelShiftEffect: PixelEffect = {
  id: 'channel-shift',
  label: 'Channel Shift',
  interactionType: 'directional',

  apply(source: ImageData, config: EffectConfig): ImageData {
    const intensity = (config['intensity'] ?? 100) / 100;
    const mode = config['mode'] ?? 0;
    // X/Y come from drag-bound sliders (or manual adjustment)
    const dx = (config['shiftX'] ?? 0) * intensity;
    const dy = (config['shiftY'] ?? 0) * intensity;

    const { width, height, data } = source;
    const out = new ImageData(width, height);
    const dst = out.data;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        let rOx: number, rOy: number, gOx: number, gOy: number, bOx: number, bOy: number;

        switch (mode) {
          case 1:
            rOx = dx; rOy = 0;
            gOx = 0; gOy = dy;
            bOx = -dx; bOy = 0;
            break;
          case 2:
            rOx = dx; rOy = dy;
            gOx = dx * Math.cos(2.094) - dy * Math.sin(2.094);
            gOy = dx * Math.sin(2.094) + dy * Math.cos(2.094);
            bOx = dx * Math.cos(4.189) - dy * Math.sin(4.189);
            bOy = dx * Math.sin(4.189) + dy * Math.cos(4.189);
            break;
          case 3:
            rOx = dx; rOy = dy;
            gOx = -dy; gOy = dx;
            bOx = dy; bOy = -dx;
            break;
          default:
            rOx = dx; rOy = dy;
            gOx = -dx; gOy = -dy;
            bOx = 0; bOy = 0;
            break;
        }

        const rSx = clamp(Math.round(x - rOx), 0, width - 1);
        const rSy = clamp(Math.round(y - rOy), 0, height - 1);
        const gSx = clamp(Math.round(x - gOx), 0, width - 1);
        const gSy = clamp(Math.round(y - gOy), 0, height - 1);
        const bSx = clamp(Math.round(x - bOx), 0, width - 1);
        const bSy = clamp(Math.round(y - bOy), 0, height - 1);

        dst[i]     = data[(rSy * width + rSx) * 4];
        dst[i + 1] = data[(gSy * width + gSx) * 4 + 1];
        dst[i + 2] = data[(bSy * width + bSx) * 4 + 2];
        dst[i + 3] = data[i + 3];
      }
    }

    return out;
  },
};

export const channelShiftDef: EffectToolDef = {
  effect: channelShiftEffect,
  sliders: [
    { key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, defaultValue: 100, hint: 'Strength of channel separation' },
    { key: 'shiftX', label: 'X', min: -500, max: 500, step: 1, defaultValue: 0, dragBind: 'x' },
    { key: 'shiftY', label: 'Y', min: -500, max: 500, step: 1, defaultValue: 0, dragBind: 'y' },
  ],
  modes: [
    { key: 'mode', modes: ['Split', 'Cross', 'Tri-angle', 'Circular'], defaultIndex: 0 },
  ],
  dragMapping: '2d',
};

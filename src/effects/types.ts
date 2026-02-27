/**
 * Shared types for the pixel effects system.
 */

export type InteractionType = 'none' | 'directional' | 'area-paint' | 'smear';

export type EffectConfig = Record<string, number>;

export interface PixelEffect {
  id: string;
  label: string;
  apply(source: ImageData, config: EffectConfig): ImageData;
  interactionType: InteractionType;
}

export interface SliderDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  hint?: string;
}

export interface ModeDef {
  key: string;
  modes: string[];
  defaultIndex?: number;
}

export interface EffectToolDef {
  effect: PixelEffect;
  sliders: SliderDef[];
  modes?: ModeDef[];
  supportsInteractive?: boolean;
}

/**
 * Shared types for the pixel effects system.
 */

export type InteractionType = 'none' | 'directional' | 'area-paint' | 'smear' | 'point-fill';

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
  /** For 2D effects: bind this slider to a drag axis so it updates live during drag */
  dragBind?: 'x' | 'y';
  /** When true, the drag-distance → intensity mapping skips this slider */
  noIntensityMap?: boolean;
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
  /** '1d' = dir.x → primary slider (default). '2d' = magnitude → slider + inject directionX/Y */
  dragMapping?: '1d' | '2d';
  /** When true, brush strokes stack additively using the intensity slider as brush opacity */
  stackingBrush?: boolean;
}

/**
 * Re-Dream Engine — local randomizer that chains random destruction effects.
 *
 * No API calls. Picks N random effects from the pool, rolls random parameters
 * within each slider's range, and pipes the ImageData through them.
 */

import type { EffectToolDef } from '../effects/types.ts';

// Effects to exclude from the randomizer pool.
// fill/gradient overwrite the image, seam-carve resizes it, colorize is too subtle.
const EXCLUDED_IDS = new Set(['fill', 'gradient', 'seam-carve', 'colorize']);

export interface RedreamOptions {
  /** How many effects to chain (1–6). */
  iterations: number;
  /** 0–100 — biases random params toward extremes. */
  intensity: number;
}

/**
 * Run the Re-Dream randomizer: pick random effects, randomize params, chain them.
 *
 * @param source     - Current canvas ImageData.
 * @param allDefs    - Every registered EffectToolDef.
 * @param options    - Iterations + intensity.
 * @param onProgress - Optional status callback per step.
 * @returns New ImageData after chaining.
 */
export function redream(
  source: ImageData,
  allDefs: readonly EffectToolDef[],
  options: RedreamOptions,
  onProgress?: (status: string) => void,
): ImageData {
  const pool = allDefs.filter((d) => !EXCLUDED_IDS.has(d.effect.id));
  if (pool.length === 0) throw new Error('No effects available');

  const count = Math.max(1, Math.min(6, options.iterations));
  const intensity = Math.max(0, Math.min(100, options.intensity)) / 100;

  // Pick random effects (allow repeats — doubling up is part of the chaos)
  const picks: EffectToolDef[] = [];
  for (let i = 0; i < count; i++) {
    picks.push(pool[Math.floor(Math.random() * pool.length)]);
  }

  let current = source;

  for (let i = 0; i < picks.length; i++) {
    const def = picks[i];
    onProgress?.(`${i + 1}/${picks.length}: ${def.effect.label}…`);

    // Build random config from slider definitions
    const config: Record<string, number> = {};

    for (const s of def.sliders) {
      // Anchor at default, drift toward random target based on intensity
      const randomTarget = s.min + Math.random() * (s.max - s.min);
      const value = s.defaultValue + intensity * (randomTarget - s.defaultValue);
      // Snap to step and clamp
      config[s.key] = Math.max(s.min, Math.min(s.max,
        Math.round(value / s.step) * s.step,
      ));
    }

    // Random mode selection
    if (def.modes && def.modes.length > 0) {
      for (const m of def.modes) {
        config[m.key] = Math.floor(Math.random() * m.modes.length);
      }
    }

    // Synthetic drag direction for directional effects
    // Keep magnitude gentle — large values obliterate
    if (def.effect.interactionType === 'directional') {
      const angle = Math.random() * Math.PI * 2;
      const mag = 5 + Math.random() * 25 * intensity;
      config['directionX'] = Math.cos(angle) * mag;
      config['directionY'] = Math.sin(angle) * mag;
    }

    current = def.effect.apply(current, config);
  }

  onProgress?.('Done');
  return current;
}

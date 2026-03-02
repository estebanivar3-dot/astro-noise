/**
 * Re-Dream API wrapper — sends a canvas image through the HF imageToImage
 * endpoint for partial re-generation via Stable Diffusion.
 *
 * Same security model as generate: HTTPS request, image bytes response,
 * no model weights, no code execution.
 */

import { InferenceClient } from '@huggingface/inference';
import { blobToImageData } from './api.ts';
import type { ModelEntry } from './api.ts';

// ---------------------------------------------------------------------------
// Models suited for image-to-image
// ---------------------------------------------------------------------------

// All img2img models require fal-ai provider (paid credits).
// No free serverless img2img models exist on HF as of 2025.
export const IMG2IMG_MODELS: readonly ModelEntry[] = [
  { id: 'black-forest-labs/FLUX.1-Kontext-dev', label: 'FLUX Kontext', desc: 'Context-aware editing', provider: 'fal-ai' },
  { id: 'black-forest-labs/FLUX.2-dev', label: 'FLUX.2 Dev', desc: 'High quality restyle', provider: 'fal-ai' },
  { id: 'Qwen/Qwen-Image-Edit', label: 'Qwen Image Edit', desc: 'Instruction-based editing', provider: 'fal-ai' },
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface RedreamConfig {
  prompt: string;
  model: string;
  token: string;
  guidance: number;
  steps: number;
  provider?: string;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Send an image through the HF imageToImage API for partial re-generation.
 *
 * @param imageBlob - The canvas image as a PNG Blob.
 * @param config    - Prompt, model, and inference parameters.
 * @param onProgress - Optional status callback.
 * @returns Re-dreamed ImageData ready for the canvas.
 */
export async function redreamImage(
  imageBlob: Blob,
  config: RedreamConfig,
  onProgress?: (status: string) => void,
): Promise<ImageData> {
  onProgress?.('Connecting to Hugging Face\u2026');

  const client = new InferenceClient(config.token);

  onProgress?.(`Re-dreaming with ${config.model.split('/').pop()}\u2026`);

  const resultBlob = await client.imageToImage({
    provider: config.provider as "fal-ai" | undefined,
    model: config.model,
    inputs: imageBlob,
    parameters: {
      prompt: config.prompt || undefined,
      guidance_scale: config.guidance,
      num_inference_steps: config.steps,
      seed: Math.floor(Math.random() * 2147483647),
    },
  }) as unknown as Blob;

  onProgress?.('Decoding image\u2026');

  return blobToImageData(resultBlob);
}

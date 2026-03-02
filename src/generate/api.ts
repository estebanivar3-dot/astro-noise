/**
 * HF Inference API wrapper for text-to-image generation.
 *
 * Makes HTTPS requests to Hugging Face's serverless inference endpoints.
 * Returns raw image bytes (Blob) decoded into ImageData — no model weights
 * downloaded, no code execution, no deserialization.
 */

import { InferenceClient } from '@huggingface/inference';

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export interface ModelEntry {
  id: string;
  label: string;
  desc: string;
  /** Inference provider — omit for HF serverless default. */
  provider?: string;
}

export const MODELS: readonly ModelEntry[] = [
  { id: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1 Schnell', desc: 'Fast, modern (2024)' },
  { id: 'stabilityai/stable-diffusion-xl-base-1.0', label: 'SDXL 1.0', desc: 'Detailed, mid-era (2023)' },
  { id: 'stabilityai/stable-diffusion-3-medium-diffusers', label: 'SD 3 Medium', desc: 'Balanced quality (2024)' },
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface GenerateConfig {
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
 * Generate an image from a text prompt via the HF Inference API.
 * Returns an ImageData ready to display on canvas.
 */
export async function generateImage(
  config: GenerateConfig,
  onProgress?: (status: string) => void,
): Promise<ImageData> {
  onProgress?.('Connecting to Hugging Face…');

  const client = new InferenceClient(config.token);

  onProgress?.(`Generating with ${config.model.split('/').pop()}…`);

  const blob = await client.textToImage(
    {
      provider: config.provider as "fal-ai" | undefined,
      model: config.model,
      inputs: config.prompt,
      parameters: {
        guidance_scale: config.guidance,
        num_inference_steps: config.steps,
        seed: Math.floor(Math.random() * 2147483647),
      },
    },
    { outputType: 'blob' },
  );

  onProgress?.('Decoding image…');

  return blobToImageData(blob);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode an image Blob into ImageData using the browser's native image decoder.
 * No custom deserialization — same path as loading a JPEG from disk.
 */
export function blobToImageData(blob: Blob): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, w, h));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode generated image'));
    };

    img.src = url;
  });
}

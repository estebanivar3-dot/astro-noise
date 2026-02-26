/**
 * Export utility — downloads the canvas content as an image file.
 */

export type ExportFormat = 'png' | 'jpeg' | 'webp';

const MIME_TYPES: Record<ExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * Export the current canvas content as a downloadable image.
 *
 * @param canvas  - The canvas element to export.
 * @param format  - Image format: 'png', 'jpeg', or 'webp'.
 * @param quality - Quality hint for lossy formats (0-1). Ignored for PNG.
 */
export function exportCanvas(
  canvas: HTMLCanvasElement,
  format: ExportFormat = 'png',
  quality?: number,
): void {
  const mimeType = MIME_TYPES[format];
  const dataURL = canvas.toDataURL(mimeType, quality);

  const anchor = document.createElement('a');
  anchor.href = dataURL;
  anchor.download = `cvlt-dream.${format}`;
  anchor.click();
}

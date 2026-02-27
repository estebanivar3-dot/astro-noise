/**
 * Canvas manager — handles image drop zone, canvas rendering, and source image storage.
 */

export function createCanvasManager() {
  const dropZone = document.getElementById('drop-zone') as HTMLDivElement;
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
  const canvasInfo = document.querySelector('.canvas-info') as HTMLSpanElement | null;
  const ctx = canvas.getContext('2d')!;

  let sourceImage: ImageData | null = null;
  let originalSource: ImageData | null = null;

  // ---- Drop zone interactions ----

  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  dropZone.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith('image/')) {
      loadImageFile(file);
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
      loadImageFile(file);
    }
  });

  // ---- Image loading ----

  function loadImageFile(file: File): void {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      sourceImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
      originalSource = sourceImage;
      URL.revokeObjectURL(url);

      if (canvasInfo) {
        canvasInfo.textContent = `${img.naturalWidth} x ${img.naturalHeight}`;
      }

      // Toggle visibility
      dropZone.hidden = true;
      canvas.hidden = false;
      exportBtn.disabled = false;

      // Notify the rest of the app
      window.dispatchEvent(new CustomEvent('cvlt:image-loaded'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      console.error('Failed to load image file:', file.name);
    };
    img.src = url;
  }

  // ---- Public API ----

  function getSourceImage(): ImageData | null {
    return sourceImage;
  }

  function displayImageData(imageData: ImageData): void {
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    ctx.putImageData(imageData, 0, 0);
  }

  function getCanvas(): HTMLCanvasElement {
    return canvas;
  }

  function setSourceImage(imageData: ImageData): void {
    sourceImage = imageData;
    displayImageData(imageData);
  }

  function getOriginalSource(): ImageData | null {
    return originalSource;
  }

  function resetToOriginal(): void {
    if (originalSource) {
      sourceImage = originalSource;
      displayImageData(originalSource);
    }
  }

  return { getSourceImage, displayImageData, getCanvas, setSourceImage, getOriginalSource, resetToOriginal };
}

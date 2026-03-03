/**
 * Style image picker — drop zone and thumbnail preview for the left panel.
 *
 * Follows the same drag-and-drop pattern as the main canvas drop zone
 * (canvas.ts), adapted for the narrower left panel width.
 */

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface StylePicker {
  /** Tear down all DOM elements and event listeners. */
  destroy(): void;
  /** Return the currently loaded style image, or null if none selected. */
  getStyleImage(): ImageData | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the style picker UI inside `container` and call `onStyleSelected`
 * whenever a new style image is loaded.
 */
export function createStylePicker(
  container: HTMLElement,
  onStyleSelected: (imageData: ImageData) => void,
): StylePicker {
  let styleImage: ImageData | null = null;

  // ---- Section label ----
  const sectionLabel = document.createElement('div');
  sectionLabel.className = 'section-label';
  sectionLabel.textContent = 'Style Reference';
  container.appendChild(sectionLabel);

  // ---- Drop zone ----
  const dropZone = document.createElement('div');
  dropZone.className = 'drop-zone style-drop-zone';

  const dropContent = document.createElement('div');
  dropContent.className = 'drop-zone-content';

  const dropIcon = document.createElement('div');
  dropIcon.className = 'drop-icon';
  dropIcon.textContent = '+';

  const dropTitle = document.createElement('p');
  dropTitle.className = 'drop-zone-title';
  dropTitle.textContent = 'Drop a style image';

  const dropSubtitle = document.createElement('p');
  dropSubtitle.className = 'drop-zone-subtitle';
  dropSubtitle.textContent = 'or click to browse';

  const dropFormats = document.createElement('p');
  dropFormats.className = 'drop-formats';
  dropFormats.textContent = '.jpg .png .webp';

  dropContent.appendChild(dropIcon);
  dropContent.appendChild(dropTitle);
  dropContent.appendChild(dropSubtitle);
  dropContent.appendChild(dropFormats);
  dropZone.appendChild(dropContent);

  // Hidden file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;
  dropZone.appendChild(fileInput);

  container.appendChild(dropZone);

  // ---- Thumbnail preview (hidden initially) ----
  const preview = document.createElement('div');
  preview.className = 'style-preview';
  preview.hidden = true;

  const thumbnail = document.createElement('canvas');
  thumbnail.className = 'style-thumbnail';

  const changeHint = document.createElement('div');
  changeHint.className = 'style-change-hint';
  changeHint.textContent = 'Click to change';

  preview.appendChild(thumbnail);
  preview.appendChild(changeHint);
  container.appendChild(preview);

  // ---- Event handlers ----

  function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  }

  function handleDragLeave(): void {
    dropZone.classList.remove('drag-over');
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith('image/')) {
      loadImageFile(file);
    }
  }

  function handleClick(): void {
    fileInput.click();
  }

  function handleFileChange(): void {
    const file = fileInput.files?.[0];
    if (file) {
      loadImageFile(file);
    }
  }

  // Also allow drag-and-drop on the preview thumbnail for re-selection.
  function handlePreviewDragOver(e: DragEvent): void {
    e.preventDefault();
    preview.classList.add('drag-over');
  }

  function handlePreviewDragLeave(): void {
    preview.classList.remove('drag-over');
  }

  function handlePreviewDrop(e: DragEvent): void {
    e.preventDefault();
    preview.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith('image/')) {
      loadImageFile(file);
    }
  }

  dropZone.addEventListener('dragover', handleDragOver);
  dropZone.addEventListener('dragleave', handleDragLeave);
  dropZone.addEventListener('drop', handleDrop);
  dropZone.addEventListener('click', handleClick);
  fileInput.addEventListener('change', handleFileChange);

  preview.addEventListener('dragover', handlePreviewDragOver);
  preview.addEventListener('dragleave', handlePreviewDragLeave);
  preview.addEventListener('drop', handlePreviewDrop);
  preview.addEventListener('click', handleClick);

  // ---- Image loading ----

  function loadImageFile(file: File): void {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Draw to offscreen canvas to get ImageData
      const offscreen = document.createElement('canvas');
      offscreen.width = img.naturalWidth;
      offscreen.height = img.naturalHeight;
      const offCtx = offscreen.getContext('2d')!;
      offCtx.drawImage(img, 0, 0);
      styleImage = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
      URL.revokeObjectURL(url);

      // Draw thumbnail preview
      drawThumbnail(img);

      // Show preview, hide drop zone
      dropZone.hidden = true;
      preview.hidden = false;

      // Notify parent
      onStyleSelected(styleImage);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function drawThumbnail(img: HTMLImageElement): void {
    // Fit the thumbnail to the left panel width (268px = 300 - 2*16 padding)
    const maxWidth = 268;
    const aspect = img.naturalWidth / img.naturalHeight;
    const drawWidth = Math.min(maxWidth, img.naturalWidth);
    const drawHeight = drawWidth / aspect;

    thumbnail.width = drawWidth;
    thumbnail.height = drawHeight;
    const tCtx = thumbnail.getContext('2d')!;
    tCtx.drawImage(img, 0, 0, drawWidth, drawHeight);
  }

  // ---- Cleanup ----

  function destroy(): void {
    dropZone.removeEventListener('dragover', handleDragOver);
    dropZone.removeEventListener('dragleave', handleDragLeave);
    dropZone.removeEventListener('drop', handleDrop);
    dropZone.removeEventListener('click', handleClick);
    fileInput.removeEventListener('change', handleFileChange);

    preview.removeEventListener('dragover', handlePreviewDragOver);
    preview.removeEventListener('dragleave', handlePreviewDragLeave);
    preview.removeEventListener('drop', handlePreviewDrop);
    preview.removeEventListener('click', handleClick);

    styleImage = null;
  }

  function getStyleImage(): ImageData | null {
    return styleImage;
  }

  return { destroy, getStyleImage };
}

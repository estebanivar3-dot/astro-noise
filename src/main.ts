import './style.css';
import { createCanvasManager } from './canvas';

declare global {
  interface Window {
    __cvlt: Record<string, unknown>;
  }
}

console.log('CVLT TOOLS loaded');

const canvasManager = createCanvasManager();

window.__cvlt = { canvasManager };

window.addEventListener('cvlt:image-loaded', () => {
  console.log('Image loaded — source ready');
});

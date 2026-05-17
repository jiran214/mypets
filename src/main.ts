import './style.css';
import { SpriteRenderer } from './renderer';
import { setupContextMenu } from './context-menu';
import { setupInteractions } from './interaction';
import { initLandingPage, transitionToPetMode, transitionToLandingMode } from './landing';

async function init() {
  const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement;
  const stage = document.getElementById('pet-stage') as HTMLDivElement;
  const resizeHandle = document.getElementById('pet-resize-handle') as HTMLButtonElement;
  if (!canvas) throw new Error('Canvas element not found');
  if (!stage) throw new Error('Pet stage element not found');
  if (!resizeHandle) throw new Error('Resize handle element not found');

  const renderer = new SpriteRenderer(canvas);
  setupInteractions(stage, canvas, resizeHandle, renderer);
  setupContextMenu(canvas, renderer, () => transitionToLandingMode());

  const { autoStart, meta } = await initLandingPage();

  document.addEventListener('start-pet', () => {
    transitionToPetMode(renderer, 'idle');
  });

  if (autoStart && meta) {
    await transitionToPetMode(renderer, 'idle');
  }
}

init();

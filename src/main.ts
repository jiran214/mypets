import './style.css';
import { SpriteRenderer } from './renderer';
import { setupDrag } from './drag';
import { setupContextMenu } from './context-menu';
import { initLandingPage, transitionToPetMode, transitionToLandingMode } from './landing';

async function init() {
  const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement;
  if (!canvas) throw new Error('Canvas element not found');

  const renderer = new SpriteRenderer(canvas);
  setupDrag(canvas);
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

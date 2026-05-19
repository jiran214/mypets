import './style.css';
import { SpriteRenderer } from './renderer';
import { setupContextMenu } from './context-menu';
import { setupInteractions } from './interaction';
import { initLandingPage, transitionToPetMode, transitionToLandingMode } from './landing';
import { ChatRuntime } from './chat-runtime';
import { mountChatUi, setupChatBubble } from './chat-ui';

async function init() {
  const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement;
  const stage = document.getElementById('pet-stage') as HTMLDivElement;
  const resizeHandle = document.getElementById('pet-resize-handle') as HTMLButtonElement;
  if (!canvas) throw new Error('Canvas element not found');
  if (!stage) throw new Error('Pet stage element not found');
  if (!resizeHandle) throw new Error('Resize handle element not found');

  const renderer = new SpriteRenderer(canvas);
  const chatRuntime = new ChatRuntime();
  await chatRuntime.init();
  mountChatUi(document.getElementById('chat-tab-root')!, chatRuntime);
  mountChatUi(document.getElementById('chat-bubble-root')!, chatRuntime, true);
  const chatBubble = setupChatBubble(stage, canvas);

  setupInteractions(stage, canvas, resizeHandle, renderer, chatBubble.resolvePetWindowSize);
  setupContextMenu(canvas, renderer, () => transitionToLandingMode());

  const { autoStart, meta } = await initLandingPage(chatRuntime);

  document.addEventListener('start-pet', () => {
    transitionToPetMode(renderer, 'idle', chatBubble.resolvePetWindowSize);
  });

  if (autoStart && meta) {
    await transitionToPetMode(renderer, 'idle', chatBubble.resolvePetWindowSize);
  }
}

init();

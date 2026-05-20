import './style.css';
import { initLandingPage } from './landing';
import { initPetWindow } from './pet-window';
import { ChatRuntime } from './chat-runtime';
import { mountChatUi } from './chat-ui';

async function initManagerWindow(): Promise<void> {
  const chatRuntime = new ChatRuntime();
  await chatRuntime.init();
  mountChatUi(document.getElementById('chat-tab-root')!, chatRuntime);
  await initLandingPage(chatRuntime);
}

async function init(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (params.get('view') === 'pet') {
    await initPetWindow(params.get('folder') ?? '');
    return;
  }

  await initManagerWindow();
}

void init();

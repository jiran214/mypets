import './style.css';
import { initPetWindow } from './pet-window';
import { ChatRuntime } from './chat-runtime';
import { mountManagerApp } from './manager-app';

async function initManagerWindow(): Promise<void> {
  const chatRuntime = new ChatRuntime();
  await chatRuntime.init();
  mountManagerApp(document.getElementById('landing-page')!, chatRuntime);
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

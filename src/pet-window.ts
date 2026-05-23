import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize, PhysicalPosition, currentMonitor } from '@tauri-apps/api/window';
import { SpriteRenderer } from './renderer';
import { setupContextMenu } from './context-menu';
import { setupInteractions } from './interaction';
import { loadPet } from './pet-loader';
import { ChatRuntime } from './chat-runtime';
import { mountChatUi, setupChatBubble } from './chat-ui';
import { savePetPosition } from './pet-position';
import { loadPetScale, savePetScale } from './pet-scale';
import type { PetMeta } from './types';

interface PetSettingsEvent {
  folder: string;
  petGravityEnabled: boolean;
  petAlwaysOnTop: boolean;
  petScale: number;
  petResizeEnabled: boolean;
}

function setPetWindowChrome(): void {
  document.getElementById('landing-page')!.classList.add('hidden');
  document.getElementById('pet-stage')!.style.display = 'inline-flex';
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
}

function setupPetGravity(folder: string, canvas: HTMLCanvasElement, initialEnabled: boolean): void {
  const win = getCurrentWindow();
  let enabled = initialEnabled;
  let animationFrame: number | null = null;

  const stop = (): void => {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  };

  const settle = async (): Promise<void> => {
    if (!enabled) return;
    stop();

    const [position, scaleFactor, monitor] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
      currentMonitor(),
    ]);
    if (!enabled) return;

    const rect = canvas.getBoundingClientRect();
    const workArea = monitor?.workArea;
    const floor = workArea
      ? workArea.position.y + workArea.size.height
      : position.y + Math.round(window.innerHeight * scaleFactor);
    const petBottomOffset = Math.round((rect.top + rect.height) * scaleFactor);
    const targetY = floor - petBottomOffset;
    if (position.y >= targetY) {
      await win.setPosition(new PhysicalPosition(position.x, targetY));
      return;
    }

    let y = position.y;
    let velocity = 0;
    let lastTimestamp = 0;

    const tick = (timestamp: number): void => {
      if (!enabled) {
        stop();
        return;
      }

      const dt = lastTimestamp === 0 ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 0.034);
      lastTimestamp = timestamp;
      velocity = Math.min(velocity + 2800 * dt, 2400);
      y = Math.min(y + velocity * dt, targetY);
      void win.setPosition(new PhysicalPosition(position.x, Math.round(y)));

      if (y >= targetY) {
        animationFrame = null;
        return;
      }

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
  };

  const scheduleSettle = (): void => {
    if (!enabled) return;
    window.setTimeout(() => {
      void settle().catch((error) => {
        console.warn('Failed to settle pet window:', error);
      });
    }, 80);
  };

  canvas.addEventListener('pointerup', scheduleSettle);
  canvas.addEventListener('pointercancel', scheduleSettle);

  void listen<PetSettingsEvent>('pet-settings-changed', (event) => {
    if (event.payload.folder !== folder) return;
    enabled = event.payload.petGravityEnabled;
    void win.setAlwaysOnTop(event.payload.petAlwaysOnTop).catch(() => {});
    if (enabled) {
      scheduleSettle();
    } else {
      stop();
    }
  }).catch((error) => {
    console.warn('Failed to listen to pet settings:', error);
  });

  scheduleSettle();
}

async function closeCurrentWindow(message: string): Promise<void> {
  await getCurrentWindow().show().catch(() => {});
  alert(message);
  await getCurrentWindow().close();
}

function setupPositionPersistence(folder: string, canvas: HTMLCanvasElement): void {
  const win = getCurrentWindow();
  let saveTimer: number | null = null;

  const savePosition = async () => {
    const [position, scaleFactor] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
    const rect = canvas.getBoundingClientRect();
    savePetPosition(folder, {
      x: Math.round(position.x + rect.left * scaleFactor),
      y: Math.round(position.y + rect.top * scaleFactor),
    });
  };

  const scheduleSave = () => {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
    }
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void savePosition().catch((error) => {
        console.warn('Failed to save pet position:', error);
      });
    }, 120);
  };

  void win.onMoved(scheduleSave).catch((error) => {
    console.warn('Failed to listen for pet window move:', error);
  });
}

function wireChatAnimations(manager: ReturnType<typeof setupInteractions>, runtime: ChatRuntime): void {
  let wasStreaming = false;
  runtime.subscribe(() => {
    const nowStreaming = runtime.isStreaming();
    if (nowStreaming && !wasStreaming) {
      manager.activate('chat', 3, 'running');
    } else if (!nowStreaming && wasStreaming) {
      manager.deactivate('chat');
      const msgs = runtime.getConversation().messages;
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant?.error) {
        manager.playOnce('failed');
      }
    }
    wasStreaming = nowStreaming;
  });
}

export async function initPetWindow(folder: string): Promise<void> {
  setPetWindowChrome();

  if (!folder) {
    await closeCurrentWindow('缺少桌宠工作空间路径。');
    return;
  }

  let meta: PetMeta;
  try {
    meta = await loadPet(folder);
  } catch (error) {
    await closeCurrentWindow(error instanceof Error ? error.message : String(error));
    return;
  }

  const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement;
  const stage = document.getElementById('pet-stage') as HTMLDivElement;
  const resizeHandle = document.getElementById('pet-resize-handle') as HTMLButtonElement;
  if (!canvas) throw new Error('Canvas element not found');
  if (!stage) throw new Error('Pet stage element not found');
  if (!resizeHandle) throw new Error('Resize handle element not found');

  const renderer = new SpriteRenderer(canvas);
  const chatBubble = setupChatBubble(stage, canvas);
  const manager = setupInteractions(stage, canvas, resizeHandle, renderer, chatBubble.resolvePetWindowSize, (scale) => {
    savePetScale(folder, scale);
  });
  setupContextMenu(canvas, renderer, folder);

  await renderer.setImage(meta.spritesheetPath);
  renderer.setState('idle');
  renderer.start();

  const chatRuntime = new ChatRuntime();
  await chatRuntime.init();
  await chatRuntime.setWorkspace(folder);
  const initialSettings = chatRuntime.getAiState()?.settings;

  // Apply initial scale and resize handle settings
  const initialScale = initialSettings?.petScale ?? loadPetScale(folder);
  const initialResizeEnabled = initialSettings?.petResizeEnabled ?? false;
  if (initialScale !== 1) {
    manager.resizeControl.setScale(initialScale);
  }
  manager.resizeControl.setEnabled(initialResizeEnabled);

  wireChatAnimations(manager, chatRuntime);

  mountChatUi(document.getElementById('chat-bubble-root')!, chatRuntime, true, {
    petName: meta.displayName,
    onInputFocus: () => { manager.activate('chat', 3, 'waiting'); },
    onInputBlur: () => { if (!chatRuntime.isStreaming()) manager.deactivate('chat'); },
    onDragActive: (active) => { if (active) manager.activate('chat', 3, 'review'); else manager.deactivate('chat'); },
  });

  {
    const reqId = crypto.randomUUID();
    void listen<{ id: string }>('pet-waving', (e) => { if (e.payload.id === reqId) manager.playOnce('waving'); });
    void emit('request-pet-waving', { id: reqId });
  }

  const win = getCurrentWindow();
  const windowSize = chatBubble.resolvePetWindowSize(renderer.getDisplaySize());
  await win.setDecorations(false);
  await win.setSize(new LogicalSize(windowSize.width, windowSize.height));
  await win.setAlwaysOnTop(initialSettings?.petAlwaysOnTop ?? false);
  await win.setSkipTaskbar(true);
  await win.setResizable(false);
  setupPositionPersistence(folder, canvas);
  await win.show();
  setupPetGravity(folder, canvas, initialSettings?.petGravityEnabled ?? true);

  // Listen for settings changes (scale, resize handle)
  void listen<PetSettingsEvent>('pet-settings-changed', (event) => {
    if (event.payload.folder !== folder) return;
    manager.resizeControl.setScale(event.payload.petScale);
    manager.resizeControl.setEnabled(event.payload.petResizeEnabled);
  }).catch((error) => {
    console.warn('Failed to listen to pet settings for scale:', error);
  });

  // Temporarily lower always-on-top when main window is being focused from context menu
  void listen('pet-window-lower', () => {
    void win.setAlwaysOnTop(false).catch(() => {});
    setTimeout(() => {
      void win.setAlwaysOnTop(initialSettings?.petAlwaysOnTop ?? false).catch(() => {});
    }, 500);
  }).catch((error) => {
    console.warn('Failed to listen to pet-window-lower:', error);
  });
}

import { emit } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PhysicalPosition, monitorFromPoint, primaryMonitor } from '@tauri-apps/api/window';
import { loadAiState } from '@/ai/ai-api';
import type { AiSettings } from '@/ai/ai-types';
import { isReadyWorkspace, type PetWorkspace } from '@/workspaces';
import { loadPetPosition } from './pet-position';

const PET_WINDOW_PREFIX = 'pet-';
const INITIAL_WIDTH = 192;
const INITIAL_HEIGHT = 208;
type Position = { x: number; y: number };

function hashFolder(folder: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < folder.length; i++) {
    hash ^= folder.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

async function fallbackPosition(folder: string): Promise<Position> {
  const slot = parseInt(hashFolder(folder).slice(-2), 16) % 8;

  const monitor = await primaryMonitor();
  const scaleFactor = monitor?.scaleFactor ?? 1;
  const screenWidth = monitor ? Math.round(monitor.size.width / scaleFactor) : 1920;
  const screenHeight = monitor ? Math.round(monitor.size.height / scaleFactor) : 1080;

  return {
    x: screenWidth - INITIAL_WIDTH - 20 - slot * 30,
    y: screenHeight - INITIAL_HEIGHT - 90 - slot * 20,
  };
}

async function initialPosition(folder: string): Promise<Position> {
  const saved = loadPetPosition(folder);
  if (!saved) return await fallbackPosition(folder);

  try {
    const monitor = await monitorFromPoint(saved.x, saved.y) ?? await primaryMonitor();
    const scaleFactor = monitor?.scaleFactor ?? 1;
    const logical = new PhysicalPosition(saved.x, saved.y).toLogical(scaleFactor);
    return {
      x: Math.round(logical.x),
      y: Math.round(logical.y),
    };
  } catch (error) {
    console.warn('Failed to convert saved pet position:', error);
    return saved;
  }
}

export function petWindowLabel(folder: string): string {
  return `${PET_WINDOW_PREFIX}${hashFolder(folder)}`;
}

export async function showPetWindow(workspace: PetWorkspace): Promise<void> {
  if (!isReadyWorkspace(workspace)) return;

  const label = petWindowLabel(workspace.folder);
  const aiState = await loadAiState(workspace.folder);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await applyPetWindowSettings(workspace.folder, aiState.settings);
    await existing.show();
    await existing.setFocus().catch(() => {});
    return;
  }

  const position = await initialPosition(workspace.folder);
  const win = new WebviewWindow(label, {
    url: `/?view=pet&folder=${encodeURIComponent(workspace.folder)}`,
    title: workspace.meta.displayName,
    x: position.x,
    y: position.y,
    width: INITIAL_WIDTH,
    height: INITIAL_HEIGHT,
    visible: false,
    focus: false,
    transparent: true,
    dragDropEnabled: false,
    decorations: false,
    shadow: false,
    resizable: false,
    alwaysOnTop: aiState.settings.petAlwaysOnTop,
    skipTaskbar: true,
    preventOverflow: true,
  });

  await new Promise<void>((resolve, reject) => {
    void win.once('tauri://created', () => resolve());
    void win.once('tauri://error', (event) => {
      reject(new Error(String(event.payload || '无法创建桌宠窗口')));
    });
  });
}

export async function setPetWindowTitle(folder: string, title: string): Promise<void> {
  const existing = await WebviewWindow.getByLabel(petWindowLabel(folder));
  if (existing) {
    await existing.setTitle(title).catch(() => {});
  }
}

export async function applyPetWindowSettings(folder: string, settings: Pick<AiSettings, 'petAlwaysOnTop' | 'petGravityEnabled' | 'petScale' | 'petResizeEnabled'>): Promise<void> {
  const existing = await WebviewWindow.getByLabel(petWindowLabel(folder));
  if (existing) {
    await existing.setAlwaysOnTop(settings.petAlwaysOnTop).catch(() => {});
  }
  await emit('pet-settings-changed', {
    folder,
    petAlwaysOnTop: settings.petAlwaysOnTop,
    petGravityEnabled: settings.petGravityEnabled,
    petScale: settings.petScale,
    petResizeEnabled: settings.petResizeEnabled,
  });
}

export async function hidePetWindow(folder: string): Promise<void> {
  const existing = await WebviewWindow.getByLabel(petWindowLabel(folder));
  if (existing) {
    await existing.close();
  }
}

export async function syncEnabledWorkspaces(workspaces: PetWorkspace[]): Promise<string[]> {
  const failedFolders: string[] = [];

  for (const workspace of workspaces) {
    try {
      if (isReadyWorkspace(workspace) && workspace.enabled) {
        await showPetWindow(workspace);
      } else {
        await hidePetWindow(workspace.folder);
      }
    } catch (error) {
      console.warn('Failed to sync pet window:', workspace.folder, error);
      failedFolders.push(workspace.folder);
    }
  }

  return failedFolders;
}

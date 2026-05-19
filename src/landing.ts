import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { pickPetFolder, loadPet, loadSpritesheet } from './pet-loader';
import { CELL_W, CELL_H } from './animation-data';
import { saveAiSettings } from './ai-api';
import { loadSavedWorkspaces, saveWorkspaceSelection, type PetWorkspace } from './workspaces';
import type { ChatRuntime } from './chat-runtime';
import type { AiSettings } from './ai-types';
import type { PetMeta, AnimationState } from './types';

let workspaces: PetWorkspace[] = [];
let currentFolder = '';
let currentMeta: PetMeta | null = null;
let previewImage: HTMLImageElement | null = null;

function selectedWorkspace(): PetWorkspace | null {
  return workspaces.find((workspace) => workspace.folder === currentFolder) ?? null;
}

function drawPreview(): void {
  const canvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
  if (!canvas || !previewImage) return;

  const dpr = window.devicePixelRatio || 1;
  const displayW = 120;
  const displayH = 130;
  canvas.width = displayW * dpr;
  canvas.height = displayH * dpr;
  canvas.style.width = `${displayW}px`;
  canvas.style.height = `${displayH}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, displayW, displayH);
  ctx.drawImage(previewImage, 0, 0, CELL_W, CELL_H, 0, 0, displayW, displayH);
}

async function loadPetPreview(spritesheetPath: string): Promise<void> {
  const dataUrl = await loadSpritesheet(spritesheetPath);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      previewImage = img;
      drawPreview();
      resolve();
    };
    img.onerror = () => reject(new Error('Failed to load spritesheet'));
    img.src = dataUrl;
  });
}

function setText(id: string, value: string): void {
  document.getElementById(id)!.textContent = value;
}

function setInputValue(id: string, value: string): void {
  const input = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
  input.value = value;
}

function setCheckboxValue(id: string, value: boolean): void {
  const input = document.getElementById(id) as HTMLInputElement;
  input.checked = value;
}

function setSettingsDisabled(disabled: boolean): void {
  for (const element of document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-ai-setting]')) {
    element.disabled = disabled;
  }
  (document.getElementById('save-ai-settings') as HTMLButtonElement).disabled = disabled;
}

function updateWorkspaceList(): void {
  const list = document.getElementById('workspace-list')!;
  setText('workspace-count', `${workspaces.length}`);

  if (workspaces.length === 0) {
    list.innerHTML = '<div class="workspace-empty">还没有桌宠工作空间</div>';
    return;
  }

  list.innerHTML = workspaces
    .map((workspace) => `
      <button class="workspace-item ${workspace.folder === currentFolder ? 'active' : ''}" type="button" data-folder="${escapeAttribute(workspace.folder)}">
        <span class="workspace-avatar">${escapeHtml(workspace.meta.displayName.slice(0, 1) || '宠')}</span>
        <span class="workspace-copy">
          <strong>${escapeHtml(workspace.meta.displayName)}</strong>
          <small>${escapeHtml(workspace.folder)}</small>
        </span>
      </button>
    `)
    .join('');
}

function updateWorkspaceInfo(): void {
  const workspace = selectedWorkspace();
  const placeholder = document.getElementById('preview-placeholder')!;
  const loaded = document.getElementById('preview-loaded')!;
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;

  currentMeta = workspace?.meta ?? null;
  startBtn.disabled = !workspace;

  if (!workspace) {
    previewImage = null;
    placeholder.style.display = 'flex';
    loaded.style.display = 'none';
    setText('current-workspace-name', '请选择或创建桌宠工作空间');
    setText('current-workspace-folder', '导入包含 pet.json 的文件夹');
    setText('current-workspace-description', '一次只能启动一只桌宠。');
    setText('pet-name', '');
    setText('pet-description', '');
    setText('selected-workspace-path', '');
    return;
  }

  placeholder.style.display = 'none';
  loaded.style.display = 'flex';
  setText('current-workspace-name', workspace.meta.displayName);
  setText('current-workspace-folder', workspace.folder);
  setText('current-workspace-description', workspace.meta.description);
  setText('pet-name', workspace.meta.displayName);
  setText('pet-description', workspace.meta.description);
  setText('selected-workspace-path', workspace.folder);
}

async function selectWorkspace(folder: string, runtime: ChatRuntime): Promise<void> {
  currentFolder = folder;
  saveWorkspaceSelection(workspaces, currentFolder);
  updateWorkspaceList();
  updateWorkspaceInfo();
  await runtime.setWorkspace(folder);
  renderAiSettings(runtime);

  const workspace = selectedWorkspace();
  if (!workspace) return;
  try {
    await loadPetPreview(workspace.meta.spritesheetPath);
  } catch (previewErr) {
    console.warn('Failed to load preview:', previewErr);
  }
}

async function importWorkspace(runtime: ChatRuntime): Promise<void> {
  const folder = await pickPetFolder();
  if (!folder) return;

  try {
    const meta = await loadPet(folder);
    const existingIndex = workspaces.findIndex((workspace) => workspace.folder === folder);
    const workspace = { folder, meta };
    if (existingIndex >= 0) {
      workspaces[existingIndex] = workspace;
    } else {
      workspaces.push(workspace);
    }
    await selectWorkspace(folder, runtime);
  } catch (err) {
    console.error('Failed to load pet:', err);
    alert(`无法导入桌宠工作空间：\n${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function transitionToPetMode(
  renderer: {
    setImage: (path: string) => Promise<void>;
    setState: (s: AnimationState) => void;
    start: () => void;
    getDisplaySize: () => { width: number; height: number };
  },
  defaultState: AnimationState,
  resolveWindowSize?: (base: { width: number; height: number }) => { width: number; height: number },
): Promise<void> {
  if (!currentMeta) return;

  try {
    await renderer.setImage(currentMeta.spritesheetPath);
  } catch (err) {
    console.error('Failed to load spritesheet:', err);
    alert(`无法加载桌宠贴图：\n${currentMeta.spritesheetPath}`);
    return;
  }

  renderer.setState(defaultState);
  renderer.start();

  const win = getCurrentWindow();
  const size = renderer.getDisplaySize();
  const windowSize = resolveWindowSize ? resolveWindowSize(size) : size;
  await win.setDecorations(false);
  await win.setSize(new LogicalSize(windowSize.width, windowSize.height));
  await win.setAlwaysOnTop(true);
  await win.setSkipTaskbar(true);
  await win.setResizable(false);
  await win.center();

  document.getElementById('landing-page')!.classList.add('hidden');
  document.getElementById('pet-stage')!.style.display = 'inline-flex';
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
}

export async function transitionToLandingMode(): Promise<void> {
  document.dispatchEvent(new CustomEvent('close-chat-bubble', { detail: { syncFrame: false } }));
  const win = getCurrentWindow();
  await win.setAlwaysOnTop(false);
  await win.setSkipTaskbar(false);
  await win.setDecorations(true);
  await win.setSize(new LogicalSize(920, 640));
  await win.center();

  document.getElementById('pet-stage')!.style.display = 'none';
  document.getElementById('landing-page')!.classList.remove('hidden');
  document.documentElement.style.background = '';
  document.body.style.background = '';
}

function initTabs(): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-button'));
  const panels = Array.from(document.querySelectorAll<HTMLElement>('.tab-panel'));

  const activate = (tab: string) => {
    for (const button of buttons) {
      button.classList.toggle('active', button.dataset.tab === tab);
    }
    for (const panel of panels) {
      panel.classList.toggle('active', panel.id === `tab-${tab}`);
    }
  };

  for (const button of buttons) {
    button.addEventListener('click', () => activate(button.dataset.tab ?? 'skin'));
  }
}

function readAiSettings(): AiSettings {
  return {
    providerId: 'claude',
    claude: {
      pathToClaudeCodeExecutable: (document.getElementById('claude-executable') as HTMLInputElement).value.trim(),
      permissionMode: (document.getElementById('claude-permission-mode') as HTMLSelectElement).value,
      useUserSettings: (document.getElementById('claude-user-settings') as HTMLInputElement).checked,
      customEnvText: (document.getElementById('claude-custom-env') as HTMLTextAreaElement).value,
    },
  };
}

function renderAiSettings(runtime: ChatRuntime): void {
  const state = runtime.getAiState();
  setSettingsDisabled(!state);

  if (!state) {
    setInputValue('claude-executable', '');
    (document.getElementById('claude-permission-mode') as HTMLSelectElement).value = 'default';
    setCheckboxValue('claude-user-settings', false);
    setInputValue('claude-custom-env', '');
    return;
  }

  const settings = state.settings;
  setInputValue('claude-executable', settings.claude.pathToClaudeCodeExecutable);
  (document.getElementById('claude-permission-mode') as HTMLSelectElement).value = settings.claude.permissionMode;
  setCheckboxValue('claude-user-settings', settings.claude.useUserSettings);
  setInputValue('claude-custom-env', settings.claude.customEnvText);
}

function initAiSettings(runtime: ChatRuntime): void {
  const saveButton = document.getElementById('save-ai-settings') as HTMLButtonElement;
  const status = document.getElementById('ai-settings-status')!;

  saveButton.addEventListener('click', async () => {
    if (!currentFolder) return;

    saveButton.disabled = true;
    status.textContent = '保存中...';
    try {
      const nextState = await saveAiSettings(currentFolder, readAiSettings());
      runtime.setAiState(nextState);
      renderAiSettings(runtime);
      status.textContent = '已保存';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      saveButton.disabled = false;
    }
  });
}

export async function initLandingPage(runtime: ChatRuntime): Promise<void> {
  initTabs();
  initAiSettings(runtime);

  const createButton = document.getElementById('create-workspace-btn') as HTMLButtonElement;
  const importButton = document.getElementById('select-folder-btn') as HTMLButtonElement;
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  const workspaceList = document.getElementById('workspace-list')!;

  createButton.addEventListener('click', () => {
    void importWorkspace(runtime);
  });
  importButton.addEventListener('click', () => {
    void importWorkspace(runtime);
  });
  workspaceList.addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-folder]');
    if (!item) return;
    void selectWorkspace(item.dataset.folder ?? '', runtime);
  });
  startBtn.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('start-pet'));
  });

  const saved = await loadSavedWorkspaces();
  workspaces = saved.workspaces;
  currentFolder = saved.currentFolder;
  updateWorkspaceList();
  updateWorkspaceInfo();

  if (currentFolder) {
    await selectWorkspace(currentFolder, runtime);
  } else {
    renderAiSettings(runtime);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

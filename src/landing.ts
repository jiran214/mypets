import { pickPetFolder, loadPet, loadSpritesheet, deletePetWorkspace } from './pet-loader';
import { listen } from '@tauri-apps/api/event';
import { ANIMATIONS, CELL_W, CELL_H } from './animation-data';
import { saveAiSettings } from './ai-api';
import {
  isReadyWorkspace,
  loadSavedWorkspaces,
  saveWorkspaceSelection,
  type PetWorkspace,
} from './workspaces';
import { hidePetWindow, showPetWindow, syncEnabledWorkspaces } from './pet-windows';
import type { ChatRuntime } from './chat-runtime';
import type { AiSettings } from './ai-types';

let workspaces: PetWorkspace[] = [];
let currentFolder = '';
let previewImage: HTMLImageElement | null = null;
let previewAnimationId: number | null = null;
let previewFrame = 0;
let previewElapsed = 0;
let previewLastTimestamp = 0;
const spritesheetCache = new Map<string, Promise<HTMLImageElement>>();
const PREVIEW_DISPLAY_W = 192;
const PREVIEW_DISPLAY_H = 208;
const AVATAR_SIZE = 42;

function selectedWorkspace(): PetWorkspace | null {
  return workspaces.find((workspace) => workspace.folder === currentFolder) ?? null;
}

function selectedReadyWorkspace(): PetWorkspace | null {
  const workspace = selectedWorkspace();
  return isReadyWorkspace(workspace) ? workspace : null;
}

function loadSpritesheetImage(spritesheetPath: string): Promise<HTMLImageElement> {
  const cached = spritesheetCache.get(spritesheetPath);
  if (cached) return cached;

  const promise = loadSpritesheet(spritesheetPath).then((dataUrl) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load spritesheet'));
    img.src = dataUrl;
  }));
  spritesheetCache.set(spritesheetPath, promise);
  return promise;
}

function preparePreviewCanvas(): CanvasRenderingContext2D | null {
  const canvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
  if (!canvas) return null;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = PREVIEW_DISPLAY_W * dpr;
  canvas.height = PREVIEW_DISPLAY_H * dpr;
  canvas.style.width = `${PREVIEW_DISPLAY_W}px`;
  canvas.style.height = `${PREVIEW_DISPLAY_H}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function drawPreviewFrame(): void {
  if (!previewImage) return;
  const ctx = preparePreviewCanvas();
  if (!ctx) return;

  const def = ANIMATIONS.idle;
  ctx.clearRect(0, 0, PREVIEW_DISPLAY_W, PREVIEW_DISPLAY_H);
  ctx.drawImage(
    previewImage,
    previewFrame * CELL_W,
    def.row * CELL_H,
    CELL_W,
    CELL_H,
    0,
    0,
    PREVIEW_DISPLAY_W,
    PREVIEW_DISPLAY_H,
  );
}

function stopPreviewAnimation(): void {
  if (previewAnimationId !== null) {
    cancelAnimationFrame(previewAnimationId);
    previewAnimationId = null;
  }
  previewFrame = 0;
  previewElapsed = 0;
  previewLastTimestamp = 0;
}

function tickPreview(timestamp: number): void {
  if (!previewImage) {
    stopPreviewAnimation();
    return;
  }

  const def = ANIMATIONS.idle;
  if (previewLastTimestamp === 0) {
    previewLastTimestamp = timestamp;
  }
  previewElapsed += timestamp - previewLastTimestamp;
  previewLastTimestamp = timestamp;

  while (previewElapsed >= def.durations[previewFrame]) {
    previewElapsed -= def.durations[previewFrame];
    previewFrame = (previewFrame + 1) % def.frameCount;
  }

  drawPreviewFrame();
  previewAnimationId = requestAnimationFrame(tickPreview);
}

function startPreviewAnimation(): void {
  stopPreviewAnimation();
  drawPreviewFrame();
  previewAnimationId = requestAnimationFrame(tickPreview);
}

async function loadPetPreview(spritesheetPath: string): Promise<void> {
  previewImage = await loadSpritesheetImage(spritesheetPath);
  startPreviewAnimation();
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

function setPlaceholder(icon: string, text: string): void {
  const placeholder = document.getElementById('preview-placeholder')!;
  placeholder.querySelector<HTMLElement>('.placeholder-icon')!.textContent = icon;
  placeholder.querySelector<HTMLElement>('.placeholder-text')!.textContent = text;
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
    stopPreviewAnimation();
    return;
  }

  list.innerHTML = workspaces
    .map((workspace) => {
      const ready = isReadyWorkspace(workspace);
      const name = ready ? workspace.meta.displayName : '资源丢失';
      const status = ready ? '可显示' : '资源丢失';
      const active = workspace.folder === currentFolder ? ' active' : '';
      const missing = ready ? '' : ' workspace-item-missing';
      const checked = ready && workspace.enabled ? ' checked' : '';
      const disabled = ready ? '' : ' disabled';
      const avatar = ready
        ? `<canvas class="workspace-avatar workspace-avatar-canvas" data-avatar-path="${escapeAttribute(workspace.meta.spritesheetPath)}" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" aria-label="${escapeAttribute(name)}头像"></canvas>`
        : '<span class="workspace-avatar workspace-avatar-missing">!</span>';

      return `
        <div class="workspace-item${active}${missing}" data-folder="${escapeAttribute(workspace.folder)}">
          <button class="workspace-select" type="button" data-select-folder="${escapeAttribute(workspace.folder)}">
            ${avatar}
            <span class="workspace-copy">
              <strong>${escapeHtml(name)}</strong>
              <small>${escapeHtml(workspace.folder)}</small>
              <span class="workspace-status">${escapeHtml(status)}</span>
            </span>
          </button>
          <label class="workspace-switch" title="${ready ? '显示桌宠' : '资源丢失，无法显示'}">
            <input type="checkbox" data-toggle-folder="${escapeAttribute(workspace.folder)}"${checked}${disabled} />
            <span></span>
          </label>
        </div>
      `;
    })
    .join('');
  void renderWorkspaceAvatars();
}

async function renderWorkspaceAvatars(): Promise<void> {
  const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas[data-avatar-path]'));

  await Promise.all(canvases.map(async (canvas) => {
    const path = canvas.dataset.avatarPath;
    if (!path) return;

    try {
      const image = await loadSpritesheetImage(path);
      if (canvas.dataset.avatarPath !== path) return;
      drawAvatar(canvas, image);
    } catch (error) {
      console.warn('Failed to load workspace avatar:', error);
    }
  }));
}

function drawAvatar(canvas: HTMLCanvasElement, image: HTMLImageElement): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = AVATAR_SIZE * dpr;
  canvas.height = AVATAR_SIZE * dpr;
  canvas.style.width = `${AVATAR_SIZE}px`;
  canvas.style.height = `${AVATAR_SIZE}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const padding = 3;
  const size = AVATAR_SIZE - padding * 2;
  const scale = Math.min(size / CELL_W, size / CELL_H);
  const width = CELL_W * scale;
  const height = CELL_H * scale;
  const x = (AVATAR_SIZE - width) / 2;
  const y = (AVATAR_SIZE - height) / 2;
  const def = ANIMATIONS.idle;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.drawImage(image, 0, def.row * CELL_H, CELL_W, CELL_H, x, y, width, height);
}

function updateWorkspaceInfo(): void {
  const workspace = selectedWorkspace();
  const placeholder = document.getElementById('preview-placeholder')!;
  const loaded = document.getElementById('preview-loaded')!;
  const deleteButton = document.getElementById('delete-workspace-btn') as HTMLButtonElement;

  deleteButton.disabled = !workspace;

  if (!workspace) {
    previewImage = null;
    stopPreviewAnimation();
    placeholder.style.display = 'flex';
    loaded.style.display = 'none';
    setPlaceholder('桌宠', '请选择你的桌宠');
    setText('current-workspace-name', '请选择你的桌宠');
    setText('current-workspace-folder', '从左侧桌宠列表选择一项');
    setText('current-workspace-description', '开启列表右侧开关后，桌宠会显示在桌面上。');
    return;
  }

  if (!isReadyWorkspace(workspace)) {
    previewImage = null;
    stopPreviewAnimation();
    placeholder.style.display = 'flex';
    loaded.style.display = 'none';
    setPlaceholder('资源丢失', workspace.missingMessage ?? `未找到文件资源:${workspace.folder}`);
    setText('current-workspace-name', '资源未找到');
    setText('current-workspace-folder', workspace.folder);
    setText('current-workspace-description', workspace.missingMessage ?? `未找到文件资源:${workspace.folder}`);
    return;
  }

  placeholder.style.display = 'none';
  loaded.style.display = 'flex';
  setText('current-workspace-name', workspace.meta.displayName);
  setText('current-workspace-folder', workspace.folder);
  setText('current-workspace-description', workspace.meta.description);
}

async function selectWorkspace(folder: string, runtime: ChatRuntime): Promise<void> {
  currentFolder = folder;
  saveWorkspaceSelection(workspaces, currentFolder);
  updateWorkspaceList();
  updateWorkspaceInfo();

  const workspace = selectedWorkspace();
  if (!isReadyWorkspace(workspace)) {
    await runtime.setWorkspace('');
    renderAiSettings(runtime);
    return;
  }

  await runtime.setWorkspace(folder);
  renderAiSettings(runtime);

  try {
    await loadPetPreview(workspace.meta.spritesheetPath);
  } catch (previewErr) {
    console.warn('Failed to load preview:', previewErr);
    previewImage = null;
    stopPreviewAnimation();
    document.getElementById('preview-placeholder')!.style.display = 'flex';
    document.getElementById('preview-loaded')!.style.display = 'none';
    setPlaceholder('贴图失败', workspace.meta.spritesheetPath);
  }
}

async function toggleWorkspace(folder: string, enabled: boolean): Promise<void> {
  const workspace = workspaces.find((item) => item.folder === folder);
  if (!isReadyWorkspace(workspace)) return;

  workspace.enabled = enabled;
  saveWorkspaceSelection(workspaces, currentFolder);
  updateWorkspaceList();

  try {
    if (enabled) {
      await showPetWindow(workspace);
    } else {
      await hidePetWindow(folder);
    }
  } catch (error) {
    workspace.enabled = false;
    saveWorkspaceSelection(workspaces, currentFolder);
    updateWorkspaceList();
    alert(`无法${enabled ? '显示' : '关闭'}桌宠：\n${error instanceof Error ? error.message : String(error)}`);
  }
}

async function listenToPetWindowEvents(): Promise<void> {
  try {
    await listen<{ folder?: string }>('pet-window-closed', (event) => {
      const folder = event.payload.folder;
      if (!folder) return;

      const workspace = workspaces.find((item) => item.folder === folder);
      if (!workspace?.enabled) return;

      workspace.enabled = false;
      saveWorkspaceSelection(workspaces, currentFolder);
      updateWorkspaceList();
    });
  } catch (error) {
    console.warn('Failed to listen to pet window events:', error);
  }
}

async function importWorkspace(runtime: ChatRuntime): Promise<void> {
  const folder = await pickPetFolder();
  if (!folder) return;

  try {
    const meta = await loadPet(folder);
    const existingIndex = workspaces.findIndex((workspace) => workspace.folder === folder);
    const enabled = existingIndex >= 0 ? workspaces[existingIndex].enabled : false;
    const workspace: PetWorkspace = { folder, meta, enabled, status: 'ready' };
    if (existingIndex >= 0) {
      workspaces[existingIndex] = workspace;
    } else {
      workspaces.push(workspace);
    }
    await selectWorkspace(folder, runtime);
    if (enabled) {
      await showPetWindow(workspace);
    }
  } catch (err) {
    console.error('Failed to load pet:', err);
    alert(`无法导入桌宠工作空间：\n${err instanceof Error ? err.message : String(err)}`);
  }
}

async function deleteSelectedWorkspace(runtime: ChatRuntime): Promise<void> {
  const workspace = selectedWorkspace();
  if (!workspace) return;

  const ready = isReadyWorkspace(workspace);
  const message = ready
    ? `将把桌宠文件夹移入回收站：\n${workspace.folder}\n\n确定删除吗？`
    : `该桌宠资源已丢失，将仅从列表移除：\n${workspace.folder}\n\n确定移除吗？`;
  if (!confirm(message)) return;

  try {
    if (ready) {
      await deletePetWorkspace(workspace.folder);
      await hidePetWindow(workspace.folder).catch((error) => {
        console.warn('Failed to close deleted pet window:', error);
      });
    }
    workspaces = workspaces.filter((item) => item.folder !== workspace.folder);
    currentFolder = '';
    saveWorkspaceSelection(workspaces, currentFolder);
    updateWorkspaceList();
    updateWorkspaceInfo();
    await runtime.setWorkspace('');
    renderAiSettings(runtime);
  } catch (error) {
    alert(`删除失败：\n${error instanceof Error ? error.message : String(error)}`);
  }
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
    const workspace = selectedReadyWorkspace();
    if (!workspace) return;

    saveButton.disabled = true;
    status.textContent = '保存中...';
    try {
      const nextState = await saveAiSettings(workspace.folder, readAiSettings());
      runtime.setAiState(nextState);
      renderAiSettings(runtime);
      status.textContent = '已保存';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      saveButton.disabled = !selectedReadyWorkspace();
    }
  });
}

export async function initLandingPage(runtime: ChatRuntime): Promise<void> {
  initTabs();
  initAiSettings(runtime);
  void listenToPetWindowEvents();

  const createButton = document.getElementById('create-workspace-btn') as HTMLButtonElement;
  const importButton = document.getElementById('select-folder-btn') as HTMLButtonElement;
  const deleteButton = document.getElementById('delete-workspace-btn') as HTMLButtonElement;
  const workspaceList = document.getElementById('workspace-list')!;

  createButton.addEventListener('click', () => {
    void importWorkspace(runtime);
  });
  importButton.addEventListener('click', () => {
    void importWorkspace(runtime);
  });
  deleteButton.addEventListener('click', () => {
    void deleteSelectedWorkspace(runtime);
  });
  workspaceList.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('.workspace-switch')) return;
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-select-folder]');
    if (!item) return;
    void selectWorkspace(item.dataset.selectFolder ?? '', runtime);
  });
  workspaceList.addEventListener('change', (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-toggle-folder]');
    if (!toggle) return;
    void toggleWorkspace(toggle.dataset.toggleFolder ?? '', toggle.checked);
  });

  const saved = await loadSavedWorkspaces();
  workspaces = saved.workspaces;
  currentFolder = saved.currentFolder;
  const failedFolders = await syncEnabledWorkspaces(workspaces);
  if (failedFolders.length > 0) {
    const failed = new Set(failedFolders);
    for (const workspace of workspaces) {
      if (failed.has(workspace.folder)) {
        workspace.enabled = false;
      }
    }
    saveWorkspaceSelection(workspaces, currentFolder);
  }
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

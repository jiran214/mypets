import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { pickPetFolder, loadPet, loadSpritesheet } from './pet-loader';
import { CELL_W, CELL_H } from './animation-data';
import type { PetMeta, AnimationState } from './types';

const STORAGE_KEY = 'mypets-config';

let currentMeta: PetMeta | null = null;
let previewImage: HTMLImageElement | null = null;

function loadSavedFolder(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const config = JSON.parse(raw);
      return config.folder || '';
    }
  } catch {}
  return '';
}

function saveFolder(folder: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ folder }));
}

function drawPreview(): void {
  const canvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
  if (!canvas || !previewImage) return;

  const dpr = window.devicePixelRatio || 1;
  const displayW = 96;
  const displayH = 104;
  canvas.width = displayW * dpr;
  canvas.height = displayH * dpr;
  canvas.style.width = `${displayW}px`;
  canvas.style.height = `${displayH}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
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

function showPetInfo(meta: PetMeta): void {
  const placeholder = document.getElementById('preview-placeholder')!;
  const loaded = document.getElementById('preview-loaded')!;
  const nameEl = document.getElementById('pet-name')!;
  const descEl = document.getElementById('pet-description')!;

  placeholder.style.display = 'none';
  loaded.style.display = 'flex';
  nameEl.textContent = meta.displayName;
  descEl.textContent = meta.description;
}

function updateStartButton(): void {
  const btn = document.getElementById('start-btn') as HTMLButtonElement;
  btn.disabled = !currentMeta;
}

export async function transitionToPetMode(
  renderer: {
    setImage: (path: string) => Promise<void>;
    setState: (s: AnimationState) => void;
    start: () => void;
    getDisplaySize: () => { width: number; height: number };
  },
  defaultState: AnimationState,
): Promise<void> {
  if (!currentMeta) return;

  try {
    await renderer.setImage(currentMeta.spritesheetPath);
  } catch (err) {
    console.error('Failed to load spritesheet:', err);
    alert(`Failed to load spritesheet image:\n${currentMeta.spritesheetPath}\n\nCheck console for details.`);
    return;
  }

  renderer.setState(defaultState);
  renderer.start();

  const win = getCurrentWindow();
  const size = renderer.getDisplaySize();
  await win.setDecorations(false);
  await win.setSize(new LogicalSize(size.width, size.height));
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
  const win = getCurrentWindow();
  await win.setAlwaysOnTop(false);
  await win.setSkipTaskbar(false);
  await win.setDecorations(true);
  await win.setSize(new LogicalSize(420, 380));
  await win.center();

  document.getElementById('pet-stage')!.style.display = 'none';
  document.getElementById('landing-page')!.classList.remove('hidden');
  document.documentElement.style.background = '';
  document.body.style.background = '';
}

export async function initLandingPage(): Promise<{ autoStart: boolean; meta: PetMeta | null }> {
  const savedFolder = loadSavedFolder();

  const selectFolderBtn = document.getElementById('select-folder-btn')!;
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;

  selectFolderBtn.addEventListener('click', async () => {
    const folder = await pickPetFolder();
    if (!folder) return;

    try {
      const meta = await loadPet(folder);
      currentMeta = meta;
      showPetInfo(meta);
      saveFolder(folder);
      updateStartButton();
      try {
        await loadPetPreview(meta.spritesheetPath);
      } catch (previewErr) {
        console.warn('Failed to load preview:', previewErr);
      }
    } catch (err) {
      console.error('Failed to load pet:', err);
    }
  });

  startBtn.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('start-pet'));
  });

  if (savedFolder) {
    try {
      const meta = await loadPet(savedFolder);
      currentMeta = meta;
      showPetInfo(meta);
      updateStartButton();
      try {
        await loadPetPreview(meta.spritesheetPath);
      } catch (previewErr) {
        console.warn('Failed to load preview:', previewErr);
      }
      return { autoStart: true, meta };
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  return { autoStart: false, meta: null };
}

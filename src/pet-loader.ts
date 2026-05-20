import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { PetMeta } from './types';

export async function pickPetFolder(): Promise<string | null> {
  return open({
    directory: true,
    title: '选择桌宠文件夹',
  }) as Promise<string | null>;
}

export async function loadPet(folder: string): Promise<PetMeta> {
  return invoke<PetMeta>('load_pet', { folder });
}

export async function loadSpritesheet(path: string): Promise<string> {
  return invoke<string>('load_spritesheet', { path });
}

export async function deletePetWorkspace(folder: string): Promise<void> {
  return invoke<void>('delete_pet_workspace', { folder });
}

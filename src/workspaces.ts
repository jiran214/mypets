import { loadPet } from './pet-loader';
import type { PetMeta } from './types';

const STORAGE_KEY = 'mypets-workspaces-v1';

interface WorkspaceRegistry {
  folders: string[];
  currentFolder: string;
}

export interface PetWorkspace {
  folder: string;
  meta: PetMeta;
}

function readRegistry(): WorkspaceRegistry {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { folders: [], currentFolder: '' };
    const parsed = JSON.parse(raw) as Partial<WorkspaceRegistry>;
    return {
      folders: Array.isArray(parsed.folders)
        ? parsed.folders.filter((folder): folder is string => typeof folder === 'string' && folder.length > 0)
        : [],
      currentFolder: typeof parsed.currentFolder === 'string' ? parsed.currentFolder : '',
    };
  } catch {
    return { folders: [], currentFolder: '' };
  }
}

function writeRegistry(registry: WorkspaceRegistry): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
}

function uniqueFolders(folders: string[]): string[] {
  return Array.from(new Set(folders));
}

export async function loadSavedWorkspaces(): Promise<{ workspaces: PetWorkspace[]; currentFolder: string }> {
  const registry = readRegistry();
  const workspaces: PetWorkspace[] = [];

  for (const folder of uniqueFolders(registry.folders)) {
    try {
      workspaces.push({ folder, meta: await loadPet(folder) });
    } catch (error) {
      console.warn('Skip invalid pet workspace:', folder, error);
    }
  }

  const currentFolder = workspaces.some((workspace) => workspace.folder === registry.currentFolder)
    ? registry.currentFolder
    : workspaces[0]?.folder ?? '';
  writeRegistry({ folders: workspaces.map((workspace) => workspace.folder), currentFolder });
  return { workspaces, currentFolder };
}

export function saveWorkspaceSelection(workspaces: PetWorkspace[], currentFolder: string): void {
  writeRegistry({
    folders: uniqueFolders(workspaces.map((workspace) => workspace.folder)),
    currentFolder,
  });
}

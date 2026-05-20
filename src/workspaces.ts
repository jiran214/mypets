import { loadPet } from './pet-loader';
import type { PetMeta } from './types';

const STORAGE_KEY = 'mypets-workspaces-v1';

interface WorkspaceRegistry {
  folders: string[];
  currentFolder: string;
  enabledFolders: string[];
}

export interface PetWorkspace {
  folder: string;
  enabled: boolean;
  status: 'ready' | 'missing';
  meta?: PetMeta;
  missingMessage?: string;
}

export type ReadyPetWorkspace = PetWorkspace & {
  status: 'ready';
  meta: PetMeta;
};

function readRegistry(): WorkspaceRegistry {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { folders: [], currentFolder: '', enabledFolders: [] };
    const parsed = JSON.parse(raw) as Partial<WorkspaceRegistry>;
    return {
      folders: Array.isArray(parsed.folders)
        ? parsed.folders.filter((folder): folder is string => typeof folder === 'string' && folder.length > 0)
        : [],
      currentFolder: typeof parsed.currentFolder === 'string' ? parsed.currentFolder : '',
      enabledFolders: Array.isArray(parsed.enabledFolders)
        ? parsed.enabledFolders.filter((folder): folder is string => typeof folder === 'string' && folder.length > 0)
        : [],
    };
  } catch {
    return { folders: [], currentFolder: '', enabledFolders: [] };
  }
}

function writeRegistry(registry: WorkspaceRegistry): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
}

function uniqueFolders(folders: string[]): string[] {
  return Array.from(new Set(folders));
}

function missingMessage(folder: string): string {
  return `未找到文件资源:${folder}`;
}

export function isReadyWorkspace(workspace: PetWorkspace | null | undefined): workspace is ReadyPetWorkspace {
  return Boolean(workspace?.status === 'ready' && workspace.meta);
}

export async function loadSavedWorkspaces(): Promise<{ workspaces: PetWorkspace[]; currentFolder: string }> {
  const registry = readRegistry();
  const enabledFolders = new Set(registry.enabledFolders);
  const workspaces: PetWorkspace[] = [];

  for (const folder of uniqueFolders(registry.folders)) {
    try {
      workspaces.push({
        folder,
        enabled: enabledFolders.has(folder),
        status: 'ready',
        meta: await loadPet(folder),
      });
    } catch (error) {
      console.warn('Pet workspace is missing:', folder, error);
      workspaces.push({
        folder,
        enabled: false,
        status: 'missing',
        missingMessage: missingMessage(folder),
      });
    }
  }

  const currentFolder = workspaces.some((workspace) => workspace.folder === registry.currentFolder)
    ? registry.currentFolder
    : workspaces[0]?.folder ?? '';
  saveWorkspaceSelection(workspaces, currentFolder);
  return { workspaces, currentFolder };
}

export function saveWorkspaceSelection(workspaces: PetWorkspace[], currentFolder: string): void {
  writeRegistry({
    folders: uniqueFolders(workspaces.map((workspace) => workspace.folder)),
    currentFolder,
    enabledFolders: uniqueFolders(
      workspaces
        .filter((workspace) => isReadyWorkspace(workspace) && workspace.enabled)
        .map((workspace) => workspace.folder),
    ),
  });
}

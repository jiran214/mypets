import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { hasTauriRuntime, useTauriListen } from '@/lib/tauri-utils';
import {
  ArrowLeft,
  Bot,
  Clock,
  FolderPlus,
  ImageIcon,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  Settings,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { GeneralSettings, SkinSettings, AgentSettings, SkillSettings, AutoTaskSettings } from '@/components/settings';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ANIMATIONS, CELL_H, CELL_W } from '@/pet/animation-data';
import {
  deleteAutoTask,
  listAutoTasks,
  saveAutoTask,
  type AutoTask,
} from '@/ai/auto-tasks';
import { AutoTaskScheduler, prepareAutoTaskForSave, upsertAutoTask } from '@/ai/auto-task-scheduler';
import { loadAgentsMd, saveAiSettings, saveAgentsMd } from '@/ai/ai-api';
import type { ChatRuntime } from '@/ai/chat-runtime';
import { ChatPanel } from '@/ai/chat-ui';
import type { AiSessionSummary, AiSettings, AiState } from '@/ai/ai-types';
import {
  deletePetWorkspace,
  loadPet,
  loadSpritesheet,
  openWorkspaceInFileManager,
  pickPetFolder,
} from '@/pet/pet-loader';
import {
  applyPetWindowSettings,
  hidePetWindow,
  setPetWindowTitle,
  showPetWindow,
  syncEnabledWorkspaces,
} from '@/pet/pet-windows';
import {
  isReadyWorkspace,
  loadSavedWorkspaces,
  saveWorkspaceSelection,
  type PetWorkspace,
  type ReadyPetWorkspace,
} from './workspaces';

const roots = new WeakMap<HTMLElement, Root>();
const AVATAR_SIZE = 40;
const spritesheetCache = new Map<string, Promise<HTMLImageElement>>();

type SettingsTab = 'general' | 'skin' | 'agent' | 'skills' | 'autoTasks';
type MainView = 'chat' | 'settings';

export function mountManagerApp(root: HTMLElement, runtime: ChatRuntime): void {
  roots.get(root)?.unmount();
  root.innerHTML = '';

  const reactRoot = createRoot(root);
  roots.set(root, reactRoot);
  reactRoot.render(
    <TooltipProvider>
      <ManagerApp runtime={runtime} />
    </TooltipProvider>,
  );
}

function ManagerApp({ runtime }: { runtime: ChatRuntime }): ReactNode {
  const [workspaces, setWorkspaces] = useState<PetWorkspace[]>([]);
  const [currentFolder, setCurrentFolder] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mainView, setMainView] = useState<MainView>('chat');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [settingsDraft, setSettingsDraft] = useState<AiSettings>(() => defaultAiSettings());
  const [settingsStatus, setSettingsStatus] = useState('');
  const [personaDraft, setPersonaDraft] = useState('');
  const [autoTasks, setAutoTasks] = useState<AutoTask[]>([]);
  const [autoTaskStatus, setAutoTaskStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [, setRuntimeTick] = useState(0);
  const currentFolderRef = useRef(currentFolder);
  const autoTasksRef = useRef<AutoTask[]>([]);
  const aiState = runtime.getAiState();

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.folder === currentFolder) ?? null,
    [currentFolder, workspaces],
  );
  const readyWorkspace = isReadyWorkspace(selectedWorkspace) ? selectedWorkspace : null;

  const selectWorkspaceFromList = useCallback(async (folder: string, source: PetWorkspace[]): Promise<void> => {
    const workspace = source.find((item) => item.folder === folder) ?? null;
    const nextFolder = workspace ? folder : '';
    setCurrentFolder(nextFolder);
    saveWorkspaceSelection(source, nextFolder);
    await runtime.setWorkspace(isReadyWorkspace(workspace) ? nextFolder : '');
  }, [runtime]);

  const selectWorkspace = useCallback((folder: string): void => {
    void selectWorkspaceFromList(folder, workspaces);
    setMainView('chat');
  }, [selectWorkspaceFromList, workspaces]);

  const openWorkspaceSettings = useCallback((folder: string): void => {
    void selectWorkspaceFromList(folder, workspaces).then(() => {
      setMainView('settings');
    });
  }, [selectWorkspaceFromList, workspaces]);

  const importWorkspace = useCallback(async (): Promise<void> => {
    const folder = await pickPetFolder();
    if (!folder) return;

    try {
      const meta = await loadPet(folder);
      const existingIndex = workspaces.findIndex((workspace) => workspace.folder === folder);
      const enabled = existingIndex >= 0 ? workspaces[existingIndex].enabled : false;
      const workspace: PetWorkspace = { folder, meta, enabled, status: 'ready' };
      const next = existingIndex >= 0
        ? workspaces.map((item, index) => (index === existingIndex ? workspace : item))
        : [...workspaces, workspace];

      setWorkspaces(next);
      await selectWorkspaceFromList(folder, next);
      if (enabled) {
        await showPetWindow(workspace);
      }
    } catch (error) {
      alert(`无法导入桌宠资源：\n${error instanceof Error ? error.message : String(error)}`);
    }
  }, [selectWorkspaceFromList, workspaces]);

  const toggleWorkspace = useCallback(async (folder: string, enabled: boolean): Promise<void> => {
    const workspace = workspaces.find((item) => item.folder === folder);
    if (!isReadyWorkspace(workspace)) return;

    const next = workspaces.map((item) => (item.folder === folder ? { ...item, enabled } : item));
    setWorkspaces(next);
    saveWorkspaceSelection(next, currentFolder);

    try {
      if (enabled) {
        await showPetWindow({ ...workspace, enabled });
      } else {
        await hidePetWindow(folder);
      }
    } catch (error) {
      const reverted = workspaces.map((item) => (item.folder === folder ? { ...item, enabled: false } : item));
      setWorkspaces(reverted);
      saveWorkspaceSelection(reverted, currentFolder);
      alert(`无法${enabled ? '显示' : '关闭'}桌宠：\n${error instanceof Error ? error.message : String(error)}`);
    }
  }, [currentFolder, workspaces]);

  const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const changeSettingsDraft = useCallback((nextSettings: AiSettings): void => {
    setSettingsDraft(nextSettings);
    const workspace = readyWorkspace;
    if (!workspace) return;
    if (applyTimerRef.current !== null) {
      clearTimeout(applyTimerRef.current);
    }
    applyTimerRef.current = setTimeout(() => {
      applyTimerRef.current = null;
      void applyPetWindowSettings(workspace.folder, nextSettings).catch((error) => {
        console.warn('Failed to apply pet window settings:', error);
      });
    }, 800);
  }, [readyWorkspace?.folder]);

  const deleteWorkspace = useCallback(async (folder: string): Promise<void> => {
    const workspace = workspaces.find((item) => item.folder === folder);
    if (!workspace) return;

    try {
      if (isReadyWorkspace(workspace)) {
        await deletePetWorkspace(workspace.folder);
        await hidePetWindow(workspace.folder).catch((error) => {
          console.warn('Failed to close deleted pet window:', error);
        });
      }
      const next = workspaces.filter((item) => item.folder !== workspace.folder);
      const nextFolder = currentFolder === workspace.folder ? next[0]?.folder ?? '' : currentFolder;
      setWorkspaces(next);
      await selectWorkspaceFromList(nextFolder, next);
    } catch (error) {
      alert(`删除失败：\n${error instanceof Error ? error.message : String(error)}`);
    }
  }, [currentFolder, selectWorkspaceFromList, workspaces]);

  const deleteSelectedWorkspace = useCallback(async (): Promise<void> => {
    if (!selectedWorkspace) return;

    await deleteWorkspace(selectedWorkspace.folder);
  }, [deleteWorkspace, selectedWorkspace]);

  const persistAutoTask = useCallback(async (task: AutoTask): Promise<AutoTask> => {
    if (!readyWorkspace) {
      throw new Error('请先选择可用桌宠工作空间');
    }

    const normalized = prepareAutoTaskForSave(task);
    const saved = await saveAutoTask(readyWorkspace.folder, normalized);
    setAutoTasks((current) => upsertAutoTask(current, saved));
    setAutoTaskStatus('');
    return saved;
  }, [readyWorkspace]);

  const removeAutoTask = useCallback(async (taskId: string): Promise<void> => {
    if (!readyWorkspace) return;

    await deleteAutoTask(readyWorkspace.folder, taskId);
    setAutoTasks((current) => current.filter((task) => task.id !== taskId));
    setAutoTaskStatus('');
  }, [readyWorkspace?.folder]);

  useEffect(() => {
    const workspaceFolder = readyWorkspace?.folder;
    if (!workspaceFolder) return;

    const scheduler = new AutoTaskScheduler({
      workspaceFolder,
      runtime,
      getTasks: () => autoTasksRef.current,
      onTaskUpdate: (updater) => setAutoTasks(updater),
      onStatusChange: (status) => setAutoTaskStatus(status),
    });
    scheduler.start();

    return () => {
      scheduler.stop();
    };
  }, [readyWorkspace?.folder, runtime]);

  useEffect(() => {
    currentFolderRef.current = currentFolder;
  }, [currentFolder]);

  const readyWorkspaceRef = useRef(readyWorkspace);
  const settingsDraftRef = useRef(settingsDraft);
  const personaDraftRef = useRef(personaDraft);
  const settingsInitializedRef = useRef(false);
  const autoSavingRef = useRef(false);

  useEffect(() => {
    readyWorkspaceRef.current = readyWorkspace;
    settingsDraftRef.current = settingsDraft;
    personaDraftRef.current = personaDraft;
  }, [readyWorkspace, settingsDraft, personaDraft]);

  useEffect(() => {
    autoTasksRef.current = autoTasks;
  }, [autoTasks]);

  useEffect(() => {
    if (!readyWorkspace) {
      setAutoTasks([]);
      setAutoTaskStatus('');
      return;
    }

    let disposed = false;
    setAutoTaskStatus('');
    void listAutoTasks(readyWorkspace.folder)
      .then((tasks) => {
        if (disposed) return;
        setAutoTasks(tasks);
      })
      .catch((error) => {
        if (!disposed) setAutoTaskStatus(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
    };
  }, [readyWorkspace]);

  useEffect(() => {
    if (!readyWorkspace) {
      settingsInitializedRef.current = false;
      return;
    }
    settingsInitializedRef.current = true;
  }, [readyWorkspace]);

  const initializedFolderRef = useRef<string>('');

  useEffect(() => {
    const folder = readyWorkspace?.folder;
    if (!folder) {
      initializedFolderRef.current = '';
      return;
    }
    if (initializedFolderRef.current === folder) return;
    initializedFolderRef.current = folder;

    const freshState = runtime.getAiState();
    if (freshState) {
      autoSavingRef.current = true;
      setSettingsDraft(normalizeSettings(freshState.settings));
      setSettingsStatus('');
      autoSavingRef.current = false;
    }

    void loadAgentsMd(folder).then((content) => {
      setPersonaDraft(content);
    });
  }, [readyWorkspace, runtime]);

  useEffect(() => {
    if (!settingsInitializedRef.current || !readyWorkspace) return;
    if (initializedFolderRef.current !== readyWorkspace.folder) return;

    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    saveTimer = setTimeout(() => {
      saveTimer = null;
      const ws = readyWorkspaceRef.current;
      const draft = settingsDraftRef.current;
      if (!ws) return;

      autoSavingRef.current = true;
      void saveAiSettings(ws.folder, draft)
        .then((nextState) => {
          runtime.setAiState(nextState);
          setSettingsStatus('');
        })
        .catch((error) => {
          setSettingsStatus(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          autoSavingRef.current = false;
        });
    }, 600);

    return () => {
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
      }
    };
  }, [settingsDraft, readyWorkspace, runtime]);

  useEffect(() => {
    if (!settingsInitializedRef.current || !readyWorkspace) return;
    if (initializedFolderRef.current !== readyWorkspace.folder) return;

    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    saveTimer = setTimeout(() => {
      saveTimer = null;
      const ws = readyWorkspaceRef.current;
      const persona = personaDraftRef.current;
      if (!ws) return;

      void saveAgentsMd(ws.folder, persona).catch(() => {});
    }, 600);

    return () => {
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
      }
    };
  }, [personaDraft, readyWorkspace]);

  useEffect(() => {
    const name = settingsDraft.displayName.trim();
    const folder = readyWorkspace?.folder;
    if (!folder || !name || readyWorkspace.meta.displayName === name) return;
    setWorkspaces((current) => {
      const next = current.map((w) => (
        w.folder === folder && isReadyWorkspace(w)
          ? { ...w, meta: { ...w.meta, displayName: name } }
          : w
      ));
      saveWorkspaceSelection(next, currentFolderRef.current);
      return next;
    });
    void setPetWindowTitle(folder, name);
  }, [settingsDraft.displayName, readyWorkspace?.folder, readyWorkspace?.meta.displayName]);

  const prevAiStateRef = useRef<AiState | null>(null);
  useEffect(() => runtime.subscribe(() => {
    const next = runtime.getAiState();
    if (next !== prevAiStateRef.current) {
      prevAiStateRef.current = next;
      setRuntimeTick((version) => version + 1);
    }
  }), [runtime]);

  useEffect(() => {
    if (autoSavingRef.current) return;
    setSettingsDraft(normalizeSettings(aiState?.settings));
    setSettingsStatus('');
  }, [aiState]);

  useEffect(() => {
    let disposed = false;

    const boot = async (): Promise<void> => {
      setLoading(true);
      const saved = await loadSavedWorkspaces();
      const failedFolders = await syncEnabledWorkspaces(saved.workspaces);
      let next = saved.workspaces;

      if (failedFolders.length > 0) {
        const failed = new Set(failedFolders);
        next = next.map((workspace) => (
          failed.has(workspace.folder) ? { ...workspace, enabled: false } : workspace
        ));
      }

      const nextFolder = next.some((workspace) => workspace.folder === saved.currentFolder)
        ? saved.currentFolder
        : next[0]?.folder ?? '';

      if (disposed) return;
      setWorkspaces(next);
      await selectWorkspaceFromList(nextFolder, next);
      setLoading(false);
    };

    void boot().catch((error) => {
      console.warn('Failed to initialize manager:', error);
      setLoading(false);
    });

    return () => {
      disposed = true;
    };
  }, [selectWorkspaceFromList]);

  useTauriListen<{ folder?: string }>('pet-window-closed', (payload) => {
    const folder = payload.folder;
    if (!folder) return;

    setWorkspaces((current) => {
      const next = current.map((workspace) => (
        workspace.folder === folder ? { ...workspace, enabled: false } : workspace
      ));
      saveWorkspaceSelection(next, currentFolderRef.current);
      return next;
    });
  }, []);

  useTauriListen<{ id: string }>('request-pet-waving', (payload) => {
    void emit('pet-waving', { id: payload.id });
  }, []);

  useTauriListen<{ folder: string }>('focus-pet-chat', (payload) => {
    const folder = payload.folder;
    if (!folder) return;
    selectWorkspace(folder);
    const win = getCurrentWindow();
    void (async () => {
      // Temporarily set always-on-top to appear above pet windows.
      await win.setAlwaysOnTop(true).catch(() => {});
      await win.show().catch(() => {});
      await win.unminimize().catch(() => {});
      await win.setFocus().catch(() => {});
      setTimeout(() => {
        void win.setAlwaysOnTop(false).catch(() => {});
      }, 500);
    })();
  }, [selectWorkspace]);

  return (
    <div className="flex size-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,var(--accent),transparent_28rem),linear-gradient(180deg,var(--background),var(--muted))] text-foreground">
      <ManagerTitleBar />
      <div className="flex min-h-0 flex-1 px-3 pb-3 pt-1">
        <aside
          className={cn(
            'manager-panel flex min-h-0 shrink-0 flex-col gap-3 transition-[width] duration-200',
            sidebarCollapsed ? 'w-[72px]' : 'w-[292px]',
            sidebarCollapsed ? 'items-center p-3' : 'p-3',
          )}
        >
        <div className={cn('flex h-9 items-center gap-2', sidebarCollapsed ? 'justify-center' : 'justify-between')}>
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">桌宠列表</div>
              <div className="text-xs text-muted-foreground">{workspaces.length} 个资源</div>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={sidebarCollapsed ? '展开桌宠列表' : '折叠桌宠列表'}
            title={sidebarCollapsed ? '展开' : '折叠'}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? <PanelLeftOpen data-icon="inline-start" /> : <PanelLeftClose data-icon="inline-start" />}
          </Button>
        </div>

        <Button
          variant="outline"
          size={sidebarCollapsed ? 'icon' : 'default'}
          type="button"
          className={cn(sidebarCollapsed && 'size-10')}
          aria-label="导入桌宠资源"
          title="导入桌宠资源"
          onClick={() => void importWorkspace()}
        >
          <FolderPlus data-icon="inline-start" />
          {!sidebarCollapsed && '导入'}
        </Button>

        <Separator className={cn(sidebarCollapsed && 'w-10')} />

        <ScrollArea type="scroll" className={cn('min-h-0 flex-1', sidebarCollapsed ? 'w-12' : 'w-full')}>
          {loading ? (
            sidebarCollapsed ? (
              <div className="h-10" aria-hidden="true" />
            ) : (
              <div className="px-1 py-6 text-center text-sm text-muted-foreground">加载中...</div>
            )
          ) : workspaces.length === 0 ? (
            sidebarCollapsed ? (
              <div className="h-10" aria-hidden="true" />
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                还没有桌宠资源
              </div>
            )
          ) : (
            <div className={cn('flex flex-col gap-2', sidebarCollapsed ? 'items-center' : '')}>
              {workspaces.map((workspace) => (
                <WorkspaceListItem
                  key={workspace.folder}
                  workspace={workspace}
                  active={workspace.folder === currentFolder}
                  collapsed={sidebarCollapsed}
                  onSelect={selectWorkspace}
                  onOpenSettings={() => openWorkspaceSettings(workspace.folder)}
                  onDelete={() => void deleteWorkspace(workspace.folder)}
                  onToggleDisplay={(enabled) => void toggleWorkspace(workspace.folder, enabled)}
                />
              ))}
            </div>
          )}
        </ScrollArea>
        </aside>

        <section className="manager-panel ml-3 flex min-w-0 flex-1 flex-col overflow-hidden">
          {mainView === 'chat' ? (
            <div className="min-h-0 flex-1">
              <ChatPanel runtime={runtime} variant="embedded" petName={readyWorkspace?.meta.displayName} />
            </div>
          ) : (
            <SettingsSurface
              selectedWorkspace={selectedWorkspace}
              readyWorkspace={readyWorkspace}
              settingsTab={settingsTab}
              settingsDraft={settingsDraft}
              settingsStatus={settingsStatus}
              personaDraft={personaDraft}
              autoTasks={autoTasks}
              autoTaskStatus={autoTaskStatus}
              sessions={runtime.getSessions()}
              onBack={() => setMainView('chat')}
              onSettingsTabChange={setSettingsTab}
              onSettingsChange={changeSettingsDraft}
              onPersonaChange={setPersonaDraft}
              onSaveAutoTask={(task) => {
                void persistAutoTask(task).catch((error) => {
                  setAutoTaskStatus(error instanceof Error ? error.message : String(error));
                });
              }}
              onDeleteAutoTask={(taskId) => {
                void removeAutoTask(taskId).catch((error) => {
                  setAutoTaskStatus(error instanceof Error ? error.message : String(error));
                });
              }}
              onOpenAutoTaskConversation={(session) => {
                runtime.resumeConversation(session);
                setMainView('chat');
              }}
              onDeleteWorkspace={() => void deleteSelectedWorkspace()}
              onImportWorkspace={() => void importWorkspace()}
              onOpenWorkspaceFolder={() => {
                if (!readyWorkspace) return;
                void openWorkspaceInFileManager(readyWorkspace.folder).catch((error) => {
                  setSettingsStatus(error instanceof Error ? error.message : String(error));
                });
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function ManagerTitleBar(): ReactNode {
  return (
    <div
      className="manager-titlebar"
      onMouseDown={startManagerWindowDrag}
    >
      <div className="manager-titlebar__identity">
        <span className="manager-app-mark" aria-hidden="true" />
        <span>Wimi Pet</span>
      </div>
      <div className="manager-titlebar__drag" />
      <div className="manager-window-controls">
        <button
          className="manager-window-button"
          type="button"
          aria-label="最小化"
          title="最小化"
          onClick={minimizeManagerWindow}
        >
          <Minus aria-hidden="true" />
        </button>
        <button
          className="manager-window-button manager-window-button--close"
          type="button"
          aria-label="关闭"
          title="关闭"
          onClick={closeManagerWindow}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function startManagerWindowDrag(event: ReactMouseEvent<HTMLElement>): void {
  if (event.button !== 0 || !hasTauriRuntime()) return;
  if (event.detail !== 1) return;
  if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"], [role="menuitem"], [contenteditable="true"]')) return;
  event.preventDefault();
  void getCurrentWindow().startDragging().catch(() => {});
}

function minimizeManagerWindow(): void {
  if (!hasTauriRuntime()) return;
  void getCurrentWindow().minimize().catch(() => {});
}

function closeManagerWindow(): void {
  if (!hasTauriRuntime()) return;
  void getCurrentWindow().close().catch(() => {});
}

interface WorkspaceListItemProps {
  workspace: PetWorkspace;
  active: boolean;
  collapsed: boolean;
  onSelect: (folder: string) => void;
  onOpenSettings: () => void;
  onDelete: () => void;
  onToggleDisplay: (enabled: boolean) => void;
}

function WorkspaceListItem({
  workspace,
  active,
  collapsed,
  onSelect,
  onOpenSettings,
  onDelete,
  onToggleDisplay,
}: WorkspaceListItemProps): ReactNode {
  const ready = isReadyWorkspace(workspace);

  return (
    <div
      className={cn(
        'group overflow-hidden rounded-lg border bg-card text-card-foreground transition-colors hover:bg-accent/50',
        collapsed && 'w-12 overflow-hidden',
        active && 'border-foreground',
        !ready && 'border-destructive/40',
      )}
    >
      <button
        type="button"
        className={cn(
          'flex h-auto w-full cursor-pointer items-center gap-2 rounded-lg bg-transparent px-2 py-2 text-left text-card-foreground outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
          collapsed && 'size-12 justify-center p-0',
        )}
        title={ready ? workspace.meta.displayName : workspace.missingMessage}
        onClick={() => onSelect(workspace.folder)}
      >
        <PetAvatar workspace={workspace} />
        {!collapsed && (
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="truncate text-sm font-medium">{ready ? workspace.meta.displayName : '资源丢失'}</span>
            <span className="truncate text-xs text-muted-foreground">{ready ? workspace.meta.description : workspace.folder}</span>
            <span className="flex items-center gap-1">
              <Badge variant={ready ? 'secondary' : 'destructive'}>{ready ? '可显示' : '丢失'}</Badge>
            </span>
          </span>
        )}
      </button>
      {!collapsed && (
        <div className="flex h-9 items-center justify-between gap-2 border-t px-2">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="justify-start text-muted-foreground hover:bg-transparent hover:text-muted-foreground"
            disabled={!ready}
            aria-label={`打开 ${ready ? workspace.meta.displayName : workspace.folder} 设置`}
            title="设置"
            onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
          >
            <Settings data-icon="inline-start" />
            <span className="text-xs">设置</span>
          </Button>
          {ready ? (
            <Switch
              checked={workspace.enabled}
              aria-label={`${workspace.enabled ? '隐藏' : '显示'} ${workspace.meta.displayName}`}
              title={workspace.enabled ? '隐藏桌宠' : '显示桌宠'}
              onCheckedChange={(checked) => { onToggleDisplay(checked); }}
            />
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className="justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`删除丢失资源 ${workspace.folder}`}
                  title="删除"
                >
                  <Trash2 data-icon="inline-start" />
                  <span className="text-xs">删除</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>移除丢失资源？</AlertDialogTitle>
                  <AlertDialogDescription>
                    将从桌宠列表移除该项目空间路径：{workspace.folder}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={onDelete}>删除</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}
    </div>
  );
}

interface SettingsSurfaceProps {
  selectedWorkspace: PetWorkspace | null;
  readyWorkspace: ReadyPetWorkspace | null;
  settingsTab: SettingsTab;
  settingsDraft: AiSettings;
  settingsStatus: string;
  personaDraft: string;
  autoTasks: AutoTask[];
  autoTaskStatus: string;
  sessions: AiSessionSummary[];
  onSettingsTabChange: (tab: SettingsTab) => void;
  onSettingsChange: (settings: AiSettings) => void;
  onPersonaChange: (persona: string) => void;
  onSaveAutoTask: (task: AutoTask) => void;
  onDeleteAutoTask: (taskId: string) => void;
  onOpenAutoTaskConversation: (session: AiSessionSummary) => void;
  onDeleteWorkspace: () => void;
  onImportWorkspace: () => void;
  onBack: () => void;
  onOpenWorkspaceFolder: () => void;
}

function SettingsSurface({
  selectedWorkspace,
  readyWorkspace,
  settingsTab,
  settingsDraft,
  settingsStatus,
  personaDraft,
  autoTasks,
  autoTaskStatus,
  sessions,
  onSettingsTabChange,
  onSettingsChange,
  onPersonaChange,
  onSaveAutoTask,
  onDeleteAutoTask,
  onOpenAutoTaskConversation,
  onDeleteWorkspace,
  onImportWorkspace,
  onBack,
  onOpenWorkspaceFolder,
}: SettingsSurfaceProps): ReactNode {
  return (
    <div className="flex size-full min-h-0 flex-col gap-3 p-3">
      <div className="flex h-9 shrink-0 items-center">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          返回聊天
        </Button>
      </div>

      <Tabs
        value={settingsTab}
        orientation="vertical"
        onValueChange={(value) => onSettingsTabChange(value as SettingsTab)}
        className="flex min-h-0 flex-1 flex-row gap-3"
      >
        <TabsList className="h-full w-36 shrink-0 justify-start p-1" variant="line">
          <TabsTrigger value="general" className="w-full justify-start">
            <UserRound data-icon="inline-start" />
            通用
          </TabsTrigger>
          <TabsTrigger value="skin" className="w-full justify-start">
            <ImageIcon data-icon="inline-start" />
            皮肤
          </TabsTrigger>
          <TabsTrigger value="agent" className="w-full justify-start">
            <Bot data-icon="inline-start" />
            Agent
          </TabsTrigger>
          <TabsTrigger value="skills" className="w-full justify-start">
            <Puzzle data-icon="inline-start" />
            技能
          </TabsTrigger>
          <TabsTrigger value="autoTasks" className="w-full justify-start">
            <Clock data-icon="inline-start" />
            自动任务
          </TabsTrigger>
        </TabsList>

        <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border bg-muted/20">
          <TabsContent value="general" className="m-0 h-full min-h-0 data-[state=inactive]:hidden">
            <ScrollArea className="size-full">
              <div className="p-4">
                <GeneralSettings
                  selectedWorkspace={selectedWorkspace}
                  readyWorkspace={readyWorkspace}
                  settingsDraft={settingsDraft}
                  settingsStatus={settingsStatus}
                  personaDraft={personaDraft}
                  onSettingsChange={onSettingsChange}
                  onPersonaChange={onPersonaChange}
                  onDeleteWorkspace={onDeleteWorkspace}
                  onOpenWorkspaceFolder={onOpenWorkspaceFolder}
                />
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="skin" className="m-0 h-full min-h-0 data-[state=inactive]:hidden">
            <ScrollArea className="size-full">
              <div className="p-4">
                <SkinSettings readyWorkspace={readyWorkspace} settingsDraft={settingsDraft} onSettingsChange={onSettingsChange} onImportWorkspace={onImportWorkspace} />
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="agent" className="m-0 h-full min-h-0 data-[state=inactive]:hidden">
            <ScrollArea className="size-full">
              <div className="p-4">
                <AgentSettings
                  readyWorkspace={readyWorkspace}
                  settingsDraft={settingsDraft}
                  onSettingsChange={onSettingsChange}
                />
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="skills" className="m-0 h-full min-h-0 data-[state=inactive]:hidden">
            <ScrollArea className="size-full">
              <div className="p-4">
                <SkillSettings
                  readyWorkspace={readyWorkspace}
                  settingsDraft={settingsDraft}
                  onSettingsChange={onSettingsChange}
                />
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="autoTasks" className="m-0 h-full min-h-0 data-[state=inactive]:hidden">
            <AutoTaskSettings
              readyWorkspace={readyWorkspace}
              tasks={autoTasks}
              sessions={sessions}
              status={autoTaskStatus}
              onSaveTask={onSaveAutoTask}
              onDeleteTask={onDeleteAutoTask}
              onOpenConversation={onOpenAutoTaskConversation}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function PetAvatar({ workspace }: { workspace: PetWorkspace }): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!isReadyWorkspace(workspace)) return;
    let disposed = false;

    void loadSpritesheetImage(workspace.meta.spritesheetPath)
      .then((image) => {
        if (disposed || !canvasRef.current) return;
        drawAvatar(canvasRef.current, image);
      })
      .catch((error) => {
        console.warn('Failed to load workspace avatar:', error);
      });

    return () => {
      disposed = true;
    };
  }, [workspace]);

  if (!isReadyWorkspace(workspace)) {
    return (
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-destructive/10 text-sm font-semibold text-destructive">
        !
      </span>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="size-10 shrink-0 rounded-md bg-muted"
      width={AVATAR_SIZE}
      height={AVATAR_SIZE}
      aria-label={`${workspace.meta.displayName} 头像`}
    />
  );
}


function defaultAiSettings(): AiSettings {
  return {
    petAlwaysOnTop: false,
    petGravityEnabled: true,
    petScale: 1,
    petResizeEnabled: false,
    displayName: '',
    pi: {
      provider: 'openai',
      model: '',
      thinkingLevel: 'medium',
      sessionDir: '',
      useNoSession: false,
      autoCompactionEnabled: true,
      autoRetryEnabled: true,
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      customEnvText: '',
      disabledSkills: [],
      extraSkillPaths: '',
    },
  };
}

function normalizeSettings(settings: AiSettings | null | undefined): AiSettings {
  const defaults = defaultAiSettings();
  return {
    petAlwaysOnTop: settings?.petAlwaysOnTop ?? defaults.petAlwaysOnTop,
    petGravityEnabled: settings?.petGravityEnabled ?? defaults.petGravityEnabled,
    petScale: settings?.petScale ?? defaults.petScale,
    petResizeEnabled: settings?.petResizeEnabled ?? defaults.petResizeEnabled,
    pi: {
      ...defaults.pi,
      ...settings?.pi,
      provider: settings?.pi?.provider || defaults.pi.provider,
      disabledSkills: settings?.pi?.disabledSkills ?? [],
    },
    displayName: settings?.displayName ?? '',
  };
}

function loadSpritesheetImage(spritesheetPath: string): Promise<HTMLImageElement> {
  const cached = spritesheetCache.get(spritesheetPath);
  if (cached) return cached;

  const promise = loadSpritesheet(spritesheetPath).then((dataUrl) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load spritesheet'));
    image.src = dataUrl;
  })).catch((error) => {
    spritesheetCache.delete(spritesheetPath);
    throw error;
  });
  spritesheetCache.set(spritesheetPath, promise);
  return promise;
}

function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function drawAvatar(canvas: HTMLCanvasElement, image: HTMLImageElement): void {
  const ctx = prepareCanvas(canvas, AVATAR_SIZE, AVATAR_SIZE);
  if (!ctx) return;

  const padding = 3;
  const size = AVATAR_SIZE - padding * 2;
  const scale = Math.min(size / CELL_W, size / CELL_H);
  const width = CELL_W * scale;
  const height = CELL_H * scale;
  const x = (AVATAR_SIZE - width) / 2;
  const y = (AVATAR_SIZE - height) / 2;
  const def = ANIMATIONS.idle;

  ctx.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.drawImage(image, 0, def.row * CELL_H, CELL_W, CELL_H, x, y, width, height);
}

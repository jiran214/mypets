import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  FolderOpen,
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ANIMATIONS, CELL_H, CELL_W } from './animation-data';
import { listSkills, saveAiSettings } from './ai-api';
import type { ChatRuntime } from './chat-runtime';
import { ChatPanel } from './chat-ui';
import type {
  AiSettings,
  CodexApprovalPolicy,
  CodexReasoningEffort,
  PermissionMode,
  ProviderId,
  SkillInfo,
  ThinkingIntensity,
} from './ai-types';
import {
  deletePetWorkspace,
  loadPet,
  loadSpritesheet,
  openWorkspaceInFileManager,
  pickPetFolder,
  updatePetOverrides,
} from './pet-loader';
import {
  applyPetWindowSettings,
  hidePetWindow,
  setPetWindowTitle,
  showPetWindow,
  syncEnabledWorkspaces,
} from './pet-windows';
import {
  isReadyWorkspace,
  loadSavedWorkspaces,
  saveWorkspaceSelection,
  type PetWorkspace,
  type ReadyPetWorkspace,
} from './workspaces';

const roots = new WeakMap<HTMLElement, Root>();
const PREVIEW_DISPLAY_W = 192;
const PREVIEW_DISPLAY_H = 208;
const AVATAR_SIZE = 40;
const DEFAULT_PET_PERSONA = '你是这个桌宠角色在用户电脑桌面上的人格化伙伴。你长期陪伴用户工作、学习和休息，语气自然、温和、有一点俏皮，但不喧宾夺主。你会把自己当作屏幕边缘的小生命：能观察用户给出的文字、任务和上下文，却不会假装看到屏幕上没有提供的信息。回答要优先简洁、可执行，用户焦虑时先帮他把问题拆小，用户专注时少打扰。你可以偶尔使用符合桌宠气质的短句和轻微拟声，但不要大量卖萌、不要刷表情。遇到技术问题时像可靠的同伴一样给出明确步骤；遇到情绪问题时先共情，再提出具体下一步。你不替用户做危险决定，不编造事实，不夸大能力。默认使用中文，除非用户要求其他语言。';
const spritesheetCache = new Map<string, Promise<HTMLImageElement>>();
const PERMISSION_MODE_OPTIONS: { value: PermissionMode; label: string; description: string }[] = [
  { value: 'default', label: 'default', description: '标准模式，执行有风险操作前会询问确认' },
  { value: 'acceptEdits', label: 'acceptEdits', description: '自动接受文件编辑，敏感操作仍可能需要权限' },
  { value: 'plan', label: 'plan', description: '计划模式，批准后再执行' },
  { value: 'auto', label: 'auto', description: '自动判断是否批准工具调用' },
  { value: 'dontAsk', label: 'dontAsk', description: '未预先允许的操作直接拒绝' },
  { value: 'bypassPermissions', label: 'bypassPermissions', description: '跳过权限检查，风险最高' },
];
const THINKING_INTENSITY_OPTIONS: { value: ThinkingIntensity; label: string }[] = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
];
const PROVIDER_OPTIONS: { value: ProviderId; label: string; description: string }[] = [
  { value: 'claude', label: 'Claude', description: '使用 Claude Agent SDK 与本地 Claude Code。' },
  { value: 'codex', label: 'Codex', description: '使用 OpenAI Codex app-server 协议。' },
];
const CODEX_APPROVAL_OPTIONS: { value: CodexApprovalPolicy; label: string; description: string }[] = [
  { value: 'untrusted', label: 'untrusted', description: '高风险操作默认先请求批准。' },
  { value: 'on-failure', label: 'on-failure', description: '先尝试受限执行，失败后再请求放宽。' },
  { value: 'on-request', label: 'on-request', description: '由 Codex 自主决定何时发起批准请求。' },
  { value: 'never', label: 'never', description: '不请求额外批准，受限于当前策略。' },
];
const CODEX_REASONING_OPTIONS: { value: CodexReasoningEffort; label: string }[] = [
  { value: 'none', label: 'none' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];

type SettingsTab = 'general' | 'skin' | 'agent' | 'skills';
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
  const [loading, setLoading] = useState(true);
  const [, setRuntimeTick] = useState(0);
  const currentFolderRef = useRef(currentFolder);
  const renameTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
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

  const renameWorkspace = useCallback((folder: string, displayName: string): void => {
    setWorkspaces((current) => {
      const next = current.map((workspace) => (
        workspace.folder === folder && isReadyWorkspace(workspace)
          ? { ...workspace, meta: { ...workspace.meta, displayName } }
          : workspace
      ));
      saveWorkspaceSelection(next, currentFolderRef.current);
      return next;
    });

    const trimmed = displayName.trim();
    if (!trimmed) return;

    const existingTimer = renameTimersRef.current.get(folder);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      renameTimersRef.current.delete(folder);
      void updatePetOverrides(folder, { displayName: trimmed })
        .then((meta) => {
          setWorkspaces((current) => {
            const next = current.map((workspace) => (
              workspace.folder === folder && isReadyWorkspace(workspace)
                ? { ...workspace, meta }
                : workspace
            ));
            saveWorkspaceSelection(next, currentFolderRef.current);
            return next;
          });
          void setPetWindowTitle(folder, meta.displayName);
        })
        .catch((error) => {
          setSettingsStatus(error instanceof Error ? error.message : String(error));
        });
    }, 500);
    renameTimersRef.current.set(folder, timer);
  }, []);

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
  }, [readyWorkspace]);

  const deleteSelectedWorkspace = useCallback(async (): Promise<void> => {
    if (!selectedWorkspace) return;

    try {
      if (isReadyWorkspace(selectedWorkspace)) {
        await deletePetWorkspace(selectedWorkspace.folder);
        await hidePetWindow(selectedWorkspace.folder).catch((error) => {
          console.warn('Failed to close deleted pet window:', error);
        });
      }
      const next = workspaces.filter((workspace) => workspace.folder !== selectedWorkspace.folder);
      const nextFolder = next[0]?.folder ?? '';
      setWorkspaces(next);
      await selectWorkspaceFromList(nextFolder, next);
    } catch (error) {
      alert(`删除失败：\n${error instanceof Error ? error.message : String(error)}`);
    }
  }, [selectWorkspaceFromList, selectedWorkspace, workspaces]);

  useEffect(() => {
    currentFolderRef.current = currentFolder;
  }, [currentFolder]);

  const readyWorkspaceRef = useRef(readyWorkspace);
  const settingsDraftRef = useRef(settingsDraft);
  const settingsInitializedRef = useRef(false);
  const autoSavingRef = useRef(false);

  useEffect(() => {
    readyWorkspaceRef.current = readyWorkspace;
    settingsDraftRef.current = settingsDraft;
  }, [readyWorkspace, settingsDraft]);

  useEffect(() => {
    if (!readyWorkspace) {
      settingsInitializedRef.current = false;
      return;
    }
    settingsInitializedRef.current = true;
  }, [readyWorkspace]);

  useEffect(() => {
    if (!settingsInitializedRef.current || !readyWorkspace) return;

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
  }, [settingsDraft, runtime]);

  useEffect(() => runtime.subscribe(() => {
    setRuntimeTick((version) => version + 1);
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

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void listen<{ folder?: string }>('pet-window-closed', (event) => {
      const folder = event.payload.folder;
      if (!folder) return;

      setWorkspaces((current) => {
        const next = current.map((workspace) => (
          workspace.folder === folder ? { ...workspace, enabled: false } : workspace
        ));
        saveWorkspaceSelection(next, currentFolderRef.current);
        return next;
      });
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch((error) => {
        console.warn('Failed to listen to pet window events:', error);
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void listen<{ id: string }>('request-pet-waving', (event) => {
      void emit('pet-waving', { id: event.payload.id });
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void listen<{ folder: string }>('focus-pet-chat', (event) => {
      const folder = event.payload.folder;
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
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      cleanup?.();
    };
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

        <ScrollArea className={cn('min-h-0 flex-1', sidebarCollapsed ? 'w-12' : 'w-full')}>
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
            <div className={cn('flex flex-col gap-2', sidebarCollapsed ? 'items-center pr-0' : 'pr-1')}>
              {workspaces.map((workspace) => (
                <WorkspaceListItem
                  key={workspace.folder}
                  workspace={workspace}
                  active={workspace.folder === currentFolder}
                  collapsed={sidebarCollapsed}
                  onSelect={selectWorkspace}
                  onOpenSettings={() => openWorkspaceSettings(workspace.folder)}
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
              onBack={() => setMainView('chat')}
              onSettingsTabChange={setSettingsTab}
              onSettingsChange={changeSettingsDraft}
              onDeleteWorkspace={() => void deleteSelectedWorkspace()}
              onImportWorkspace={() => void importWorkspace()}
              onRenameWorkspace={renameWorkspace}
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
      data-tauri-drag-region
      onMouseDown={startManagerWindowDrag}
    >
      <div className="manager-titlebar__identity" data-tauri-drag-region>
        <span className="manager-app-mark" aria-hidden="true" />
        <span data-tauri-drag-region>Wimi Pet</span>
      </div>
      <div className="manager-titlebar__drag" data-tauri-drag-region />
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
  if (event.target instanceof Element && event.target.closest('button')) return;
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
  onToggleDisplay: (enabled: boolean) => void;
}

function WorkspaceListItem({
  workspace,
  active,
  collapsed,
  onSelect,
  onOpenSettings,
  onToggleDisplay,
}: WorkspaceListItemProps): ReactNode {
  const ready = isReadyWorkspace(workspace);

  return (
    <div
      className={cn(
        'group cursor-pointer overflow-hidden rounded-lg border bg-card text-card-foreground transition-colors hover:bg-accent/50',
        collapsed && 'w-12 overflow-hidden',
        active && 'border-foreground',
        !ready && 'border-destructive/40',
      )}
      role="button"
      tabIndex={0}
      title={ready ? workspace.meta.displayName : workspace.missingMessage}
      onClick={() => onSelect(workspace.folder)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(workspace.folder); }}
    >
      <div
        className={cn(
          'flex h-auto w-full items-center gap-2 rounded-lg px-2 py-2 text-left',
          collapsed && 'size-12 justify-center p-0',
        )}
      >
        <PetAvatar workspace={workspace} />
        {!collapsed && (
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="truncate text-sm font-medium">{ready ? workspace.meta.displayName : '资源丢失'}</span>
            <span className="truncate text-xs text-muted-foreground">{ready ? workspace.meta.description : '~~'}</span>
            <span className="flex items-center gap-1">
              <Badge variant={ready ? 'secondary' : 'destructive'}>{ready ? '可显示' : '丢失'}</Badge>
            </span>
          </span>
        )}
      </div>
      {ready && !collapsed && (
        <div className="flex h-9 items-center justify-between gap-2 border-t px-2" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="justify-start text-muted-foreground hover:bg-transparent hover:text-muted-foreground"
            aria-label={`打开 ${workspace.meta.displayName} 设置`}
            title="设置"
            onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
          >
            <Settings data-icon="inline-start" />
            <span className="text-xs">设置</span>
          </Button>
          <Switch
            checked={workspace.enabled}
            aria-label={`${workspace.enabled ? '隐藏' : '显示'} ${workspace.meta.displayName}`}
            title={workspace.enabled ? '隐藏桌宠' : '显示桌宠'}
            onCheckedChange={(checked) => { onToggleDisplay(checked); }}
          />
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
  onSettingsTabChange: (tab: SettingsTab) => void;
  onSettingsChange: (settings: AiSettings) => void;
  onDeleteWorkspace: () => void;
  onImportWorkspace: () => void;
  onBack: () => void;
  onRenameWorkspace: (folder: string, displayName: string) => void;
  onOpenWorkspaceFolder: () => void;
}

function SettingsSurface({
  selectedWorkspace,
  readyWorkspace,
  settingsTab,
  settingsDraft,
  settingsStatus,
  onSettingsTabChange,
  onSettingsChange,
  onDeleteWorkspace,
  onImportWorkspace,
  onBack,
  onRenameWorkspace,
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
                  onSettingsChange={onSettingsChange}
                  onDeleteWorkspace={onDeleteWorkspace}
                  onRenameWorkspace={onRenameWorkspace}
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
        </div>
      </Tabs>
    </div>
  );
}

interface GeneralSettingsProps {
  selectedWorkspace: PetWorkspace | null;
  readyWorkspace: ReadyPetWorkspace | null;
  settingsDraft: AiSettings;
  settingsStatus: string;
  onSettingsChange: (settings: AiSettings) => void;
  onDeleteWorkspace: () => void;
  onRenameWorkspace: (folder: string, displayName: string) => void;
  onOpenWorkspaceFolder: () => void;
}

function GeneralSettings({
  selectedWorkspace,
  readyWorkspace,
  settingsDraft,
  settingsStatus,
  onSettingsChange,
  onDeleteWorkspace,
  onRenameWorkspace,
  onOpenWorkspaceFolder,
}: GeneralSettingsProps): ReactNode {
  const disabled = !readyWorkspace;

  return (
    <div className="flex min-h-full flex-col gap-4">
      <FieldSet disabled={disabled}>
        <FieldLegend>通用</FieldLegend>
        <FieldGroup>
          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="pet-display-name">桌宠名</FieldLabel>
            <Input
              id="pet-display-name"
              value={readyWorkspace?.meta.displayName ?? ''}
              disabled={disabled}
              placeholder="给桌宠起个名字"
              onChange={(event) => {
                if (!readyWorkspace) return;
                onRenameWorkspace(readyWorkspace.folder, event.currentTarget.value);
              }}
            />
            <FieldDescription>保存到当前工作空间的 settings.json，并同步已打开窗口标题。</FieldDescription>
          </Field>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Field orientation="horizontal" data-disabled={disabled} className="rounded-lg border bg-background p-3">
              <Switch
                id="pet-always-on-top"
                disabled={disabled}
                checked={settingsDraft.petAlwaysOnTop}
                onCheckedChange={(checked) => onSettingsChange({ ...settingsDraft, petAlwaysOnTop: checked })}
                aria-label="置顶"
              />
              <FieldContent>
                <FieldLabel htmlFor="pet-always-on-top">置顶</FieldLabel>
                <FieldDescription>开启后桌宠窗口始终保持在其他窗口上方。</FieldDescription>
              </FieldContent>
            </Field>

            <Field orientation="horizontal" data-disabled={disabled} className="rounded-lg border bg-background p-3">
              <Switch
                id="pet-gravity"
                disabled={disabled}
                checked={settingsDraft.petGravityEnabled}
                onCheckedChange={(checked) => onSettingsChange({ ...settingsDraft, petGravityEnabled: checked })}
                aria-label="重力"
              />
              <FieldContent>
                <FieldLabel htmlFor="pet-gravity">重力</FieldLabel>
                <FieldDescription>开启后桌宠会自由落体并停在任务栏上方。</FieldDescription>
              </FieldContent>
            </Field>
          </div>

          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="pet-persona">桌宠人设</FieldLabel>
            <Textarea
              id="pet-persona"
              value={settingsDraft.petPersona}
              disabled={disabled}
              rows={12}
              className="min-h-[240px]"
              placeholder={DEFAULT_PET_PERSONA}
              onChange={(event) => onSettingsChange({ ...settingsDraft, petPersona: event.currentTarget.value })}
            />
            <FieldDescription>自动保存，作为当前桌宠的对话人格注入当前 Agent。</FieldDescription>
          </Field>
        </FieldGroup>
      </FieldSet>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        {settingsStatus ? <div className="text-sm text-destructive">{settingsStatus}</div> : <div />}
        <div className="flex items-center gap-2">
        <Button type="button" variant="outline" disabled={!selectedWorkspace} onClick={onOpenWorkspaceFolder}>
          <FolderOpen data-icon="inline-start" />
          在资源管理器打开
        </Button>
        <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" disabled={!selectedWorkspace}>
                <Trash2 data-icon="inline-start" />
                删除
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除当前桌宠？</AlertDialogTitle>
                <AlertDialogDescription>
                  {isReadyWorkspace(selectedWorkspace)
                    ? `将把桌宠文件夹移入回收站：${selectedWorkspace.folder}`
                    : `将从列表移除该丢失资源：${selectedWorkspace?.folder ?? ''}`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={onDeleteWorkspace}>删除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

function SkinSettings({
  readyWorkspace,
  settingsDraft,
  onSettingsChange,
  onImportWorkspace,
}: {
  readyWorkspace: ReadyPetWorkspace | null;
  settingsDraft: AiSettings;
  onSettingsChange: (settings: AiSettings) => void;
  onImportWorkspace: () => void;
}): ReactNode {
  const disabled = !readyWorkspace;
  const scale = settingsDraft.petScale;

  return (
    <div className="flex min-h-full flex-col gap-4">
      <div className="flex min-h-[360px] items-center justify-center rounded-lg border bg-background overflow-hidden">
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}>
          <PetPreview workspace={readyWorkspace} />
        </div>
      </div>

      <FieldSet disabled={disabled}>
        <FieldGroup>
          <Field data-disabled={disabled}>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="pet-scale">桌宠大小</FieldLabel>
              <span className="text-sm text-muted-foreground">{Math.round(scale * 100)}%</span>
            </div>
            <input
              id="pet-scale"
              type="range"
              min={60}
              max={200}
              step={1}
              value={Math.round(scale * 100)}
              disabled={disabled}
              className="w-full accent-primary"
              onChange={(e) => {
                const next = Number(e.currentTarget.value) / 100;
                onSettingsChange({ ...settingsDraft, petScale: next });
              }}
            />
          </Field>

          <Field orientation="horizontal" data-disabled={disabled} className="rounded-lg border bg-background p-3">
            <Switch
              id="pet-resize-enabled"
              disabled={disabled}
              checked={settingsDraft.petResizeEnabled}
              onCheckedChange={(checked) => onSettingsChange({ ...settingsDraft, petResizeEnabled: checked })}
              aria-label="自由调节"
            />
            <FieldContent>
              <FieldLabel htmlFor="pet-resize-enabled">自由调节</FieldLabel>
              <FieldDescription>开启后可通过拖拽桌宠右下角角标自由调节大小。</FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>
      </FieldSet>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="min-w-0 text-sm text-muted-foreground">
          {readyWorkspace?.meta.spritesheetPath ?? '导入包含 pet.json 和贴图资源的文件夹'}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={disabled} onClick={onImportWorkspace}>
            <FolderOpen data-icon="inline-start" />
            导入皮肤资源
          </Button>
        </div>
      </div>
    </div>
  );
}

interface AgentSettingsProps {
  readyWorkspace: ReadyPetWorkspace | null;
  settingsDraft: AiSettings;
  onSettingsChange: (settings: AiSettings) => void;
}

function AgentSettings({
  readyWorkspace,
  settingsDraft,
  onSettingsChange,
}: AgentSettingsProps): ReactNode {
  const disabled = !readyWorkspace;
  const selectedProvider = PROVIDER_OPTIONS.find((option) => option.value === settingsDraft.providerId);
  const selectedPermissionMode = PERMISSION_MODE_OPTIONS.find((option) => option.value === settingsDraft.claude.permissionMode);
  const selectedThinkingIntensity = THINKING_INTENSITY_OPTIONS.find((option) => option.value === settingsDraft.claude.thinkingIntensity);
  const selectedCodexApprovalPolicy = CODEX_APPROVAL_OPTIONS.find((option) => option.value === settingsDraft.codex.approvalPolicy);
  const selectedCodexReasoningEffort = CODEX_REASONING_OPTIONS.find((option) => option.value === settingsDraft.codex.reasoningEffort);

  return (
    <div className="flex flex-col gap-4">
      <FieldSet disabled={disabled}>
        <FieldLegend>{settingsDraft.providerId === 'codex' ? 'Codex Agent' : 'Claude Agent'}</FieldLegend>
        <FieldGroup className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Field className="lg:col-span-2" data-disabled={disabled}>
            <FieldLabel>Provider</FieldLabel>
            <SettingDropdown
              disabled={disabled}
              value={selectedProvider?.label ?? settingsDraft.providerId}
              menuClassName="max-w-[32rem]"
            >
              <DropdownMenuRadioGroup
                value={settingsDraft.providerId}
                onValueChange={(value) => onSettingsChange({
                  ...settingsDraft,
                  providerId: value as ProviderId,
                })}
              >
                {PROVIDER_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="items-start gap-2 py-2 pr-8 whitespace-normal break-words leading-5"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </SettingDropdown>
          </Field>

          {settingsDraft.providerId === 'claude' ? (
            <>
          <Field data-disabled={disabled}>
            <FieldLabel>权限模式</FieldLabel>
            <SettingDropdown
              disabled={disabled}
              value={selectedPermissionMode?.label ?? settingsDraft.claude.permissionMode}
              menuClassName="max-w-[32rem]"
            >
              <DropdownMenuRadioGroup
                value={settingsDraft.claude.permissionMode}
                onValueChange={(value) => onSettingsChange({
                  ...settingsDraft,
                  claude: { ...settingsDraft.claude, permissionMode: value as PermissionMode },
                })}
              >
                {PERMISSION_MODE_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="items-start gap-2 py-2 pr-8 whitespace-normal break-words leading-5"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </SettingDropdown>
          </Field>

          <Field data-disabled={disabled}>
            <FieldLabel>思考强度</FieldLabel>
            <SettingDropdown
              disabled={disabled}
              value={selectedThinkingIntensity?.label ?? settingsDraft.claude.thinkingIntensity}
            >
              <DropdownMenuRadioGroup
                value={settingsDraft.claude.thinkingIntensity}
                onValueChange={(value) => onSettingsChange({
                  ...settingsDraft,
                  claude: { ...settingsDraft.claude, thinkingIntensity: value as ThinkingIntensity },
                })}
              >
                {THINKING_INTENSITY_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </SettingDropdown>
          </Field>

          <Field className="lg:col-span-2" data-disabled={disabled}>
            <FieldLabel htmlFor="claude-executable">Claude CLI 路径</FieldLabel>
            <Input
              id="claude-executable"
              value={settingsDraft.claude.pathToClaudeCodeExecutable}
              disabled={disabled}
              placeholder="不填写会自动查找 Claude"
              onChange={(event) => onSettingsChange({
                ...settingsDraft,
                claude: {
                  ...settingsDraft.claude,
                  pathToClaudeCodeExecutable: event.currentTarget.value,
                },
              })}
            />
          </Field>

          <Field className="lg:col-span-2" orientation="horizontal" data-disabled={disabled}>
            <Switch
              id="claude-user-settings"
              disabled={disabled}
              checked={settingsDraft.claude.useUserSettings}
              onCheckedChange={(checked) => onSettingsChange({
                ...settingsDraft,
                claude: { ...settingsDraft.claude, useUserSettings: checked },
              })}
            />
            <FieldContent>
              <FieldLabel htmlFor="claude-user-settings">加载用户 Claude 设置</FieldLabel>
              <FieldDescription>读取用户目录下的 Claude 配置。</FieldDescription>
            </FieldContent>
          </Field>

          <Field className="lg:col-span-2" data-disabled={disabled}>
            <FieldLabel htmlFor="claude-custom-env">自定义环境变量</FieldLabel>
            <Textarea
              id="claude-custom-env"
              value={settingsDraft.claude.customEnvText}
              disabled={disabled}
              rows={7}
              placeholder="KEY=value"
              onChange={(event) => onSettingsChange({
                ...settingsDraft,
                claude: { ...settingsDraft.claude, customEnvText: event.currentTarget.value },
              })}
            />
          </Field>
            </>
          ) : (
            <>
              <Field data-disabled={disabled}>
                <FieldLabel>批准策略</FieldLabel>
                <SettingDropdown
                  disabled={disabled}
                  value={selectedCodexApprovalPolicy?.label ?? settingsDraft.codex.approvalPolicy}
                  menuClassName="max-w-[32rem]"
                >
                  <DropdownMenuRadioGroup
                    value={settingsDraft.codex.approvalPolicy}
                    onValueChange={(value) => onSettingsChange({
                      ...settingsDraft,
                      codex: { ...settingsDraft.codex, approvalPolicy: value as CodexApprovalPolicy },
                    })}
                  >
                    {CODEX_APPROVAL_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem
                        key={option.value}
                        value={option.value}
                        className="items-start gap-2 py-2 pr-8 whitespace-normal break-words leading-5"
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="font-medium">{option.label}</span>
                          <span className="text-xs text-muted-foreground">{option.description}</span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </SettingDropdown>
              </Field>

              <Field data-disabled={disabled}>
                <FieldLabel>推理强度</FieldLabel>
                <SettingDropdown
                  disabled={disabled}
                  value={selectedCodexReasoningEffort?.label ?? settingsDraft.codex.reasoningEffort}
                >
                  <DropdownMenuRadioGroup
                    value={settingsDraft.codex.reasoningEffort}
                    onValueChange={(value) => onSettingsChange({
                      ...settingsDraft,
                      codex: { ...settingsDraft.codex, reasoningEffort: value as CodexReasoningEffort },
                    })}
                  >
                    {CODEX_REASONING_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </SettingDropdown>
              </Field>

              <Field className="lg:col-span-2" data-disabled={disabled}>
                <FieldLabel htmlFor="codex-executable">Codex 可执行文件</FieldLabel>
                <Input
                  id="codex-executable"
                  value={settingsDraft.codex.pathToCodexExecutable}
                  disabled={disabled}
                  placeholder="不填写会自动查找 codex"
                  onChange={(event) => onSettingsChange({
                    ...settingsDraft,
                    codex: {
                      ...settingsDraft.codex,
                      pathToCodexExecutable: event.currentTarget.value,
                    },
                  })}
                />
              </Field>

              <Field className="lg:col-span-2" data-disabled={disabled}>
                <FieldLabel htmlFor="codex-model">模型</FieldLabel>
                <Input
                  id="codex-model"
                  value={settingsDraft.codex.model}
                  disabled={disabled}
                  placeholder="留空则使用 Codex 默认模型"
                  onChange={(event) => onSettingsChange({
                    ...settingsDraft,
                    codex: { ...settingsDraft.codex, model: event.currentTarget.value },
                  })}
                />
                <FieldDescription>例如 `gpt-5.3-codex`。留空时沿用 Codex 当前默认配置。</FieldDescription>
              </Field>

              <Field className="lg:col-span-2" data-disabled={disabled}>
                <FieldLabel htmlFor="codex-custom-env">自定义环境变量</FieldLabel>
                <Textarea
                  id="codex-custom-env"
                  value={settingsDraft.codex.customEnvText}
                  disabled={disabled}
                  rows={7}
                  placeholder="KEY=value"
                  onChange={(event) => onSettingsChange({
                    ...settingsDraft,
                    codex: { ...settingsDraft.codex, customEnvText: event.currentTarget.value },
                  })}
                />
                <FieldDescription>Codex 默认会读取用户登录态和 `~/.codex` 配置。</FieldDescription>
              </Field>
            </>
          )}
        </FieldGroup>
      </FieldSet>

    </div>
  );
}

function SettingDropdown({
  value,
  disabled,
  children,
  menuClassName,
}: {
  value: string;
  disabled: boolean;
  children: ReactNode;
  menuClassName?: string;
}): ReactNode {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="outline"
          className="h-8 w-full justify-between px-2.5 font-normal"
        >
          <span className="min-w-0 truncate text-left">{value}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className={cn('min-w-[var(--radix-dropdown-menu-trigger-width)]', menuClassName)}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SkillSettings({
  readyWorkspace,
  settingsDraft,
  onSettingsChange,
}: {
  readyWorkspace: ReadyPetWorkspace | null;
  settingsDraft: AiSettings;
  onSettingsChange: (settings: AiSettings) => void;
}): ReactNode {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const disabled = !readyWorkspace;

  useEffect(() => {
    if (!readyWorkspace) {
      setSkills([]);
      return;
    }

    let disposed = false;
    setLoading(true);

    void listSkills(readyWorkspace.folder, settingsDraft.providerId)
      .then((result) => {
        if (!disposed) setSkills(result);
      })
      .catch((error) => {
        console.warn('Failed to load skills:', error);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [readyWorkspace, settingsDraft.providerId]);

  const enabledSkills = settingsDraft.claude.enabledSkills;
  const allSkillNames = skills.map((skill) => skill.name);
  const effectiveEnabledSkills = enabledSkills.length === 0 ? allSkillNames : enabledSkills.filter((name) => allSkillNames.includes(name));

  const toggleSkill = (name: string, enabled: boolean): void => {
    if (settingsDraft.providerId !== 'claude') return;
    const current = enabledSkills.length === 0 ? allSkillNames : effectiveEnabledSkills;
    const nextSet = enabled
      ? [...current, name]
      : current.filter((skillName) => skillName !== name);
    const next = [...new Set(nextSet)];
    onSettingsChange({
      ...settingsDraft,
      claude: {
        ...settingsDraft.claude,
        enabledSkills: next.length === allSkillNames.length ? [] : next,
      },
    });
  };

  const globalSkills = skills.filter((s) => s.scope === 'global');
  const workspaceSkills = skills.filter((s) => s.scope === 'workspace');

  const renderSkillItem = (skill: SkillInfo): ReactNode => {
    const isEnabled = enabledSkills.length === 0 || effectiveEnabledSkills.includes(skill.name);
    return (
      <div
        key={`${skill.scope}-${skill.name}`}
        className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{skill.name}</div>
          {skill.description && (
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{skill.description}</div>
          )}
        </div>
        <Switch
          checked={isEnabled}
          disabled={disabled || settingsDraft.providerId !== 'claude'}
          aria-label={`${isEnabled ? '禁用' : '启用'} ${skill.name}`}
          onCheckedChange={(checked) => toggleSkill(skill.name, checked)}
        />
      </div>
    );
  };

  return (
    <FieldSet disabled={disabled}>
      <FieldLegend>技能</FieldLegend>
      <FieldGroup>
        {settingsDraft.providerId !== 'claude' && (
          <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            当前仅对 Claude provider 应用此处的技能开关。Codex 会继续使用自身配置中的技能策略。
          </div>
        )}
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">加载中...</div>
        ) : skills.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            未发现已安装的技能
          </div>
        ) : (
          <>
            {globalSkills.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">全局技能</div>
                {globalSkills.map(renderSkillItem)}
              </div>
            )}
            {workspaceSkills.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">工作空间技能</div>
                {workspaceSkills.map(renderSkillItem)}
              </div>
            )}
          </>
        )}
      </FieldGroup>
    </FieldSet>
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

function PetPreview({ workspace }: { workspace: ReadyPetWorkspace | null }): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    let animationId: number | null = null;
    let frame = 0;
    let elapsed = 0;
    let lastTimestamp = 0;

    const cancel = (): void => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    };

    if (!workspace) {
      setError('');
      return cancel;
    }

    const tick = (image: HTMLImageElement, timestamp: number): void => {
      if (disposed || !canvasRef.current) return;
      const def = ANIMATIONS.idle;
      if (lastTimestamp === 0) {
        lastTimestamp = timestamp;
      }
      elapsed += timestamp - lastTimestamp;
      lastTimestamp = timestamp;

      while (elapsed >= def.durations[frame]) {
        elapsed -= def.durations[frame];
        frame = (frame + 1) % def.frameCount;
      }

      drawPreview(canvasRef.current, image, frame);
      animationId = requestAnimationFrame((nextTimestamp) => tick(image, nextTimestamp));
    };

    setError('');
    void loadSpritesheetImage(workspace.meta.spritesheetPath)
      .then((image) => {
        if (disposed || !canvasRef.current) return;
        drawPreview(canvasRef.current, image, 0);
        animationId = requestAnimationFrame((timestamp) => tick(image, timestamp));
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });

    return () => {
      disposed = true;
      cancel();
    };
  }, [workspace]);

  if (!workspace) {
    return <div className="text-sm text-muted-foreground">请选择一个可用桌宠</div>;
  }

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>;
  }

  return (
    <canvas
      ref={canvasRef}
      className="bg-transparent"
      width={PREVIEW_DISPLAY_W}
      height={PREVIEW_DISPLAY_H}
      aria-label={`${workspace.meta.displayName} 预览`}
    />
  );
}

function defaultAiSettings(): AiSettings {
  return {
    providerId: 'claude',
    petAlwaysOnTop: false,
    petGravityEnabled: true,
    petScale: 1,
    petResizeEnabled: false,
    petPersona: DEFAULT_PET_PERSONA,
    claude: {
      pathToClaudeCodeExecutable: '',
      permissionMode: 'default',
      thinkingIntensity: 'medium',
      useUserSettings: false,
      customEnvText: '',
      enabledSkills: [],
    },
    codex: {
      pathToCodexExecutable: '',
      model: '',
      approvalPolicy: 'on-request',
      reasoningEffort: 'medium',
      customEnvText: '',
    },
    petOverrides: {},
  };
}

function normalizeSettings(settings: AiSettings | null | undefined): AiSettings {
  const defaults = defaultAiSettings();
  return {
    providerId: settings?.providerId ?? defaults.providerId,
    petAlwaysOnTop: settings?.petAlwaysOnTop ?? defaults.petAlwaysOnTop,
    petGravityEnabled: settings?.petGravityEnabled ?? defaults.petGravityEnabled,
    petScale: settings?.petScale ?? defaults.petScale,
    petResizeEnabled: settings?.petResizeEnabled ?? defaults.petResizeEnabled,
    petPersona: settings?.petPersona ?? defaults.petPersona,
    claude: {
      ...defaults.claude,
      ...settings?.claude,
      enabledSkills: settings?.claude?.enabledSkills ?? [],
    },
    codex: {
      ...defaults.codex,
      ...settings?.codex,
    },
    petOverrides: settings?.petOverrides ?? {},
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
  }));
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

function drawPreview(canvas: HTMLCanvasElement, image: HTMLImageElement, frame: number): void {
  const ctx = prepareCanvas(canvas, PREVIEW_DISPLAY_W, PREVIEW_DISPLAY_H);
  if (!ctx) return;
  const def = ANIMATIONS.idle;
  ctx.clearRect(0, 0, PREVIEW_DISPLAY_W, PREVIEW_DISPLAY_H);
  ctx.drawImage(
    image,
    frame * CELL_W,
    def.row * CELL_H,
    CELL_W,
    CELL_H,
    0,
    0,
    PREVIEW_DISPLAY_W,
    PREVIEW_DISPLAY_H,
  );
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

function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

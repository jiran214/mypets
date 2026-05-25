import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  ChevronDown,
  Clock,
  FolderOpen,
  FolderPlus,
  History,
  ImageIcon,
  Minus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Puzzle,
  Search,
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  DropdownMenuItem,
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
import {
  AUTO_TASK_MISSED_GRACE_MS,
  AUTO_TASK_NAME_MAX,
  AUTO_TASK_PROMPT_MAX,
  autoTaskConversationTitle,
  computeNextRunAt,
  createAutoTaskDraft,
  deleteAutoTask,
  formatAutoTaskTime,
  intervalUnitLabel,
  listAutoTasks,
  normalizeAutoTask,
  runAutoTaskConversation,
  saveAutoTask,
  scheduleSummary,
  weekdayLabel,
  type AutoTask,
  type AutoTaskIntervalUnit,
  type AutoTaskRunStatus,
  type AutoTaskSchedule,
  type AutoTaskScheduleKind,
} from './auto-tasks';
import { listSkills, loadPiProviderAuth, saveAiSettings, savePiProviderAuth } from './ai-api';
import type { ChatRuntime } from './chat-runtime';
import { ChatPanel } from './chat-ui';
import type {
  AiSessionSummary,
  AiSettings,
  CodexApprovalPolicy,
  CodexReasoningEffort,
  PermissionMode,
  PiThinkingLevel,
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
  { value: 'pi', label: 'Pi', description: '使用 Pi Coding Agent RPC 模式。' },
  { value: 'claude', label: 'Claude Code', description: '使用 Claude Agent SDK 与本地 Claude Code。' },
  { value: 'codex', label: 'Codex', description: '使用 OpenAI Codex app-server 协议。' },
];
const PI_PROVIDER_OPTIONS: { value: string; label: string; envVar: string; authKey: string }[] = [
  { value: 'anthropic', label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY', authKey: 'anthropic' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI Responses', envVar: 'AZURE_OPENAI_API_KEY', authKey: 'azure-openai-responses' },
  { value: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', authKey: 'openai' },
  { value: 'deepseek', label: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY', authKey: 'deepseek' },
  { value: 'google', label: 'Google Gemini', envVar: 'GEMINI_API_KEY', authKey: 'google' },
  { value: 'mistral', label: 'Mistral', envVar: 'MISTRAL_API_KEY', authKey: 'mistral' },
  { value: 'groq', label: 'Groq', envVar: 'GROQ_API_KEY', authKey: 'groq' },
  { value: 'cerebras', label: 'Cerebras', envVar: 'CEREBRAS_API_KEY', authKey: 'cerebras' },
  { value: 'cloudflare-ai-gateway', label: 'Cloudflare AI Gateway', envVar: 'CLOUDFLARE_API_KEY', authKey: 'cloudflare-ai-gateway' },
  { value: 'cloudflare-workers-ai', label: 'Cloudflare Workers AI', envVar: 'CLOUDFLARE_API_KEY', authKey: 'cloudflare-workers-ai' },
  { value: 'xai', label: 'xAI', envVar: 'XAI_API_KEY', authKey: 'xai' },
  { value: 'openrouter', label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY', authKey: 'openrouter' },
  { value: 'vercel-ai-gateway', label: 'Vercel AI Gateway', envVar: 'AI_GATEWAY_API_KEY', authKey: 'vercel-ai-gateway' },
  { value: 'zai', label: 'ZAI', envVar: 'ZAI_API_KEY', authKey: 'zai' },
  { value: 'opencode', label: 'OpenCode Zen', envVar: 'OPENCODE_API_KEY', authKey: 'opencode' },
  { value: 'opencode-go', label: 'OpenCode Go', envVar: 'OPENCODE_API_KEY', authKey: 'opencode-go' },
  { value: 'huggingface', label: 'Hugging Face', envVar: 'HF_TOKEN', authKey: 'huggingface' },
  { value: 'fireworks', label: 'Fireworks', envVar: 'FIREWORKS_API_KEY', authKey: 'fireworks' },
  { value: 'together', label: 'Together AI', envVar: 'TOGETHER_API_KEY', authKey: 'together' },
  { value: 'kimi-coding', label: 'Kimi For Coding', envVar: 'KIMI_API_KEY', authKey: 'kimi-coding' },
  { value: 'minimax', label: 'MiniMax', envVar: 'MINIMAX_API_KEY', authKey: 'minimax' },
  { value: 'minimax-cn', label: 'MiniMax China', envVar: 'MINIMAX_CN_API_KEY', authKey: 'minimax-cn' },
  { value: 'xiaomi', label: 'Xiaomi MiMo', envVar: 'XIAOMI_API_KEY', authKey: 'xiaomi' },
  { value: 'xiaomi-token-plan-cn', label: 'Xiaomi Token Plan CN', envVar: 'XIAOMI_TOKEN_PLAN_CN_API_KEY', authKey: 'xiaomi-token-plan-cn' },
  { value: 'xiaomi-token-plan-ams', label: 'Xiaomi Token Plan Amsterdam', envVar: 'XIAOMI_TOKEN_PLAN_AMS_API_KEY', authKey: 'xiaomi-token-plan-ams' },
  { value: 'xiaomi-token-plan-sgp', label: 'Xiaomi Token Plan Singapore', envVar: 'XIAOMI_TOKEN_PLAN_SGP_API_KEY', authKey: 'xiaomi-token-plan-sgp' },
];
const PI_THINKING_OPTIONS: { value: PiThinkingLevel; label: string }[] = [
  { value: 'off', label: 'off' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
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
const AUTO_TASK_SCHEDULE_OPTIONS: { value: AutoTaskScheduleKind; label: string }[] = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'interval', label: '每间隔' },
];
const AUTO_TASK_WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7].map((value) => ({
  value,
  label: `周${weekdayLabel(value)}`,
}));
const AUTO_TASK_INTERVAL_UNIT_OPTIONS: { value: AutoTaskIntervalUnit; label: string }[] = [
  { value: 'minutes', label: '分钟' },
  { value: 'hours', label: '小时' },
  { value: 'days', label: '天' },
];
const AUTO_TASK_FILTER_OPTIONS: { value: AutoTaskFilter; label: string }[] = [
  { value: 'all', label: '全部项' },
  { value: 'running', label: '进行中' },
  { value: 'enabled', label: '已开启' },
  { value: 'paused', label: '已暂停' },
  { value: 'expired', label: '已过期' },
];

function piProviderOption(value: string): (typeof PI_PROVIDER_OPTIONS)[number] | undefined {
  const normalized = value.trim();
  return PI_PROVIDER_OPTIONS.find((option) => option.value === normalized);
}

function customPiEnvVar(provider: string): string {
  const normalized = provider.trim();
  if (!normalized) return 'API_KEY';
  return `${normalized.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()}_API_KEY`;
}

type SettingsTab = 'general' | 'skin' | 'agent' | 'skills' | 'autoTasks';
type MainView = 'chat' | 'settings';
type AutoTaskFilter = 'all' | 'running' | 'enabled' | 'paused' | 'expired';

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
  const [autoTasks, setAutoTasks] = useState<AutoTask[]>([]);
  const [autoTaskStatus, setAutoTaskStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [, setRuntimeTick] = useState(0);
  const currentFolderRef = useRef(currentFolder);
  const autoTasksRef = useRef<AutoTask[]>([]);
  const runningAutoTaskIdsRef = useRef(new Set<string>());
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

    let disposed = false;

    const persistRunnerTask = async (task: AutoTask): Promise<AutoTask | null> => {
      try {
        const saved = await saveAutoTask(workspaceFolder, task);
        if (!disposed) {
          setAutoTasks((current) => upsertAutoTask(current, saved));
        }
        return saved;
      } catch (error) {
        if (!disposed) {
          setAutoTaskStatus(error instanceof Error ? error.message : String(error));
        }
        return null;
      }
    };

    const markExpired = async (task: AutoTask, now: number, message: string): Promise<void> => {
      await persistRunnerTask({
        ...task,
        lastStatus: 'expired',
        lastStatusAt: now,
        lastError: message,
        nextRunAt: computeNextRunAt(task.schedule, now),
        updatedAt: now,
      });
    };

    const runDueTask = async (task: AutoTask): Promise<void> => {
      runningAutoTaskIdsRef.current.add(task.id);
      const startedAt = Date.now();
      const runningTask = {
        ...task,
        lastRunAt: startedAt,
        lastStatusAt: startedAt,
        lastStatus: 'running' as AutoTaskRunStatus,
        lastError: '',
        currentConversationId: '',
        updatedAt: startedAt,
      };
      const savedRunningTask = await persistRunnerTask(runningTask);
      if (!savedRunningTask) {
        runningAutoTaskIdsRef.current.delete(task.id);
        return;
      }

      try {
        const result = await runAutoTaskConversation(workspaceFolder, savedRunningTask);
        const finishedAt = Date.now();
        await persistRunnerTask({
          ...savedRunningTask,
          lastStatus: result.status === 'success' ? 'success' : 'failed',
          lastError: result.error ?? '',
          lastStatusAt: finishedAt,
          nextRunAt: computeNextRunAt(savedRunningTask.schedule, finishedAt),
          currentConversationId: result.conversationId,
          runCount: savedRunningTask.runCount + 1,
          updatedAt: finishedAt,
        });
        if (!disposed) {
          void runtime.refreshSessions();
        }
      } catch (error) {
        const failedAt = Date.now();
        await persistRunnerTask({
          ...savedRunningTask,
          lastStatus: 'failed',
          lastError: error instanceof Error ? error.message : String(error),
          lastStatusAt: failedAt,
          nextRunAt: computeNextRunAt(savedRunningTask.schedule, failedAt),
          runCount: savedRunningTask.runCount + 1,
          updatedAt: failedAt,
        });
      } finally {
        runningAutoTaskIdsRef.current.delete(task.id);
      }
    };

    const tick = (): void => {
      const now = Date.now();
      for (const task of autoTasksRef.current) {
        if (!task.id || !task.enabled) continue;
        if (runningAutoTaskIdsRef.current.has(task.id)) continue;

        if (task.lastStatus === 'running') {
          void markExpired(task, now, '上次执行被中断。');
          continue;
        }

        const nextRunAt = task.nextRunAt ?? computeNextRunAt(task.schedule, now);
        if (!task.nextRunAt) {
          void persistRunnerTask({ ...task, nextRunAt, updatedAt: now });
          continue;
        }
        if (nextRunAt > now) continue;

        if (now - nextRunAt > AUTO_TASK_MISSED_GRACE_MS) {
          void markExpired(task, now, '客户端未运行或系统休眠，已错过本次执行。');
          continue;
        }

        void runDueTask(task);
      }
    };

    tick();
    const timer = window.setInterval(tick, 15_000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [readyWorkspace?.folder, runtime]);

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
              autoTasks={autoTasks}
              autoTaskStatus={autoTaskStatus}
              sessions={runtime.getSessions()}
              onBack={() => setMainView('chat')}
              onSettingsTabChange={setSettingsTab}
              onSettingsChange={changeSettingsDraft}
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
  autoTasks: AutoTask[];
  autoTaskStatus: string;
  sessions: AiSessionSummary[];
  onSettingsTabChange: (tab: SettingsTab) => void;
  onSettingsChange: (settings: AiSettings) => void;
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
  autoTasks,
  autoTaskStatus,
  sessions,
  onSettingsTabChange,
  onSettingsChange,
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
                  onSettingsChange={onSettingsChange}
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

interface GeneralSettingsProps {
  selectedWorkspace: PetWorkspace | null;
  readyWorkspace: ReadyPetWorkspace | null;
  settingsDraft: AiSettings;
  settingsStatus: string;
  onSettingsChange: (settings: AiSettings) => void;
  onDeleteWorkspace: () => void;
  onOpenWorkspaceFolder: () => void;
}

function GeneralSettings({
  selectedWorkspace,
  readyWorkspace,
  settingsDraft,
  settingsStatus,
  onSettingsChange,
  onDeleteWorkspace,
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
              value={settingsDraft.displayName || readyWorkspace?.meta.displayName || ''}
              disabled={disabled}
              placeholder="给桌宠起个名字"
              onChange={(event) => {
                onSettingsChange({ ...settingsDraft, displayName: event.currentTarget.value });
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
  const selectedPiThinkingLevel = PI_THINKING_OPTIONS.find((option) => option.value === settingsDraft.pi.thinkingLevel);
  const selectedPermissionMode = PERMISSION_MODE_OPTIONS.find((option) => option.value === settingsDraft.claude.permissionMode);
  const selectedThinkingIntensity = THINKING_INTENSITY_OPTIONS.find((option) => option.value === settingsDraft.claude.thinkingIntensity);
  const selectedCodexApprovalPolicy = CODEX_APPROVAL_OPTIONS.find((option) => option.value === settingsDraft.codex.approvalPolicy);
  const selectedCodexReasoningEffort = CODEX_REASONING_OPTIONS.find((option) => option.value === settingsDraft.codex.reasoningEffort);
  const selectedPiProvider = piProviderOption(settingsDraft.pi.provider);
  const piProviderValue = settingsDraft.pi.provider.trim();
  const knownPiProvider = Boolean(selectedPiProvider);
  const piAuthKey = selectedPiProvider?.authKey ?? '';
  const piEnvVar = selectedPiProvider?.envVar ?? customPiEnvVar(piProviderValue);
  const [piApiKey, setPiApiKey] = useState('');
  const [piAuthStatus, setPiAuthStatus] = useState('');
  const [piAuthLoadedKey, setPiAuthLoadedKey] = useState('');
  const piAuthDirtyRef = useRef(false);

  useEffect(() => {
    if (disabled || settingsDraft.providerId !== 'pi' || !knownPiProvider || !piAuthKey) {
      setPiApiKey('');
      setPiAuthStatus(knownPiProvider ? '' : '自定义 provider 不写入 Pi auth.json，请在自定义环境变量中配置 API key。');
      setPiAuthLoadedKey('');
      return;
    }

    let disposed = false;
    setPiAuthStatus('读取 Pi API key...');
    void loadPiProviderAuth(piProviderValue, piAuthKey)
      .then((auth) => {
        if (disposed) return;
        piAuthDirtyRef.current = false;
        setPiApiKey(auth.key);
        setPiAuthLoadedKey(piAuthKey);
        setPiAuthStatus(auth.key ? '已从 Pi auth.json 读取 API key。' : '尚未保存 API key。');
      })
      .catch((error) => {
        if (disposed) return;
        piAuthDirtyRef.current = false;
        setPiApiKey('');
        setPiAuthLoadedKey(piAuthKey);
        setPiAuthStatus(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
    };
  }, [disabled, settingsDraft.providerId, knownPiProvider, piProviderValue, piAuthKey]);

  useEffect(() => {
    if (disabled || settingsDraft.providerId !== 'pi' || !knownPiProvider || !piAuthKey || piAuthLoadedKey !== piAuthKey) return;
    if (!piAuthDirtyRef.current) return;

    const saveTimer = setTimeout(() => {
      setPiAuthStatus('保存 Pi API key...');
      void savePiProviderAuth(piProviderValue, piAuthKey, piApiKey)
        .then(() => {
          piAuthDirtyRef.current = false;
          setPiAuthStatus(piApiKey.trim() ? '已保存到 Pi auth.json。' : '已从 Pi auth.json 移除。');
        })
        .catch((error) => {
          setPiAuthStatus(error instanceof Error ? error.message : String(error));
        });
    }, 600);

    return () => window.clearTimeout(saveTimer);
  }, [disabled, settingsDraft.providerId, knownPiProvider, piProviderValue, piAuthKey, piAuthLoadedKey, piApiKey]);

  return (
    <div className="flex flex-col gap-4">
      <FieldSet disabled={disabled}>
        <FieldLegend>{selectedProvider?.label ?? 'Agent'} Agent</FieldLegend>
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

          {settingsDraft.providerId === 'pi' ? (
            <>
              <Field data-disabled={disabled}>
                <FieldLabel>Pi provider</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    value={settingsDraft.pi.provider}
                    disabled={disabled}
                    placeholder="选择或输入 provider"
                    onChange={(event) => onSettingsChange({
                      ...settingsDraft,
                      pi: { ...settingsDraft.pi, provider: event.currentTarget.value },
                    })}
                  />
                  <SettingDropdown
                    disabled={disabled}
                    value={selectedPiProvider?.label ?? '选择'}
                    menuClassName="max-h-80 overflow-y-auto"
                  >
                    <DropdownMenuRadioGroup
                      value={settingsDraft.pi.provider}
                      onValueChange={(value) => onSettingsChange({
                        ...settingsDraft,
                        pi: { ...settingsDraft.pi, provider: value },
                      })}
                    >
                      {PI_PROVIDER_OPTIONS.map((option) => (
                        <DropdownMenuRadioItem
                          key={option.value}
                          value={option.value}
                          className="items-start gap-2 py-2 pr-8 whitespace-normal"
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="font-medium">{option.label}</span>
                            <span className="text-xs text-muted-foreground">{option.value} / {option.envVar}</span>
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </SettingDropdown>
                </div>
                <FieldDescription>可从列表选择，也可输入自定义 provider id。</FieldDescription>
              </Field>

              <Field data-disabled={disabled}>
                <FieldLabel>模型</FieldLabel>
                <Input
                  value={settingsDraft.pi.model}
                  disabled={disabled}
                  aria-invalid={!settingsDraft.pi.model.trim()}
                  className={!settingsDraft.pi.model.trim() ? 'border-destructive focus-visible:ring-destructive/30' : undefined}
                  placeholder="必填，例如 gpt-5.4"
                  onChange={(event) => onSettingsChange({
                    ...settingsDraft,
                    pi: { ...settingsDraft.pi, model: event.currentTarget.value },
                  })}
                />
                {!settingsDraft.pi.model.trim() ? (
                  <FieldDescription className="text-destructive">Pi 模型为必填项。</FieldDescription>
                ) : (
                  <FieldDescription>支持 Pi 的模型匹配格式，例如 `anthropic/claude-sonnet-4`。</FieldDescription>
                )}
              </Field>

              <Field className="lg:col-span-2" data-disabled={disabled}>
                <FieldLabel htmlFor="pi-api-key">{piEnvVar}</FieldLabel>
                <Input
                  id="pi-api-key"
                  value={piApiKey}
                  disabled={disabled || !knownPiProvider}
                  type="password"
                  placeholder={knownPiProvider ? `保存到 ~/.pi/agent/auth.json 的 ${piAuthKey}` : '自定义 provider 请使用自定义环境变量'}
                  onChange={(event) => {
                    piAuthDirtyRef.current = true;
                    setPiApiKey(event.currentTarget.value);
                  }}
                />
                <FieldDescription>
                  {piAuthStatus || `将写入 auth.json key: ${piAuthKey}`}
                </FieldDescription>
              </Field>

              <Field data-disabled={disabled}>
                <FieldLabel>思考等级</FieldLabel>
                <SettingDropdown
                  disabled={disabled}
                  value={selectedPiThinkingLevel?.label ?? settingsDraft.pi.thinkingLevel}
                >
                  <DropdownMenuRadioGroup
                    value={settingsDraft.pi.thinkingLevel}
                    onValueChange={(value) => onSettingsChange({
                      ...settingsDraft,
                      pi: { ...settingsDraft.pi, thinkingLevel: value as PiThinkingLevel },
                    })}
                  >
                    {PI_THINKING_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </SettingDropdown>
              </Field>

              <Field className="lg:col-span-2" data-disabled={disabled}>
                <FieldLabel htmlFor="pi-executable">Pi 可执行文件</FieldLabel>
                <Input
                  id="pi-executable"
                  value={settingsDraft.pi.pathToPiExecutable}
                  disabled={disabled}
                  placeholder="不填写会优先使用项目内 pi，再查找 PATH"
                  onChange={(event) => onSettingsChange({
                    ...settingsDraft,
                    pi: { ...settingsDraft.pi, pathToPiExecutable: event.currentTarget.value },
                  })}
                />
              </Field>

              <Field orientation="horizontal" data-disabled={disabled}>
                <Switch
                  id="pi-auto-compaction"
                  disabled={disabled}
                  checked={settingsDraft.pi.autoCompactionEnabled}
                  onCheckedChange={(checked) => onSettingsChange({
                    ...settingsDraft,
                    pi: { ...settingsDraft.pi, autoCompactionEnabled: checked },
                  })}
                />
                <FieldContent>
                  <FieldLabel htmlFor="pi-auto-compaction">自动上下文压缩</FieldLabel>
                  <FieldDescription>接近上下文上限时允许 Pi 自动 compact。</FieldDescription>
                </FieldContent>
              </Field>

              <Field orientation="horizontal" data-disabled={disabled}>
                <Switch
                  id="pi-auto-retry"
                  disabled={disabled}
                  checked={settingsDraft.pi.autoRetryEnabled}
                  onCheckedChange={(checked) => onSettingsChange({
                    ...settingsDraft,
                    pi: { ...settingsDraft.pi, autoRetryEnabled: checked },
                  })}
                />
                <FieldContent>
                  <FieldLabel htmlFor="pi-auto-retry">自动重试</FieldLabel>
                  <FieldDescription>遇到限流、过载或 5xx 时允许 Pi 自动 retry。</FieldDescription>
                </FieldContent>
              </Field>

              <Field className="lg:col-span-2" data-disabled={disabled}>
                <FieldLabel htmlFor="pi-extra-skills">额外 skill 路径</FieldLabel>
                <Textarea
                  id="pi-extra-skills"
                  value={settingsDraft.pi.extraSkillPaths}
                  disabled={disabled}
                  rows={4}
                  placeholder="每行一个 skill 文件或目录路径"
                  onChange={(event) => onSettingsChange({
                    ...settingsDraft,
                    pi: { ...settingsDraft.pi, extraSkillPaths: event.currentTarget.value },
                  })}
                />
              </Field>

              <Field className="lg:col-span-2" data-disabled={disabled}>
                <FieldLabel htmlFor="pi-custom-env">自定义环境变量</FieldLabel>
                <Textarea
                  id="pi-custom-env"
                  value={settingsDraft.pi.customEnvText}
                  disabled={disabled}
                  rows={7}
                  placeholder="KEY=value"
                  onChange={(event) => onSettingsChange({
                    ...settingsDraft,
                    pi: { ...settingsDraft.pi, customEnvText: event.currentTarget.value },
                  })}
                />
              </Field>
            </>
          ) : settingsDraft.providerId === 'claude' ? (
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

  const disabledSkills = settingsDraft.providerId === 'pi'
    ? settingsDraft.pi.disabledSkills
    : settingsDraft.providerId === 'codex'
      ? settingsDraft.codex.disabledSkills
      : settingsDraft.claude.disabledSkills;

  const toggleSkill = (name: string, enabled: boolean): void => {
    const next = enabled
      ? disabledSkills.filter((n) => n !== name)
      : [...new Set([...disabledSkills, name])];
    if (settingsDraft.providerId === 'pi') {
      onSettingsChange({
        ...settingsDraft,
        pi: { ...settingsDraft.pi, disabledSkills: next },
      });
    } else if (settingsDraft.providerId === 'codex') {
      onSettingsChange({
        ...settingsDraft,
        codex: { ...settingsDraft.codex, disabledSkills: next },
      });
    } else {
      onSettingsChange({
        ...settingsDraft,
        claude: { ...settingsDraft.claude, disabledSkills: next },
      });
    }
  };

  const workspaceSkills = skills.filter((s) => s.scope === 'workspace');
  const builtinSkills = skills.filter((s) => s.scope === 'builtin');
  const globalSkills = skills.filter((s) => s.scope === 'global');

  const renderSkillItem = (skill: SkillInfo): ReactNode => {
    const isEnabled = !disabledSkills.includes(skill.name);
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
          disabled={disabled}
          aria-label={`${isEnabled ? '禁用' : '启用'} ${skill.name}`}
          onCheckedChange={(checked) => toggleSkill(skill.name, checked)}
        />
      </div>
    );
  };

  const hasSkills = workspaceSkills.length > 0 || builtinSkills.length > 0 || globalSkills.length > 0;

  return (
    <FieldSet disabled={disabled}>
      <FieldLegend>技能</FieldLegend>
      <FieldGroup>
        {settingsDraft.providerId === 'codex' && (
          <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            Codex 会读取全局 Codex 配置中的技能；这里的开关会作为本应用会话的禁用提示发送给 Codex。
          </div>
        )}
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">加载中...</div>
        ) : !hasSkills ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            未发现已安装的技能
          </div>
        ) : (
          <>
            {workspaceSkills.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">项目内技能</div>
                {workspaceSkills.map(renderSkillItem)}
              </div>
            )}
            {builtinSkills.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">内置技能</div>
                {builtinSkills.map(renderSkillItem)}
              </div>
            )}
            {settingsDraft.providerId === 'codex' || settingsDraft.claude.useUserSettings ? (
              globalSkills.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="text-xs font-medium text-muted-foreground">全局技能</div>
                  {globalSkills.map(renderSkillItem)}
                </div>
              )
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
                未加载用户配置
              </div>
            )}
          </>
        )}
      </FieldGroup>
    </FieldSet>
  );
}

interface AutoTaskSettingsProps {
  readyWorkspace: ReadyPetWorkspace | null;
  tasks: AutoTask[];
  sessions: AiSessionSummary[];
  status: string;
  onSaveTask: (task: AutoTask) => void;
  onDeleteTask: (taskId: string) => void;
  onOpenConversation: (session: AiSessionSummary) => void;
}

function AutoTaskSettings({
  readyWorkspace,
  tasks,
  sessions,
  status,
  onSaveTask,
  onDeleteTask,
  onOpenConversation,
}: AutoTaskSettingsProps): ReactNode {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AutoTaskFilter>('all');
  const [editingTask, setEditingTask] = useState<AutoTask | null>(null);
  const [historyTask, setHistoryTask] = useState<AutoTask | null>(null);
  const disabled = !readyWorkspace;
  const filterLabel = AUTO_TASK_FILTER_OPTIONS.find((option) => option.value === filter)?.label ?? '全部项';
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTasks = tasks.filter((task) => {
    const queryMatched = !normalizedQuery
      || task.name.toLowerCase().includes(normalizedQuery)
      || task.prompt.toLowerCase().includes(normalizedQuery);
    return queryMatched && autoTaskFilterMatched(task, filter);
  });

  return (
    <div className="flex size-full min-h-0 flex-col gap-3 p-4">
      <div className="shrink-0 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-normal">自动任务</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              请保持电脑开机并运行客户端，否则在关机、休眠或退出客户端时，自动任务无法执行
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex h-8 w-44 items-center gap-1.5 rounded-lg border bg-background px-2">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                value={query}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                placeholder="搜索任务"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </div>
            <div className="w-28">
              <SettingDropdown disabled={disabled} value={filterLabel}>
                <DropdownMenuRadioGroup value={filter} onValueChange={(value) => setFilter(value as AutoTaskFilter)}>
                  {AUTO_TASK_FILTER_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </SettingDropdown>
            </div>
            <Button
              type="button"
              disabled={disabled}
              onClick={() => setEditingTask(createAutoTaskDraft())}
            >
              <CalendarClock data-icon="inline-start" />
              新建自动任务
            </Button>
          </div>
        </div>
        {status && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{status}</div>}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {disabled ? (
          <div className="rounded-lg border border-dashed bg-background px-3 py-10 text-center text-sm text-muted-foreground">
            请选择一个可用桌宠工作空间
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-background px-3 py-10 text-center text-sm text-muted-foreground">
            {tasks.length === 0 ? '还没有自动任务' : '无匹配任务'}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 pr-3">
            {filteredTasks.map((task) => (
              <AutoTaskCard
                key={task.id}
                task={task}
                sessions={autoTaskSessions(task, sessions)}
                onEdit={() => setEditingTask(task)}
                onDelete={() => onDeleteTask(task.id)}
                onToggle={(enabled) => onSaveTask({ ...task, enabled })}
                onOpenHistory={() => setHistoryTask(task)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <AutoTaskDialog
        task={editingTask}
        onOpenChange={(open) => {
          if (!open) setEditingTask(null);
        }}
        onSave={(task) => {
          onSaveTask(task);
          setEditingTask(null);
        }}
      />
      <AutoTaskHistoryDialog
        task={historyTask}
        sessions={historyTask ? autoTaskSessions(historyTask, sessions) : []}
        onOpenChange={(open) => {
          if (!open) setHistoryTask(null);
        }}
        onOpenConversation={(session) => {
          onOpenConversation(session);
          setHistoryTask(null);
        }}
      />
    </div>
  );
}

function AutoTaskCard({
  task,
  sessions,
  onEdit,
  onDelete,
  onToggle,
  onOpenHistory,
}: {
  task: AutoTask;
  sessions: AiSessionSummary[];
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onOpenHistory: () => void;
}): ReactNode {
  const statusInfo = autoTaskStatusInfo(task);

  return (
    <div className="flex min-h-[164px] flex-col rounded-lg border bg-background p-4 shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground">
            <CalendarClock className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{task.name || '未命名任务'}</div>
            <div className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{task.prompt || '未填写任务要求'}</div>
          </div>
        </div>
        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
      </div>

      <div className="mt-4 border-t pt-3">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{statusInfo.description}</span>
          <span className="shrink-0">{scheduleSummary(task.schedule)}</span>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={sessions.length === 0}
          onClick={onOpenHistory}
        >
          <History data-icon="inline-start" />
          历史 {sessions.length > 0 ? sessions.length : ''}
        </Button>
        <div className="flex items-center gap-2">
          <Switch
            checked={task.enabled}
            disabled={task.lastStatus === 'running'}
            aria-label={`${task.enabled ? '关闭' : '开启'} ${task.name || '自动任务'}`}
            onCheckedChange={onToggle}
          />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="更多操作" title="更多操作">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-28">
              <DropdownMenuItem disabled={task.lastStatus === 'running'} onClick={onEdit}>
                <Pencil data-icon="inline-start" />
                编辑
              </DropdownMenuItem>
              <DropdownMenuItem disabled={task.lastStatus === 'running'} variant="destructive" onClick={onDelete}>
                <Trash2 data-icon="inline-start" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function AutoTaskDialog({
  task,
  onOpenChange,
  onSave,
}: {
  task: AutoTask | null;
  onOpenChange: (open: boolean) => void;
  onSave: (task: AutoTask) => void;
}): ReactNode {
  const [draft, setDraft] = useState<AutoTask>(() => normalizeAutoTask(createAutoTaskDraft()));
  const open = task !== null;
  const scheduleKind = draft.schedule.kind;
  const nameLength = draft.name.length;
  const promptLength = draft.prompt.length;
  const canSubmit = draft.name.trim().length > 0 && draft.prompt.trim().length > 0;

  useEffect(() => {
    if (!task) return;
    setDraft(normalizeAutoTask(task));
  }, [task]);

  const updateSchedule = (schedule: AutoTaskSchedule): void => {
    setDraft((current) => ({
      ...current,
      schedule,
      nextRunAt: computeNextRunAt(schedule),
    }));
  };

  return (
    <Dialog modal={false} open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task?.name ? '编辑自动任务' : '新建自动任务'}</DialogTitle>
          <DialogDescription>任务会按设定时间自动发起一次 AI 对话。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="auto-task-name">名称</FieldLabel>
              <span className="text-xs text-muted-foreground">{nameLength}/{AUTO_TASK_NAME_MAX}</span>
            </div>
            <Input
              id="auto-task-name"
              value={draft.name}
              maxLength={AUTO_TASK_NAME_MAX}
              placeholder="请输入任务名称"
              onChange={(event) => setDraft((current) => ({ ...current, name: event.currentTarget.value }))}
            />
          </Field>

          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="auto-task-prompt">要求说明</FieldLabel>
              <span className="text-xs text-muted-foreground">{promptLength}/{AUTO_TASK_PROMPT_MAX}</span>
            </div>
            <Textarea
              id="auto-task-prompt"
              value={draft.prompt}
              maxLength={AUTO_TASK_PROMPT_MAX}
              rows={7}
              className="min-h-40 resize-none"
              placeholder="请输入任务要求说明"
              onChange={(event) => setDraft((current) => ({ ...current, prompt: event.currentTarget.value }))}
            />
          </Field>

          <Field>
            <FieldLabel>定时规则</FieldLabel>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr]">
              <SettingDropdown
                disabled={false}
                value={AUTO_TASK_SCHEDULE_OPTIONS.find((option) => option.value === scheduleKind)?.label ?? '每间隔'}
              >
                <DropdownMenuRadioGroup
                  value={scheduleKind}
                  onValueChange={(value) => {
                    const kind = value as AutoTaskScheduleKind;
                    if (kind === 'daily') updateSchedule({ kind, time: draft.schedule.time ?? '09:00' });
                    if (kind === 'weekly') updateSchedule({ kind, time: draft.schedule.time ?? '09:00', weekday: draft.schedule.weekday ?? 1 });
                    if (kind === 'interval') updateSchedule({
                      kind,
                      intervalValue: draft.schedule.intervalValue ?? 30,
                      intervalUnit: draft.schedule.intervalUnit ?? 'minutes',
                    });
                  }}
                >
                  {AUTO_TASK_SCHEDULE_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </SettingDropdown>

              {scheduleKind === 'daily' && (
                <Input
                  type="time"
                  value={draft.schedule.time ?? '09:00'}
                  onChange={(event) => updateSchedule({ ...draft.schedule, time: event.currentTarget.value })}
                />
              )}

              {scheduleKind === 'weekly' && (
                <div className="grid grid-cols-2 gap-2">
                  <SettingDropdown
                    disabled={false}
                    value={AUTO_TASK_WEEKDAY_OPTIONS.find((option) => option.value === (draft.schedule.weekday ?? 1))?.label ?? '周一'}
                  >
                    <DropdownMenuRadioGroup
                      value={String(draft.schedule.weekday ?? 1)}
                      onValueChange={(value) => updateSchedule({ ...draft.schedule, weekday: Number(value) })}
                    >
                      {AUTO_TASK_WEEKDAY_OPTIONS.map((option) => (
                        <DropdownMenuRadioItem key={option.value} value={String(option.value)}>
                          {option.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </SettingDropdown>
                  <Input
                    type="time"
                    value={draft.schedule.time ?? '09:00'}
                    onChange={(event) => updateSchedule({ ...draft.schedule, time: event.currentTarget.value })}
                  />
                </div>
              )}

              {scheduleKind === 'interval' && (
                <div className="grid grid-cols-[1fr_1fr] gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={999}
                    value={draft.schedule.intervalValue ?? 30}
                    onChange={(event) => updateSchedule({
                      ...draft.schedule,
                      intervalValue: Math.max(1, Number(event.currentTarget.value) || 1),
                    })}
                  />
                  <SettingDropdown
                    disabled={false}
                    value={intervalUnitLabel(draft.schedule.intervalUnit)}
                  >
                    <DropdownMenuRadioGroup
                      value={draft.schedule.intervalUnit ?? 'minutes'}
                      onValueChange={(value) => updateSchedule({
                        ...draft.schedule,
                        intervalUnit: value as AutoTaskIntervalUnit,
                      })}
                    >
                      {AUTO_TASK_INTERVAL_UNIT_OPTIONS.map((option) => (
                        <DropdownMenuRadioItem key={option.value} value={option.value}>
                          {option.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </SettingDropdown>
                </div>
              )}
            </div>
          </Field>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">取消</Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSave(prepareAutoTaskForSave(draft))}
          >
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AutoTaskHistoryDialog({
  task,
  sessions,
  onOpenChange,
  onOpenConversation,
}: {
  task: AutoTask | null;
  sessions: AiSessionSummary[];
  onOpenChange: (open: boolean) => void;
  onOpenConversation: (session: AiSessionSummary) => void;
}): ReactNode {
  return (
    <Dialog modal={false} open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>任务历史</DialogTitle>
          <DialogDescription>{task?.name ? autoTaskConversationTitle(task.name) : '自动任务对话记录'}</DialogDescription>
        </DialogHeader>
        {sessions.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
            暂无关联对话
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="flex flex-col gap-1 pr-2">
              {sessions.map((session) => (
                <Button
                  key={session.id}
                  type="button"
                  variant="ghost"
                  className="h-auto justify-start px-2 py-2 text-left"
                  onClick={() => onOpenConversation(session)}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{session.title || '历史对话'}</span>
                    <span className="text-xs text-muted-foreground">{formatAutoTaskTime(session.updatedAt)}</span>
                  </span>
                </Button>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
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

function prepareAutoTaskForSave(task: AutoTask): AutoTask {
  const normalized = normalizeAutoTask(task);
  const now = Date.now();
  return {
    ...normalized,
    name: normalized.name.trim(),
    prompt: normalized.prompt.trim(),
    enabled: normalized.enabled,
    updatedAt: now,
    nextRunAt: normalized.enabled ? computeNextRunAt(normalized.schedule, now) : normalized.nextRunAt,
    lastStatus: normalized.enabled && normalized.lastStatus === 'expired' ? 'idle' : normalized.lastStatus,
  };
}

function upsertAutoTask(tasks: AutoTask[], task: AutoTask): AutoTask[] {
  const normalized = normalizeAutoTask(task);
  const index = tasks.findIndex((item) => item.id === normalized.id);
  const next = index >= 0
    ? tasks.map((item, itemIndex) => (itemIndex === index ? normalized : item))
    : [normalized, ...tasks];
  return next.sort((a, b) => b.updatedAt - a.updatedAt);
}

function autoTaskSessions(task: AutoTask, sessions: AiSessionSummary[]): AiSessionSummary[] {
  const title = autoTaskConversationTitle(task.name);
  return sessions.filter((session) => (
    session.autoTaskId === task.id
    || session.title === title
    || session.id === task.currentConversationId
  ));
}

function autoTaskFilterMatched(task: AutoTask, filter: AutoTaskFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'paused') return !task.enabled;
  if (filter === 'enabled') return task.enabled && task.lastStatus !== 'running';
  if (filter === 'running') return task.lastStatus === 'running';
  return task.lastStatus === 'expired';
}

function autoTaskStatusInfo(task: AutoTask): {
  label: string;
  description: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  if (!task.enabled) {
    return {
      label: '已暂停',
      description: '任务已关闭',
      variant: 'outline',
    };
  }

  if (task.lastStatus === 'running') {
    return {
      label: '进行中',
      description: `开始于 ${formatAutoTaskTime(task.lastRunAt) || '刚刚'}`,
      variant: 'default',
    };
  }

  if (task.lastStatus === 'failed') {
    return {
      label: '执行失败',
      description: task.lastError || `失败于 ${formatAutoTaskTime(task.lastStatusAt)}`,
      variant: 'destructive',
    };
  }

  if (task.lastStatus === 'expired') {
    return {
      label: '已过期',
      description: task.lastError || `错过于 ${formatAutoTaskTime(task.lastStatusAt)}`,
      variant: 'outline',
    };
  }

  if (task.lastStatus === 'success') {
    return {
      label: '已开启',
      description: `上次执行 ${formatAutoTaskTime(task.lastRunAt)}，下次 ${formatAutoTaskTime(task.nextRunAt)}`,
      variant: 'secondary',
    };
  }

  return {
    label: '已开启',
    description: task.nextRunAt ? `下次 ${formatAutoTaskTime(task.nextRunAt)}` : '等待下一次调度',
    variant: 'secondary',
  };
}

function defaultAiSettings(): AiSettings {
  return {
    providerId: 'pi',
    petAlwaysOnTop: false,
    petGravityEnabled: true,
    petScale: 1,
    petResizeEnabled: false,
    petPersona: DEFAULT_PET_PERSONA,
    displayName: '',
    pi: {
      pathToPiExecutable: '',
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
    claude: {
      pathToClaudeCodeExecutable: '',
      permissionMode: 'default',
      thinkingIntensity: 'medium',
      useUserSettings: false,
      customEnvText: '',
      disabledSkills: [],
    },
    codex: {
      pathToCodexExecutable: '',
      model: '',
      approvalPolicy: 'on-request',
      reasoningEffort: 'medium',
      customEnvText: '',
      disabledSkills: [],
    },
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
    pi: {
      ...defaults.pi,
      ...settings?.pi,
      provider: settings?.pi?.provider || defaults.pi.provider,
      disabledSkills: settings?.pi?.disabledSkills ?? [],
    },
    claude: {
      ...defaults.claude,
      ...settings?.claude,
      disabledSkills: settings?.claude?.disabledSkills ?? [],
    },
    codex: {
      ...defaults.codex,
      ...settings?.codex,
      disabledSkills: settings?.codex?.disabledSkills ?? [],
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

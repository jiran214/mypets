import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { hasTauriRuntime } from '@/lib/tauri-utils';
import type {
  CountdownListResponse,
  PomodoroStatusResponse,
  TodoListResponse,
  TodoStatusFilter,
  ToolCommand,
  ToolCommandEvent,
} from './tools-types';

const TOOL_REQUEST_TIMEOUT_MS = 15_000;

export async function sendToolsCommand<T>(
  workspaceFolder: string,
  command: ToolCommand,
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (!workspaceFolder) {
    throw new Error('请先选择桌宠工作空间');
  }
  if (!hasTauriRuntime()) {
    throw new Error('小工具需要在桌面端运行');
  }

  const requestId = crypto.randomUUID();
  let unlisten: UnlistenFn | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const cleanup = (): void => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    unlisten?.();
    unlisten = undefined;
  };

  try {
    let resolveResult: (value: T) => void = () => {};
    let rejectResult: (reason?: unknown) => void = () => {};
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    unlisten = await listen<ToolCommandEvent>('tools-event', (event) => {
      const payload = event.payload;
      if (payload.requestId !== requestId) return;

      cleanup();
      if (payload.type === 'done') {
        resolveResult(payload.data as T);
        return;
      }
      rejectResult(new Error(payload.error || '小工具执行失败'));
    });
    timeout = setTimeout(() => {
      cleanup();
      rejectResult(new Error('小工具响应超时'));
    }, TOOL_REQUEST_TIMEOUT_MS);
    await invoke<string>('send_tools_command', {
      workspaceFolder,
      requestId,
      command,
      action,
      params,
    });
    return await result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

export const Tools = {
  todolist: {
    list: (workspaceFolder: string, status: TodoStatusFilter = 'all') => (
      sendToolsCommand<TodoListResponse>(workspaceFolder, 'todolist', 'list', { status })
    ),
    add: (workspaceFolder: string, text: string, dueDate?: string) => (
      sendToolsCommand(workspaceFolder, 'todolist', 'add', { text, dueDate })
    ),
    complete: (workspaceFolder: string, id: string) => (
      sendToolsCommand(workspaceFolder, 'todolist', 'complete', { id })
    ),
    uncomplete: (workspaceFolder: string, id: string) => (
      sendToolsCommand(workspaceFolder, 'todolist', 'uncomplete', { id })
    ),
    delete: (workspaceFolder: string, id: string) => (
      sendToolsCommand(workspaceFolder, 'todolist', 'delete', { id })
    ),
    update: (workspaceFolder: string, id: string, params: { text?: string; dueDate?: string | null }) => (
      sendToolsCommand(workspaceFolder, 'todolist', 'update', { id, ...params })
    ),
  },
  pomodoro: {
    start: (workspaceFolder: string, duration: number, label?: string) => (
      sendToolsCommand<PomodoroStatusResponse>(workspaceFolder, 'pomodoro', 'start', { duration, label })
    ),
    pause: (workspaceFolder: string) => (
      sendToolsCommand<PomodoroStatusResponse>(workspaceFolder, 'pomodoro', 'pause')
    ),
    resume: (workspaceFolder: string) => (
      sendToolsCommand<PomodoroStatusResponse>(workspaceFolder, 'pomodoro', 'resume')
    ),
    stop: (workspaceFolder: string) => (
      sendToolsCommand<PomodoroStatusResponse>(workspaceFolder, 'pomodoro', 'stop')
    ),
    status: (workspaceFolder: string) => (
      sendToolsCommand<PomodoroStatusResponse>(workspaceFolder, 'pomodoro', 'status')
    ),
    history: (workspaceFolder: string) => (
      sendToolsCommand(workspaceFolder, 'pomodoro', 'history')
    ),
  },
  countdown: {
    list: (workspaceFolder: string) => (
      sendToolsCommand<CountdownListResponse>(workspaceFolder, 'countdown', 'list')
    ),
    add: (workspaceFolder: string, name: string, date: string, repeat?: 'yearly') => (
      sendToolsCommand(workspaceFolder, 'countdown', 'add', { name, date, repeat })
    ),
    update: (workspaceFolder: string, id: string, params: { name?: string; date?: string; repeat?: 'yearly' | null }) => (
      sendToolsCommand(workspaceFolder, 'countdown', 'update', { id, ...params })
    ),
    delete: (workspaceFolder: string, id: string) => (
      sendToolsCommand(workspaceFolder, 'countdown', 'delete', { id })
    ),
  },
};

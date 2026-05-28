import { invoke } from '@tauri-apps/api/core';
import { hasTauriRuntime } from '@/lib/tauri-utils';
import type {
  CountdownListResponse,
  PomodoroStatusResponse,
  TodoListResponse,
  TodoStatusFilter,
  ToolCommand,
} from './tools-types';

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
  return invoke<T>('send_tools_command', {
    workspaceFolder,
    command,
    action,
    params,
  });
}

export const Tools = {
  todolist: {
    list: (workspaceFolder: string, status: TodoStatusFilter = 'all') =>
      sendToolsCommand<TodoListResponse>(workspaceFolder, 'todolist', 'list', { status }),
    add: (workspaceFolder: string, text: string, dueDate?: string) =>
      sendToolsCommand(workspaceFolder, 'todolist', 'add', { text, dueDate }),
    complete: (workspaceFolder: string, id: string) =>
      sendToolsCommand(workspaceFolder, 'todolist', 'complete', { id }),
    uncomplete: (workspaceFolder: string, id: string) =>
      sendToolsCommand(workspaceFolder, 'todolist', 'uncomplete', { id }),
    delete: (workspaceFolder: string, id: string) =>
      sendToolsCommand(workspaceFolder, 'todolist', 'delete', { id }),
    update: (workspaceFolder: string, id: string, params: { text?: string; dueDate?: string | null }) =>
      sendToolsCommand(workspaceFolder, 'todolist', 'update', { id, ...params }),
  },
  pomodoro: {
    start: (workspaceFolder: string, duration: number, label?: string) =>
      sendToolsCommand<PomodoroStatusResponse>(workspaceFolder, 'pomodoro', 'start', { duration, label }),
    pause: (workspaceFolder: string) =>
      sendToolsCommand<PomodoroStatusResponse>(workspaceFolder, 'pomodoro', 'pause'),
    resume: (workspaceFolder: string) =>
      sendToolsCommand<PomodoroStatusResponse>(workspaceFolder, 'pomodoro', 'resume'),
    stop: (workspaceFolder: string) =>
      sendToolsCommand<PomodoroStatusResponse>(workspaceFolder, 'pomodoro', 'stop'),
    status: (workspaceFolder: string) =>
      sendToolsCommand<PomodoroStatusResponse>(workspaceFolder, 'pomodoro', 'status'),
    history: (workspaceFolder: string) =>
      sendToolsCommand(workspaceFolder, 'pomodoro', 'history'),
  },
  countdown: {
    list: (workspaceFolder: string) =>
      sendToolsCommand<CountdownListResponse>(workspaceFolder, 'countdown', 'list'),
    add: (workspaceFolder: string, name: string, date: string, repeat?: 'yearly') =>
      sendToolsCommand(workspaceFolder, 'countdown', 'add', { name, date, repeat }),
    update: (workspaceFolder: string, id: string, params: { name?: string; date?: string; repeat?: 'yearly' | null }) =>
      sendToolsCommand(workspaceFolder, 'countdown', 'update', { id, ...params }),
    delete: (workspaceFolder: string, id: string) =>
      sendToolsCommand(workspaceFolder, 'countdown', 'delete', { id }),
  },
};

import { invoke } from '@tauri-apps/api/core';
import {
  answerAiToolQuestion,
  cancelAiChatMessage,
  listenToAiChatEvents,
  sendAiChatMessage,
} from './ai-api';
import {
  appendPart,
  persistConversation,
} from '@/lib/ai-utils';
import type {
  AiChatEvent,
  ChatMessage,
  Conversation,
  PiSessionState,
  ToolQuestionAnswerPayload,
  ToolQuestionPartData,
  ToolQuestionRequest,
} from './ai-types';

export type AutoTaskScheduleKind = 'daily' | 'weekly' | 'interval';
export type AutoTaskIntervalUnit = 'minutes' | 'hours' | 'days';
export type AutoTaskRunStatus = 'idle' | 'running' | 'success' | 'failed' | 'expired';

export interface AutoTaskSchedule {
  kind: AutoTaskScheduleKind;
  time?: string;
  weekday?: number;
  intervalValue?: number;
  intervalUnit?: AutoTaskIntervalUnit;
}

export interface AutoTask {
  id: string;
  name: string;
  prompt: string;
  schedule: AutoTaskSchedule;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  nextRunAt?: number;
  lastRunAt?: number;
  lastStatusAt?: number;
  lastStatus: AutoTaskRunStatus;
  lastError?: string;
  runCount: number;
  currentConversationId?: string;
}

export interface AutoTaskRunResult {
  conversationId: string;
  status: 'success' | 'failed';
  error?: string;
}

export const AUTO_TASK_NAME_MAX = 50;
export const AUTO_TASK_PROMPT_MAX = 5000;
export const AUTO_TASK_MISSED_GRACE_MS = 5 * 60 * 1000;

const DEFAULT_TIME = '09:00';
const DEFAULT_WEEKDAY = 1;
const DEFAULT_INTERVAL_VALUE = 30;
const DEFAULT_INTERVAL_UNIT: AutoTaskIntervalUnit = 'minutes';

export function listAutoTasks(workspaceFolder: string): Promise<AutoTask[]> {
  return invoke<AutoTask[]>('list_auto_tasks', { workspaceFolder })
    .then((tasks) => tasks.map(normalizeAutoTask));
}

export function saveAutoTask(workspaceFolder: string, task: AutoTask): Promise<AutoTask> {
  return invoke<AutoTask>('save_auto_task', {
    workspaceFolder,
    task: normalizeAutoTask(task),
  }).then(normalizeAutoTask);
}

export function deleteAutoTask(workspaceFolder: string, taskId: string): Promise<void> {
  return invoke<void>('delete_auto_task', { workspaceFolder, taskId });
}

export function createAutoTaskDraft(): AutoTask {
  const now = Date.now();
  const schedule: AutoTaskSchedule = {
    kind: 'interval',
    intervalValue: DEFAULT_INTERVAL_VALUE,
    intervalUnit: DEFAULT_INTERVAL_UNIT,
  };

  return {
    id: crypto.randomUUID(),
    name: '',
    prompt: '',
    schedule,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    nextRunAt: computeNextRunAt(schedule, now),
    lastStatus: 'idle',
    runCount: 0,
  };
}

export function normalizeAutoTask(task: Partial<AutoTask>): AutoTask {
  const now = Date.now();
  const createdAt = validTime(task.createdAt) ?? now;
  const schedule = normalizeSchedule(task.schedule);

  return {
    id: typeof task.id === 'string' && task.id.trim() ? task.id.trim() : crypto.randomUUID(),
    name: truncateText(typeof task.name === 'string' ? task.name.trim() : '', AUTO_TASK_NAME_MAX),
    prompt: truncateText(typeof task.prompt === 'string' ? task.prompt : '', AUTO_TASK_PROMPT_MAX),
    schedule,
    enabled: Boolean(task.enabled),
    createdAt,
    updatedAt: validTime(task.updatedAt) ?? createdAt,
    nextRunAt: validTime(task.nextRunAt),
    lastRunAt: validTime(task.lastRunAt),
    lastStatusAt: validTime(task.lastStatusAt),
    lastStatus: normalizeRunStatus(task.lastStatus),
    lastError: typeof task.lastError === 'string' && task.lastError ? task.lastError : undefined,
    runCount: Number.isFinite(task.runCount) ? Math.max(0, Math.floor(task.runCount ?? 0)) : 0,
    currentConversationId: typeof task.currentConversationId === 'string' && task.currentConversationId
      ? task.currentConversationId
      : undefined,
  };
}

export function computeNextRunAt(schedule: AutoTaskSchedule, afterMs = Date.now()): number {
  const normalized = normalizeSchedule(schedule);
  const after = new Date(afterMs);

  if (normalized.kind === 'interval') {
    return afterMs + intervalUnitMs(normalized.intervalUnit) * Math.max(1, normalized.intervalValue ?? DEFAULT_INTERVAL_VALUE);
  }

  if (normalized.kind === 'weekly') {
    const weekday = normalized.weekday ?? DEFAULT_WEEKDAY;
    const currentWeekday = jsDayToWeekday(after.getDay());
    let days = (weekday - currentWeekday + 7) % 7;
    let candidate = dateAtTime(addDays(after, days), normalized.time ?? DEFAULT_TIME);
    if (candidate.getTime() <= afterMs) {
      days += 7;
      candidate = dateAtTime(addDays(after, days), normalized.time ?? DEFAULT_TIME);
    }
    return candidate.getTime();
  }

  let candidate = dateAtTime(after, normalized.time ?? DEFAULT_TIME);
  if (candidate.getTime() <= afterMs) {
    candidate = dateAtTime(addDays(after, 1), normalized.time ?? DEFAULT_TIME);
  }
  return candidate.getTime();
}

export function scheduleSummary(schedule: AutoTaskSchedule): string {
  const normalized = normalizeSchedule(schedule);
  if (normalized.kind === 'daily') return `每天 ${normalized.time ?? DEFAULT_TIME}`;
  if (normalized.kind === 'weekly') return `每周${weekdayLabel(normalized.weekday ?? DEFAULT_WEEKDAY)} ${normalized.time ?? DEFAULT_TIME}`;
  return `每 ${normalized.intervalValue ?? DEFAULT_INTERVAL_VALUE} ${intervalUnitLabel(normalized.intervalUnit)}`;
}

export function weekdayLabel(weekday: number): string {
  return ['一', '二', '三', '四', '五', '六', '日'][Math.min(6, Math.max(0, weekday - 1))] ?? '一';
}

export function intervalUnitLabel(unit?: AutoTaskIntervalUnit): string {
  if (unit === 'hours') return '小时';
  if (unit === 'days') return '天';
  return '分钟';
}

export function formatAutoTaskTime(value?: number): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export async function runAutoTaskConversation(
  workspaceFolder: string,
  task: AutoTask,
): Promise<AutoTaskRunResult> {
  const title = autoTaskConversationTitle(task.name);
  const requestId = crypto.randomUUID();
  const conversationId = `auto-task-${safeIdPart(task.id)}-${Date.now()}`;
  const providerState: PiSessionState = {};
  const assistant: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    parts: [],
    pending: true,
  };
  const conversation: Conversation = {
    id: conversationId,
    providerState,
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{
          id: crypto.randomUUID(),
          kind: 'text',
          text: task.prompt,
        }],
      },
      assistant,
    ],
  };
  let completed = false;

  const saveConversation = (): void => {
    persistConversation(workspaceFolder, title, conversation);
  };

  const finish = (status: 'success' | 'failed', error?: string): AutoTaskRunResult => {
    completed = true;
    assistant.pending = false;
    if (status === 'failed') {
      assistant.error = true;
      assistant.parts.push({
        id: crypto.randomUUID(),
        kind: 'status',
        text: error || '自动任务执行失败。',
      });
    } else if (!assistant.parts.some((part) => part.text.trim())) {
      assistant.parts.push({
        id: crypto.randomUUID(),
        kind: 'status',
        text: '任务执行完成，但没有返回文本内容。',
      });
    }
    saveConversation();
    return { conversationId, status, error };
  };

  saveConversation();

  let resolveRun: (result: AutoTaskRunResult) => void = () => {};
  const runPromise = new Promise<AutoTaskRunResult>((resolve) => {
    resolveRun = resolve;
  });

  const unlisten = await listenToAiChatEvents((event) => {
    if (event.requestId !== requestId || completed) return;

    if (event.type === 'status') {
      return;
    }

    if (event.type === 'session') {
      conversation.providerState = {
        ...conversation.providerState,
        ...event.providerState,
      };
      saveConversation();
      return;
    }

    if (event.type === 'delta') {
      appendPart(assistant, { kind: 'text', text: event.text });
      saveConversation();
      return;
    }

    if (event.type === 'part') {
      appendPart(assistant, event.part);
      saveConversation();
      return;
    }

    if (event.type === 'question') {
      handleAutomaticQuestion(event, assistant, saveConversation);
      return;
    }

    if (event.type === 'done') {
      if (event.providerState) {
        conversation.providerState = {
          ...conversation.providerState,
          ...event.providerState,
        };
      }
      resolveRun(finish('success'));
      return;
    }

    if (event.type === 'cancelled') {
      resolveRun(finish('failed', '自动任务已取消。'));
      return;
    }

    resolveRun(finish('failed', event.error));
  });

  const AUTO_TASK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  try {
    await sendAiChatMessage({
      requestId,
      conversationId,
      workspaceFolder,
      title,
      autoTaskId: task.id,
      autoTaskName: task.name,
      prompt: task.prompt,
      providerState,
    });
    const timeoutPromise = new Promise<AutoTaskRunResult>((resolve) => {
      setTimeout(() => {
        if (!completed) {
          cancelAiChatMessage(requestId).catch(() => {});
          resolve(finish('failed', '自动任务执行超时。'));
        }
      }, AUTO_TASK_TIMEOUT_MS);
    });
    return await Promise.race([runPromise, timeoutPromise]);
  } catch (error) {
    return finish('failed', error instanceof Error ? error.message : String(error));
  } finally {
    unlisten();
  }
}

export function autoTaskConversationTitle(name: string): string {
  return `自动任务-${name.trim() || '未命名任务'}`;
}

function handleAutomaticQuestion(
  event: Extract<AiChatEvent, { type: 'question' }>,
  assistant: ChatMessage,
  saveConversation: () => void,
): void {
  const response = automaticQuestionResponse(event.question);
  const questionData: ToolQuestionPartData = {
    ...event.question,
    status: 'answered',
    response,
  };
  appendPart(assistant, {
    kind: 'question',
    title: event.question.title || '自动任务需要确认',
    text: JSON.stringify(questionData),
    questionData,
  });
  appendPart(assistant, {
    kind: 'status',
    title: '自动任务',
    text: '任务运行时遇到需要人工输入的问题，已自动选择保守答复。',
  });
  saveConversation();

  void answerAiToolQuestion({
    requestId: event.requestId,
    questionId: event.question.id,
    response,
  }).catch((error) => {
    appendPart(assistant, {
      kind: 'status',
      title: '自动任务',
      text: error instanceof Error ? error.message : String(error),
    });
    saveConversation();
  });
}

function automaticQuestionResponse(question: ToolQuestionRequest): ToolQuestionAnswerPayload {
  const answers: Record<string, string[]> = {};

  for (const item of question.questions) {
    const label = question.kind === 'permission'
      ? item.options.find((option) => option.label.includes('拒绝'))?.label
      : item.options.find((option) => option.label.includes('取消') || option.label.includes('拒绝'))?.label;
    answers[item.question] = [label ?? item.options[1]?.label ?? item.options[0]?.label ?? '取消'];
  }

  return { answers };
}


function normalizeSchedule(schedule?: Partial<AutoTaskSchedule>): AutoTaskSchedule {
  const kind = schedule?.kind === 'daily' || schedule?.kind === 'weekly' || schedule?.kind === 'interval'
    ? schedule.kind
    : 'interval';

  if (kind === 'daily') {
    return {
      kind,
      time: normalizeTime(schedule?.time),
    };
  }

  if (kind === 'weekly') {
    return {
      kind,
      time: normalizeTime(schedule?.time),
      weekday: normalizeWeekday(schedule?.weekday),
    };
  }

  return {
    kind,
    intervalValue: normalizeIntervalValue(schedule?.intervalValue),
    intervalUnit: normalizeIntervalUnit(schedule?.intervalUnit),
  };
}

function normalizeRunStatus(status: unknown): AutoTaskRunStatus {
  if (status === 'running' || status === 'success' || status === 'failed' || status === 'expired') {
    return status;
  }
  return 'idle';
}

function normalizeTime(time: unknown): string {
  if (typeof time !== 'string') return DEFAULT_TIME;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return DEFAULT_TIME;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return DEFAULT_TIME;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function normalizeWeekday(weekday: unknown): number {
  const value = typeof weekday === 'number' ? weekday : DEFAULT_WEEKDAY;
  return Math.min(7, Math.max(1, Math.floor(value)));
}

function normalizeIntervalValue(value: unknown): number {
  const numeric = typeof value === 'number' ? value : DEFAULT_INTERVAL_VALUE;
  return Math.min(999, Math.max(1, Math.floor(numeric)));
}

function normalizeIntervalUnit(unit: unknown): AutoTaskIntervalUnit {
  if (unit === 'hours' || unit === 'days') return unit;
  return 'minutes';
}

function validTime(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function truncateText(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function intervalUnitMs(unit?: AutoTaskIntervalUnit): number {
  if (unit === 'hours') return 60 * 60 * 1000;
  if (unit === 'days') return 24 * 60 * 60 * 1000;
  return 60 * 1000;
}

function jsDayToWeekday(value: number): number {
  return value === 0 ? 7 : value;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateAtTime(date: Date, time: string): Date {
  const [hourText, minuteText] = normalizeTime(time).split(':');
  const next = new Date(date);
  next.setHours(Number(hourText), Number(minuteText), 0, 0);
  return next;
}

function safeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_') || 'task';
}

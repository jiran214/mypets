import {
  AUTO_TASK_MISSED_GRACE_MS,
  computeNextRunAt,
  runAutoTaskConversation,
  saveAutoTask,
  type AutoTask,
  type AutoTaskRunStatus,
} from './auto-tasks';
import type { ChatRuntime } from './chat-runtime';

export interface AutoTaskSchedulerOptions {
  workspaceFolder: string;
  runtime: ChatRuntime;
  getTasks: () => AutoTask[];
  onTaskUpdate: (updater: (tasks: AutoTask[]) => AutoTask[]) => void;
  onStatusChange: (status: string) => void;
}

export class AutoTaskScheduler {
  private disposed = false;
  private timer: number | null = null;
  private runningIds = new Set<string>();
  private options: AutoTaskSchedulerOptions;

  constructor(options: AutoTaskSchedulerOptions) {
    this.options = options;
  }

  start(): void {
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 15_000);
  }

  stop(): void {
    this.disposed = true;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (this.disposed) return;
    const now = Date.now();
    for (const task of this.options.getTasks()) {
      if (!task.id || !task.enabled) continue;
      if (this.runningIds.has(task.id)) continue;

      if (task.lastStatus === 'running') {
        void this.markExpired(task, now, '上次执行被中断。');
        continue;
      }

      const nextRunAt = task.nextRunAt ?? computeNextRunAt(task.schedule, now);
      if (!task.nextRunAt) {
        void this.persistTask({ ...task, nextRunAt, updatedAt: now });
        continue;
      }
      if (nextRunAt > now) continue;

      if (now - nextRunAt > AUTO_TASK_MISSED_GRACE_MS) {
        void this.markExpired(task, now, '客户端未运行或系统休眠，已错过本次执行。');
        continue;
      }

      void this.runDueTask(task);
    }
  }

  private async markExpired(task: AutoTask, now: number, message: string): Promise<void> {
    await this.persistTask({
      ...task,
      lastStatus: 'expired',
      lastStatusAt: now,
      lastError: message,
      nextRunAt: computeNextRunAt(task.schedule, now),
      updatedAt: now,
    });
  }

  private async runDueTask(task: AutoTask): Promise<void> {
    this.runningIds.add(task.id);
    const startedAt = Date.now();
    const runningTask: AutoTask = {
      ...task,
      lastRunAt: startedAt,
      lastStatusAt: startedAt,
      lastStatus: 'running' as AutoTaskRunStatus,
      lastError: '',
      currentConversationId: '',
      updatedAt: startedAt,
    };
    const savedRunningTask = await this.persistTask(runningTask);
    if (!savedRunningTask) {
      this.runningIds.delete(task.id);
      return;
    }

    try {
      const result = await runAutoTaskConversation(this.options.workspaceFolder, savedRunningTask);
      const finishedAt = Date.now();
      await this.persistTask({
        ...savedRunningTask,
        lastStatus: result.status === 'success' ? 'success' : 'failed',
        lastError: result.error ?? '',
        lastStatusAt: finishedAt,
        nextRunAt: computeNextRunAt(savedRunningTask.schedule, finishedAt),
        currentConversationId: result.conversationId,
        runCount: savedRunningTask.runCount + 1,
        updatedAt: finishedAt,
      });
      if (!this.disposed) {
        void this.options.runtime.refreshSessions();
      }
    } catch (error) {
      const failedAt = Date.now();
      await this.persistTask({
        ...savedRunningTask,
        lastStatus: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
        lastStatusAt: failedAt,
        nextRunAt: computeNextRunAt(savedRunningTask.schedule, failedAt),
        runCount: savedRunningTask.runCount + 1,
        updatedAt: failedAt,
      });
    } finally {
      this.runningIds.delete(task.id);
    }
  }

  private async persistTask(task: AutoTask): Promise<AutoTask | null> {
    try {
      const saved = await saveAutoTask(this.options.workspaceFolder, task);
      if (!this.disposed) {
        this.options.onTaskUpdate((current) => upsertAutoTask(current, saved));
      }
      return saved;
    } catch (error) {
      if (!this.disposed) {
        this.options.onStatusChange(error instanceof Error ? error.message : String(error));
      }
      return null;
    }
  }
}

export function upsertAutoTask(tasks: AutoTask[], task: AutoTask): AutoTask[] {
  const index = tasks.findIndex((item) => item.id === task.id);
  const next = index >= 0
    ? tasks.map((item, itemIndex) => (itemIndex === index ? task : item))
    : [task, ...tasks];
  return next.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function prepareAutoTaskForSave(task: AutoTask): AutoTask {
  const now = Date.now();
  return {
    ...task,
    name: task.name.trim(),
    prompt: task.prompt.trim(),
    enabled: task.enabled,
    updatedAt: now,
    nextRunAt: task.enabled ? computeNextRunAt(task.schedule, now) : task.nextRunAt,
    lastStatus: task.enabled && task.lastStatus === 'expired' ? 'idle' : task.lastStatus,
  };
}

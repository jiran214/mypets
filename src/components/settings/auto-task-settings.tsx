import { useEffect, useState, type ReactNode } from 'react';
import { CalendarClock, History, MoreHorizontal, Pencil, Search, Trash2 } from 'lucide-react';
import type { AiSessionSummary } from '@/ai-types';
import type { ReadyPetWorkspace } from '@/workspaces';
import type {
  AutoTask,
  AutoTaskIntervalUnit,
  AutoTaskSchedule,
  AutoTaskScheduleKind,
} from '@/auto-tasks';
import {
  AUTO_TASK_NAME_MAX,
  AUTO_TASK_PROMPT_MAX,
  autoTaskConversationTitle,
  computeNextRunAt,
  createAutoTaskDraft,
  formatAutoTaskTime,
  intervalUnitLabel,
  normalizeAutoTask,
  scheduleSummary,
  weekdayLabel,
} from '@/auto-tasks';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Field,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { SettingDropdown } from './setting-dropdown';

type AutoTaskFilter = 'all' | 'running' | 'enabled' | 'paused' | 'expired';

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

export interface AutoTaskSettingsProps {
  readyWorkspace: ReadyPetWorkspace | null;
  tasks: AutoTask[];
  sessions: AiSessionSummary[];
  status: string;
  onSaveTask: (task: AutoTask) => void;
  onDeleteTask: (taskId: string) => void;
  onOpenConversation: (session: AiSessionSummary) => void;
}

export function AutoTaskSettings({
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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, Check, Circle, Plus, Trash2 } from 'lucide-react';
import { Tools } from '@/ai/tools-api';
import type { TodoItem, TodoStatusFilter } from '@/ai/tools-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface TodolistPanelProps {
  workspaceFolder: string;
  compact?: boolean;
}

const FILTERS: { value: TodoStatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '未完成' },
  { value: 'done', label: '已完成' },
];

export function TodolistPanel({ workspaceFolder, compact = false }: TodolistPanelProps): ReactNode {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [filter, setFilter] = useState<TodoStatusFilter>('all');
  const [text, setText] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [status, setStatus] = useState('');
  const disabled = !workspaceFolder;

  const loadTodos = useCallback(async (): Promise<void> => {
    if (!workspaceFolder) {
      setTodos([]);
      return;
    }

    setLoading(true);
    try {
      const response = await Tools.todolist.list(workspaceFolder, filter);
      setTodos(response.todos);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [filter, workspaceFolder]);

  useEffect(() => {
    void loadTodos();
  }, [loadTodos]);

  const pendingCount = useMemo(() => todos.filter((todo) => !todo.completed).length, [todos]);

  const addTodo = async (): Promise<void> => {
    const value = text.trim();
    if (!value || disabled) return;

    setLoading(true);
    try {
      await Tools.todolist.add(workspaceFolder, value, dueDate || undefined);
      setText('');
      setDueDate('');
      await loadTodos();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const toggleTodo = async (todo: TodoItem): Promise<void> => {
    if (disabled) return;

    setBusyId(todo.id);
    try {
      if (todo.completed) {
        await Tools.todolist.uncomplete(workspaceFolder, todo.id);
      } else {
        await Tools.todolist.complete(workspaceFolder, todo.id);
      }
      await loadTodos();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId('');
    }
  };

  const deleteTodo = async (id: string): Promise<void> => {
    if (disabled) return;

    setBusyId(id);
    try {
      await Tools.todolist.delete(workspaceFolder, id);
      await loadTodos();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className={cn('flex size-full min-h-0 flex-col gap-3 p-4', compact && 'gap-2 p-3')}>
      <div className="shrink-0 space-y-2">
        <div className={cn('flex gap-2', compact && 'flex-col')}>
          <Input
            value={text}
            disabled={disabled || loading}
            placeholder={disabled ? '先选择桌宠' : '添加新任务...'}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void addTodo();
              }
            }}
          />
          <div className="flex shrink-0 gap-2">
            <Input
              type="date"
              value={dueDate}
              disabled={disabled || loading}
              className={cn('w-36', compact && 'min-w-0 flex-1')}
              aria-label="截止日期"
              onChange={(event) => setDueDate(event.currentTarget.value)}
            />
            <Button
              type="button"
              disabled={disabled || loading || !text.trim()}
              onClick={() => void addTodo()}
            >
              <Plus data-icon="inline-start" />
              添加
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex rounded-lg bg-muted p-0.5">
            {FILTERS.map((item) => (
              <Button
                key={item.value}
                type="button"
                size="xs"
                variant={filter === item.value ? 'secondary' : 'ghost'}
                className="rounded-md"
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <Badge variant="outline">{pendingCount} 项待办</Badge>
        </div>

        {status && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {status}
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 pr-2">
          {disabled ? (
            <ToolEmptyState text="请选择一个可用桌宠工作空间" />
          ) : loading && todos.length === 0 ? (
            <ToolEmptyState text="正在加载任务..." />
          ) : todos.length === 0 ? (
            <ToolEmptyState text="暂无任务" />
          ) : (
            todos.map((todo) => (
              <div
                key={todo.id}
                className={cn(
                  'flex min-w-0 items-start gap-2 rounded-lg border bg-background px-3 py-2.5',
                  todo.completed && 'bg-muted/40 text-muted-foreground',
                )}
              >
                <Button
                  type="button"
                  variant={todo.completed ? 'secondary' : 'outline'}
                  size="icon-xs"
                  className="mt-0.5 rounded-full"
                  disabled={busyId === todo.id}
                  aria-label={todo.completed ? '标记为未完成' : '标记为完成'}
                  onClick={() => void toggleTodo(todo)}
                >
                  {todo.completed ? <Check /> : <Circle />}
                </Button>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className={cn('break-words text-sm leading-relaxed', todo.completed && 'line-through')}>
                    {todo.text}
                  </div>
                  {todo.dueDate && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarDays className="size-3.5" />
                      <span>{formatDueDate(todo.dueDate)}</span>
                      {isOverdue(todo) && <Badge variant="destructive">已过期</Badge>}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="mt-0.5"
                  disabled={busyId === todo.id}
                  aria-label="删除任务"
                  onClick={() => void deleteTodo(todo.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ToolEmptyState({ text }: { text: string }): ReactNode {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function formatDueDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
}

function todayInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function isOverdue(todo: TodoItem): boolean {
  return Boolean(todo.dueDate && !todo.completed && todo.dueDate < todayInputValue());
}

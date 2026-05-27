import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, CalendarPlus, Repeat2, Trash2 } from 'lucide-react';
import { Tools } from '@/ai/tools-api';
import type { CountdownEvent } from '@/ai/tools-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface CountdownPanelProps {
  workspaceFolder: string;
  compact?: boolean;
}

export function CountdownPanel({ workspaceFolder, compact = false }: CountdownPanelProps): ReactNode {
  const [events, setEvents] = useState<CountdownEvent[]>([]);
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => defaultDate());
  const [repeatYearly, setRepeatYearly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [status, setStatus] = useState('');
  const disabled = !workspaceFolder;

  const loadEvents = useCallback(async (): Promise<void> => {
    if (!workspaceFolder) {
      setEvents([]);
      return;
    }

    setLoading(true);
    try {
      const response = await Tools.countdown.list(workspaceFolder);
      setEvents(response.events);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [workspaceFolder]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const addEvent = async (): Promise<void> => {
    if (!name.trim() || !date || disabled) return;

    setLoading(true);
    try {
      await Tools.countdown.add(workspaceFolder, name.trim(), date, repeatYearly ? 'yearly' : undefined);
      setName('');
      setDate(defaultDate());
      setRepeatYearly(false);
      await loadEvents();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const deleteEvent = async (id: string): Promise<void> => {
    if (disabled) return;

    setBusyId(id);
    try {
      await Tools.countdown.delete(workspaceFolder, id);
      await loadEvents();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className={cn('flex size-full min-h-0 flex-col gap-3 p-4', compact && 'gap-2 p-3')}>
      <div className="shrink-0 rounded-lg border bg-background p-3">
        <div className={cn('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-[1fr_150px_auto]')}>
          <Input
            value={name}
            disabled={disabled || loading}
            placeholder={disabled ? '先选择桌宠' : '事件名称'}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void addEvent();
              }
            }}
          />
          <Input
            type="date"
            value={date}
            disabled={disabled || loading}
            aria-label="目标日期"
            onChange={(event) => setDate(event.currentTarget.value)}
          />
          <Button
            type="button"
            disabled={disabled || loading || !name.trim() || !date}
            onClick={() => void addEvent()}
          >
            <CalendarPlus data-icon="inline-start" />
            添加
          </Button>
        </div>
        <label className="mt-2 flex w-fit items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="size-3.5"
            checked={repeatYearly}
            disabled={disabled || loading}
            onChange={(event) => setRepeatYearly(event.currentTarget.checked)}
          />
          每年重复
        </label>
      </div>

      {status && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {status}
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className={cn('grid gap-2 pr-2', !compact && 'sm:grid-cols-2')}>
          {disabled ? (
            <ToolEmptyState text="请选择一个可用桌宠工作空间" />
          ) : loading && events.length === 0 ? (
            <ToolEmptyState text="正在加载倒数日..." />
          ) : events.length === 0 ? (
            <ToolEmptyState text="暂无倒数日" />
          ) : (
            events.map((event) => (
              <div key={event.id} className="flex min-w-0 flex-col gap-3 rounded-lg border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{event.name}</div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarDays className="size-3.5" />
                      <span>{event.nextDate}</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={busyId === event.id}
                    aria-label="删除倒数日"
                    onClick={() => void deleteEvent(event.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="flex items-end justify-between gap-2">
                  <div className="font-mono text-3xl font-semibold tabular-nums">
                    {Math.abs(event.daysRemaining)}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">天</span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant={event.daysRemaining === 0 ? 'default' : 'secondary'}>
                      {daysLabel(event.daysRemaining)}
                    </Badge>
                    {event.repeat === 'yearly' && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Repeat2 className="size-3" />
                        每年
                      </span>
                    )}
                  </div>
                </div>
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
    <div className="col-span-full rounded-lg border border-dashed bg-muted/20 px-3 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function defaultDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function daysLabel(days: number): string {
  if (days === 0) return '今天';
  if (days > 0) return `还有 ${days} 天`;
  return `已过 ${Math.abs(days)} 天`;
}

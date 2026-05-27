import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pause, Play, RotateCcw, Square, Timer } from 'lucide-react';
import { Tools } from '@/ai/tools-api';
import type { PomodoroStatusResponse } from '@/ai/tools-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface PomodoroPanelProps {
  workspaceFolder: string;
  compact?: boolean;
}

export function PomodoroPanel({ workspaceFolder, compact = false }: PomodoroPanelProps): ReactNode {
  const [status, setStatus] = useState<PomodoroStatusResponse | null>(null);
  const [duration, setDuration] = useState(25);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const disabled = !workspaceFolder;
  const current = status?.current ?? null;

  const applyStatus = useCallback((next: PomodoroStatusResponse): void => {
    setStatus(next);
    setFetchedAt(Date.now());
    setNow(Date.now());
    setMessage('');
  }, []);

  const loadStatus = useCallback(async (): Promise<void> => {
    if (!workspaceFolder) {
      setStatus(null);
      return;
    }

    setBusy(true);
    try {
      applyStatus(await Tools.pomodoro.status(workspaceFolder));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [applyStatus, workspaceFolder]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!current) return;

    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [current?.id, current?.status]);

  const remainingSeconds = useMemo(() => {
    if (!current) return 0;
    if (current.status !== 'running') return current.remainingSeconds;
    const elapsedSinceFetch = Math.floor((now - fetchedAt) / 1000);
    return Math.max(0, current.remainingSeconds - elapsedSinceFetch);
  }, [current, fetchedAt, now]);

  useEffect(() => {
    if (current?.status === 'running' && remainingSeconds === 0) {
      void loadStatus();
    }
  }, [current?.status, loadStatus, remainingSeconds]);

  const run = async (operation: () => Promise<PomodoroStatusResponse>): Promise<void> => {
    if (disabled) return;

    setBusy(true);
    try {
      applyStatus(await operation());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const start = (): void => {
    const normalizedDuration = Math.max(1, Math.min(180, Math.round(duration || 25)));
    setDuration(normalizedDuration);
    void run(() => Tools.pomodoro.start(workspaceFolder, normalizedDuration, label.trim() || undefined));
  };

  return (
    <div className={cn('flex size-full min-h-0 flex-col gap-3 p-4', compact && 'gap-2 p-3')}>
      <div className="rounded-lg border bg-background p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Timer className="size-4 text-muted-foreground" />
              <span>{current ? currentStatusLabel(current.status) : '番茄钟'}</span>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {current?.label || '专注一段固定时间'}
            </p>
          </div>
          <Badge variant={current?.status === 'running' ? 'default' : 'secondary'}>
            今日 {status?.todayCompletedCount ?? 0}
          </Badge>
        </div>

        <div className={cn('py-5 text-center font-mono text-6xl font-semibold tabular-nums', compact && 'py-4 text-5xl')}>
          {formatSeconds(current ? remainingSeconds : duration * 60)}
        </div>

        {current ? (
          <div className="grid grid-cols-2 gap-2">
            {current.status === 'running' ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(() => Tools.pomodoro.pause(workspaceFolder))}>
                <Pause data-icon="inline-start" />
                暂停
              </Button>
            ) : (
              <Button type="button" disabled={busy} onClick={() => void run(() => Tools.pomodoro.resume(workspaceFolder))}>
                <Play data-icon="inline-start" />
                继续
              </Button>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => Tools.pomodoro.stop(workspaceFolder))}>
              <Square data-icon="inline-start" />
              停止
            </Button>
          </div>
        ) : (
          <div className={cn('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-[1fr_96px_auto]')}>
            <Input
              value={label}
              disabled={disabled || busy}
              placeholder={disabled ? '先选择桌宠' : '标签，如写代码'}
              onChange={(event) => setLabel(event.currentTarget.value)}
            />
            <Input
              type="number"
              min={1}
              max={180}
              value={duration}
              disabled={disabled || busy}
              aria-label="专注分钟数"
              onChange={(event) => setDuration(Number(event.currentTarget.value))}
            />
            <Button type="button" disabled={disabled || busy} onClick={start}>
              <Play data-icon="inline-start" />
              开始
            </Button>
          </div>
        )}
      </div>

      {message && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {message}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">今日记录</span>
          <Button type="button" size="xs" variant="ghost" disabled={disabled || busy} onClick={() => void loadStatus()}>
            <RotateCcw data-icon="inline-start" />
            刷新
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 pr-2">
            {disabled ? (
              <ToolEmptyState text="请选择一个可用桌宠工作空间" />
            ) : !status || status.todayCompleted.length === 0 ? (
              <ToolEmptyState text="暂无记录" />
            ) : (
              status.todayCompleted.slice().reverse().map((item) => (
                <div key={`${item.id}-${item.endedAt}`} className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{item.label || '未命名专注'}</div>
                    <div className="text-xs text-muted-foreground">{formatClock(item.startedAt)} - {formatClock(item.endedAt)}</div>
                  </div>
                  <Badge variant={item.status === 'completed' ? 'secondary' : 'outline'}>
                    {item.status === 'completed' ? '完成' : '停止'}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function ToolEmptyState({ text }: { text: string }): ReactNode {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function formatSeconds(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function currentStatusLabel(status: 'running' | 'paused'): string {
  return status === 'running' ? '专注中' : '已暂停';
}

function formatClock(seconds: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(seconds * 1000));
}

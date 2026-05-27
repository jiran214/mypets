export type ToolCommand = 'todolist' | 'pomodoro' | 'countdown';

export type ToolCommandEvent =
  | { type: 'done'; requestId: string; data: unknown }
  | { type: 'error'; requestId: string; error: string };

export type TodoStatusFilter = 'all' | 'pending' | 'done';

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
  completedAt: number | null;
  dueDate: string | null;
}

export interface TodoListResponse {
  todos: TodoItem[];
  status: TodoStatusFilter;
}

export type PomodoroStatus = 'running' | 'paused' | 'completed' | 'stopped';

export interface PomodoroCurrent {
  id: string;
  label: string;
  durationMinutes: number;
  startedAt: number;
  pausedAt: number | null;
  totalPausedSeconds: number;
  status: Extract<PomodoroStatus, 'running' | 'paused'>;
  elapsedSeconds: number;
  remainingSeconds: number;
}

export interface PomodoroHistoryItem {
  id: string;
  label: string;
  durationMinutes: number;
  startedAt: number;
  pausedAt?: number | null;
  totalPausedSeconds?: number;
  endedAt: number;
  status: Extract<PomodoroStatus, 'completed' | 'stopped'>;
}

export interface PomodoroStatusResponse {
  current: PomodoroCurrent | null;
  todayCompleted: PomodoroHistoryItem[];
  todayCompletedCount: number;
  todayDate: string;
  serverTime: number;
}

export interface CountdownEvent {
  id: string;
  name: string;
  date: string;
  repeat: 'yearly' | null;
  createdAt: number;
  nextDate: string;
  daysRemaining: number;
}

export interface CountdownListResponse {
  events: CountdownEvent[];
}

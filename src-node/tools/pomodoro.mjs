import {
  createId,
  nowSeconds,
  optionalText,
  readJsonFile,
  resolveDataFile,
  todayDate,
  writeJsonFile,
} from './storage.mjs';

const FILE_NAME = 'pomodoro.json';

function defaultState() {
  return {
    current: null,
    todayCompleted: [],
    todayDate: todayDate(),
  };
}

function normalizeState(value) {
  return {
    current: value?.current && typeof value.current === 'object' ? value.current : null,
    todayCompleted: Array.isArray(value?.todayCompleted) ? value.todayCompleted : [],
    todayDate: typeof value?.todayDate === 'string' ? value.todayDate : todayDate(),
  };
}

async function loadState(dataDir) {
  const state = normalizeState(await readJsonFile(resolveDataFile(dataDir, FILE_NAME), defaultState()));
  const today = todayDate();
  if (state.todayDate !== today) {
    state.todayCompleted = [];
    state.todayDate = today;
  }
  return state;
}

async function saveState(dataDir, state) {
  await writeJsonFile(resolveDataFile(dataDir, FILE_NAME), state);
}

function elapsedSeconds(current, now = nowSeconds()) {
  if (!current) return 0;
  const end = current.status === 'paused' && current.pausedAt ? current.pausedAt : now;
  return Math.max(0, end - current.startedAt - (current.totalPausedSeconds || 0));
}

function remainingSeconds(current, now = nowSeconds()) {
  if (!current) return 0;
  return Math.max(0, current.durationMinutes * 60 - elapsedSeconds(current, now));
}

function completeCurrentIfElapsed(state, now = nowSeconds()) {
  const current = state.current;
  if (!current || current.status !== 'running' || remainingSeconds(current, now) > 0) {
    return false;
  }

  const endedAt = current.startedAt + (current.totalPausedSeconds || 0) + current.durationMinutes * 60;
  state.todayCompleted.push({
    ...current,
    endedAt,
    status: 'completed',
  });
  state.current = null;
  return true;
}

function currentStatus(current) {
  if (!current) return null;
  const now = nowSeconds();
  return {
    ...current,
    elapsedSeconds: elapsedSeconds(current, now),
    remainingSeconds: remainingSeconds(current, now),
  };
}

function summary(state) {
  return {
    current: currentStatus(state.current),
    todayCompleted: state.todayCompleted,
    todayCompletedCount: state.todayCompleted.filter((item) => item.status === 'completed').length,
    todayDate: state.todayDate,
    serverTime: nowSeconds(),
  };
}

function parseDuration(value) {
  const duration = Number(value ?? 25);
  if (!Number.isFinite(duration) || duration < 1 || duration > 180) {
    throw new Error('duration must be between 1 and 180 minutes');
  }
  return Math.round(duration);
}

export async function handlePomodoro(dataDir, action, params = {}) {
  const state = await loadState(dataDir);
  const changedByTimer = completeCurrentIfElapsed(state);

  if (action === 'status') {
    if (changedByTimer) await saveState(dataDir, state);
    return summary(state);
  }

  if (action === 'history') {
    if (changedByTimer) await saveState(dataDir, state);
    return { todayCompleted: state.todayCompleted, todayDate: state.todayDate };
  }

  if (action === 'start') {
    if (state.current) throw new Error('A pomodoro is already active');
    state.current = {
      id: createId('pomo'),
      label: optionalText(params.label) ?? '',
      durationMinutes: parseDuration(params.duration),
      startedAt: nowSeconds(),
      pausedAt: null,
      totalPausedSeconds: 0,
      status: 'running',
    };
    await saveState(dataDir, state);
    return summary(state);
  }

  if (action === 'pause') {
    if (!state.current || state.current.status !== 'running') throw new Error('No running pomodoro');
    state.current = {
      ...state.current,
      pausedAt: nowSeconds(),
      status: 'paused',
    };
    await saveState(dataDir, state);
    return summary(state);
  }

  if (action === 'resume') {
    if (!state.current || state.current.status !== 'paused') throw new Error('No paused pomodoro');
    const now = nowSeconds();
    state.current = {
      ...state.current,
      totalPausedSeconds: (state.current.totalPausedSeconds || 0) + Math.max(0, now - (state.current.pausedAt || now)),
      pausedAt: null,
      status: 'running',
    };
    await saveState(dataDir, state);
    return summary(state);
  }

  if (action === 'stop') {
    if (!state.current) throw new Error('No active pomodoro');
    state.todayCompleted.push({
      ...state.current,
      endedAt: nowSeconds(),
      status: 'stopped',
    });
    state.current = null;
    await saveState(dataDir, state);
    return summary(state);
  }

  throw new Error(`Unsupported pomodoro action: ${action}`);
}

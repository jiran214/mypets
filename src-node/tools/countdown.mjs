import {
  createId,
  nowSeconds,
  optionalText,
  parseDate,
  readJsonFile,
  requireText,
  resolveDataFile,
  todayDate,
  updateById,
  writeJsonFile,
} from './storage.mjs';

const FILE_NAME = 'countdown.json';
const DEFAULT_STATE = { events: [] };
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeState(value) {
  return {
    events: Array.isArray(value?.events) ? value.events : [],
  };
}

async function loadState(dataDir) {
  return normalizeState(await readJsonFile(resolveDataFile(dataDir, FILE_NAME), DEFAULT_STATE));
}

async function saveState(dataDir, state) {
  await writeJsonFile(resolveDataFile(dataDir, FILE_NAME), state);
}

function localDateFromText(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function countdownMeta(event) {
  const today = localDateFromText(todayDate());
  let target = localDateFromText(event.date);
  if (event.repeat === 'yearly') {
    target = new Date(today.getFullYear(), target.getMonth(), target.getDate());
    if (target < today) {
      target = new Date(today.getFullYear() + 1, target.getMonth(), target.getDate());
    }
  }

  const daysRemaining = Math.ceil((target.getTime() - today.getTime()) / DAY_MS);
  return {
    ...event,
    nextDate: todayDate(target),
    daysRemaining,
  };
}

function sortEvents(events) {
  return events
    .map(countdownMeta)
    .sort((a, b) => a.daysRemaining - b.daysRemaining || a.name.localeCompare(b.name));
}

function normalizeRepeat(value) {
  const repeat = optionalText(value);
  if (repeat === undefined) return null;
  if (repeat !== 'yearly') throw new Error('repeat must be yearly');
  return repeat;
}

export async function handleCountdown(dataDir, action, params = {}) {
  const state = await loadState(dataDir);

  if (action === 'list') {
    return { events: sortEvents(state.events) };
  }

  if (action === 'add') {
    const event = {
      id: createId('cd'),
      name: requireText(params.name, 'name'),
      date: parseDate(params.date),
      repeat: normalizeRepeat(params.repeat),
      createdAt: nowSeconds(),
    };
    state.events.push(event);
    await saveState(dataDir, state);
    return { event: countdownMeta(event) };
  }

  if (action === 'update') {
    const id = requireText(params.id, 'id');
    const name = optionalText(params.name);
    const hasDate = Object.hasOwn(params, 'date');
    const hasRepeat = Object.hasOwn(params, 'repeat');
    const event = updateById(state.events, id, (item) => ({
      ...item,
      ...(name ? { name } : {}),
      ...(hasDate ? { date: parseDate(params.date) } : {}),
      ...(hasRepeat ? { repeat: normalizeRepeat(params.repeat) } : {}),
    }));
    await saveState(dataDir, state);
    return { event: countdownMeta(event) };
  }

  if (action === 'delete') {
    const id = requireText(params.id, 'id');
    const before = state.events.length;
    state.events = state.events.filter((event) => event.id !== id);
    if (state.events.length === before) throw new Error(`Item not found: ${id}`);
    await saveState(dataDir, state);
    return { id };
  }

  throw new Error(`Unsupported countdown action: ${action}`);
}

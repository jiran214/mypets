import {
  createId,
  nowSeconds,
  optionalText,
  parseDate,
  readJsonFile,
  requireText,
  resolveDataFile,
  updateById,
  writeJsonFile,
} from './storage.mjs';

const FILE_NAME = 'todolist.json';
const DEFAULT_STATE = { todos: [] };

function normalizeState(value) {
  return {
    todos: Array.isArray(value?.todos) ? value.todos : [],
  };
}

function sortTodos(todos) {
  return [...todos].sort((a, b) => {
    if (Boolean(a.completed) !== Boolean(b.completed)) return a.completed ? 1 : -1;
    const dueA = typeof a.dueDate === 'string' && a.dueDate ? a.dueDate : '9999-99-99';
    const dueB = typeof b.dueDate === 'string' && b.dueDate ? b.dueDate : '9999-99-99';
    if (dueA !== dueB) return dueA.localeCompare(dueB);
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });
}

function filterTodos(todos, status) {
  if (status === 'pending') return todos.filter((todo) => !todo.completed);
  if (status === 'done') return todos.filter((todo) => todo.completed);
  return todos;
}

async function loadState(dataDir) {
  return normalizeState(await readJsonFile(resolveDataFile(dataDir, FILE_NAME), DEFAULT_STATE));
}

async function saveState(dataDir, state) {
  await writeJsonFile(resolveDataFile(dataDir, FILE_NAME), state);
}

export async function handleTodolist(dataDir, action, params = {}) {
  const state = await loadState(dataDir);

  if (action === 'list') {
    const status = optionalText(params.status) ?? 'all';
    if (!['pending', 'done', 'all'].includes(status)) {
      throw new Error('status must be pending, done, or all');
    }
    return { todos: sortTodos(filterTodos(state.todos, status)), status };
  }

  if (action === 'add') {
    const text = requireText(params.text, 'text');
    const dueDate = optionalText(params.dueDate) ? parseDate(params.dueDate, 'dueDate') : null;
    const todo = {
      id: createId('todo'),
      text,
      completed: false,
      createdAt: nowSeconds(),
      completedAt: null,
      dueDate,
    };
    state.todos.push(todo);
    await saveState(dataDir, state);
    return { todo };
  }

  if (action === 'complete' || action === 'uncomplete') {
    const id = requireText(params.id, 'id');
    const completed = action === 'complete';
    const todo = updateById(state.todos, id, (item) => ({
      ...item,
      completed,
      completedAt: completed ? nowSeconds() : null,
    }));
    await saveState(dataDir, state);
    return { todo };
  }

  if (action === 'delete') {
    const id = requireText(params.id, 'id');
    const before = state.todos.length;
    state.todos = state.todos.filter((todo) => todo.id !== id);
    if (state.todos.length === before) throw new Error(`Item not found: ${id}`);
    await saveState(dataDir, state);
    return { id };
  }

  if (action === 'update') {
    const id = requireText(params.id, 'id');
    const text = optionalText(params.text);
    const hasDueDate = Object.hasOwn(params, 'dueDate');
    const todo = updateById(state.todos, id, (item) => ({
      ...item,
      ...(text ? { text } : {}),
      ...(hasDueDate ? { dueDate: optionalText(params.dueDate) ? parseDate(params.dueDate, 'dueDate') : null } : {}),
    }));
    await saveState(dataDir, state);
    return { todo };
  }

  throw new Error(`Unsupported todolist action: ${action}`);
}

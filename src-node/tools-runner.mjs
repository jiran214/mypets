import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { handleCountdown } from './tools/countdown.mjs';
import { handlePomodoro } from './tools/pomodoro.mjs';
import { handleTodolist } from './tools/todolist.mjs';

const DEFAULT_DATA_DIR = join(process.cwd(), '.wimipet', 'tools');
const DATA_DIR = process.env.TOOLS_DATA_DIR || DEFAULT_DATA_DIR;

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function pretty(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseCliParams(args) {
  const params = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const next = args[index + 1];
    if (!key) throw new Error('Invalid flag');
    if (!next || next.startsWith('--')) {
      params[key] = true;
      continue;
    }

    params[key] = next;
    index += 1;
  }
  return params;
}

function normalizeRequest(input) {
  const command = typeof input?.command === 'string' ? input.command.trim() : '';
  const action = typeof input?.action === 'string' ? input.action.trim() : '';
  const requestId = typeof input?.requestId === 'string' && input.requestId.trim()
    ? input.requestId.trim()
    : 'tools-request';
  const params = input?.params && typeof input.params === 'object' ? input.params : {};

  if (!command) throw new Error('command is required');
  if (!action) throw new Error('action is required');
  return { requestId, command, action, params };
}

async function handleRequest(input) {
  const request = normalizeRequest(input);
  await mkdir(DATA_DIR, { recursive: true });

  if (request.command === 'todolist') {
    return { request, data: await handleTodolist(DATA_DIR, request.action, request.params) };
  }
  if (request.command === 'pomodoro') {
    return { request, data: await handlePomodoro(DATA_DIR, request.action, request.params) };
  }
  if (request.command === 'countdown') {
    return { request, data: await handleCountdown(DATA_DIR, request.action, request.params) };
  }

  throw new Error(`Unsupported tools command: ${request.command}`);
}

function readInitialPayload() {
  return new Promise((resolve, reject) => {
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let settled = false;

    input.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed || settled) return;
      settled = true;
      input.close();
      try {
        resolve(JSON.parse(trimmed));
      } catch (error) {
        reject(error);
      }
    });

    input.on('close', () => {
      if (!settled) reject(new Error('No tools runner input received'));
    });
  });
}

async function runCli() {
  const [command, action, ...rest] = process.argv.slice(2);
  const { data } = await handleRequest({
    requestId: `cli-${Date.now()}`,
    command,
    action,
    params: parseCliParams(rest),
  });
  pretty(data);
}

async function runStdin() {
  let requestId = 'tools-request';
  try {
    const input = await readInitialPayload();
    const result = await handleRequest(input);
    requestId = result.request.requestId;
    emit({ type: 'done', requestId, data: result.data });
  } catch (error) {
    emit({
      type: 'error',
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}

if (process.argv.length > 2) {
  runCli().catch((error) => {
    pretty({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
} else {
  runStdin();
}

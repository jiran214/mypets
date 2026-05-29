import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, normalize } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { runPi } from './run-pi.mjs';

let activeRequestId = 'unknown';
const MAX_INLINE_ATTACHMENT_BYTES = 256 * 1024;
const TOOL_RESPONSE_TIMEOUT_MS = 30 * 60 * 1000;
const RUNNER_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(RUNNER_DIR);

let activeAbortHandler = null;

export function getActiveRequestId() {
  return activeRequestId;
}

export function setActiveRequestId(id) {
  activeRequestId = id;
}

export function setActiveAbortHandler(handler) {
  activeAbortHandler = handler;
}

export function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

let receivedInitialPayload = false;
let resolveInitialPayload;
let rejectInitialPayload;
let inputBridgeClosed = false;
const pendingToolResponses = new Map();
const inputBridge = createInterface({ input: process.stdin, crlfDelay: Infinity });
const initialPayloadPromise = new Promise((resolve, reject) => {
  resolveInitialPayload = resolve;
  rejectInitialPayload = reject;
});

inputBridge.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch (error) {
    if (!receivedInitialPayload) {
      rejectInitialPayload(error);
    }
    return;
  }

  if (!receivedInitialPayload) {
    receivedInitialPayload = true;
    resolveInitialPayload(message);
    return;
  }

  if (message?.type === 'abort') {
    activeAbortHandler?.();
    return;
  }

  if (message?.type !== 'tool_response') return;
  const questionId = asOptionalString(message.questionId);
  if (!questionId) return;
  const pending = pendingToolResponses.get(questionId);
  if (!pending) return;
  pendingToolResponses.delete(questionId);
  pending.resolve(message.response ?? {});
});

inputBridge.on('close', () => {
  if (!receivedInitialPayload) {
    rejectInitialPayload(new Error('No AI helper input received'));
  }
  for (const [questionId, pending] of pendingToolResponses) {
    pending.reject(new Error(`Input closed before receiving answer for ${questionId}`));
  }
  pendingToolResponses.clear();
});

function closeInputBridge() {
  if (inputBridgeClosed) return;
  inputBridgeClosed = true;
  inputBridge.close();
  process.stdin.pause();
}

export function asOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}


function fileNameFromPath(path) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function statPath(path) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

export function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      const kind = asOptionalString(item?.kind) ?? (asOptionalString(item?.path) ? 'file' : 'text');
      if (kind === 'text') {
        const text = asOptionalString(item?.text);
        if (!text) return undefined;
        return {
          kind: 'text',
          text,
          name: asOptionalString(item?.name) ?? '拖入文本',
          mediaType: asOptionalString(item?.mediaType) ?? 'text/plain',
        };
      }

      const path = asOptionalString(item?.path);
      if (!path) return undefined;
      return {
        kind: 'file',
        path: normalize(path),
        name: asOptionalString(item?.name) ?? fileNameFromPath(path),
        mediaType: asOptionalString(item?.mediaType),
      };
    })
    .filter(Boolean);
}

function renderAttachmentContext(attachment) {
  if (attachment.kind === 'text') {
    return `### ${attachment.name}\n类型: 拖入文本\n内容:\n${attachment.text}`;
  }

  const stat = statPath(attachment.path);
  const header = `### ${attachment.name}\n路径: ${attachment.path}`;
  if (!stat) return `${header}\n状态: 文件不存在或不可访问。`;
  if (stat.isDirectory()) return `${header}\n类型: 文件夹，请按路径读取需要的文件。`;
  if (!stat.isFile()) return `${header}\n类型: 非普通文件，请按路径处理。`;
  if (stat.size > MAX_INLINE_ATTACHMENT_BYTES) {
    return `${header}\n大小: ${stat.size} bytes\n内容: 文件较大，已按路径加入上下文。`;
  }

  let buffer;
  try {
    buffer = readFileSync(attachment.path);
  } catch {
    return `${header}\n状态: 文件无法读取，已按路径加入上下文。`;
  }
  if (!isTextBuffer(buffer)) {
    return `${header}\n大小: ${stat.size} bytes\n内容: 二进制文件，已按路径加入上下文。`;
  }

  return `${header}\n内容:\n${buffer.toString('utf8')}`;
}

function isTextBuffer(buffer) {
  return !buffer.includes(0);
}

export function buildPrompt(input, attachments) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';

  if (attachments.length === 0) return prompt;

  const context = attachments.map(renderAttachmentContext).join('\n\n');
  const userText = prompt || '请查看这些拖入的上下文。';
  return `${userText}\n\n用户拖入了以下内容，作为本轮聊天上下文。小文本文件内容和拖入文本已直接附在下面；其它文件请按路径读取。\n\n${context}`;
}

export function parseCustomEnv(value) {
  const env = {};
  if (typeof value !== 'string') return env;

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = line.slice(eq + 1);
  }
  return env;
}

export function emitPart(requestId, kind, text, title, toolTrace) {
  if (!text && !toolTrace) return;
  emit({
    type: 'part',
    requestId,
    part: {
      kind,
      text: text || '',
      ...(title ? { title } : {}),
      ...(toolTrace ? { toolTrace } : {}),
    },
  });
}

export function stringifyBrief(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
  } catch {
    return String(value);
  }
}

export function partKindForToolTrace(trace) {
  return partKindForToolTraceKind(trace?.kind);
}

function partKindForToolTraceKind(kind) {
  if (kind === 'mcp') return 'mcp';
  if (kind === 'skill') return 'skill';
  if (kind === 'plan') return 'plan';
  if (kind === 'status') return 'status';
  return 'tool';
}

function traceKindFromToolName(name) {
  const normalized = String(name || '').toLowerCase();
  if (normalized === 'bash' || normalized === 'commandexecution' || normalized === 'command_execution') return 'bash';
  if (normalized === 'read') return 'read';
  if (String(name || '').startsWith('mcp__') || normalized.includes('mcp')) return 'mcp';
  if (normalized.includes('skill')) return 'skill';
  return 'tool';
}

function traceLabel(kind) {
  if (kind === 'bash') return 'Bash';
  if (kind === 'read') return 'Read';
  if (kind === 'mcp') return 'MCP';
  if (kind === 'skill') return 'Skill';
  if (kind === 'plan') return '计划';
  if (kind === 'status') return '状态';
  return 'Tool';
}

function traceName(toolName, kind) {
  if (kind === 'bash') return 'Bash';
  if (kind === 'read') return 'Read';
  if (kind === 'mcp') return mcpDescription(toolName) || String(toolName || 'MCP');
  return String(toolName || kind || 'tool');
}

function mcpDescription(name) {
  if (!String(name || '').startsWith('mcp__')) return '';
  const parts = String(name).split('__').filter(Boolean);
  return parts.length >= 3 ? `${parts[1]} / ${parts.slice(2).join('/')}` : String(name);
}

function stringField(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  for (const key of keys) {
    const current = value[key];
    if (typeof current === 'string' && current.trim()) return current.trim();
  }
  return '';
}

function tracePath(kind, payload, options) {
  if (options.path) return options.path;
  if (kind === 'read') {
    return stringField(payload, ['path', 'filePath', 'file_path', 'filename']);
  }
  return stringField(payload, ['path', 'filePath', 'file_path']);
}

function traceDescription(toolName, kind, payload, options) {
  if (options.description) return options.description;
  if (kind === 'bash') return stringField(payload, ['description', 'command']) || (typeof payload === 'string' ? payload : '');
  if (kind === 'read') return tracePath(kind, payload, options);
  if (kind === 'mcp') return mcpDescription(toolName) || String(toolName || '');
  return String(toolName || '');
}

export function toolTraceFromToolUse(toolName, phase, payload, options = {}) {
  const kind = options.kind || traceKindFromToolName(toolName);
  const id = options.id || randomUUID();
  const path = tracePath(kind, payload, options);
  const description = traceDescription(toolName, kind, payload, { ...options, path });
  const trace = {
    id,
    phase,
    kind,
    name: options.name || traceName(toolName, kind),
    label: options.label || traceLabel(kind),
    ...(description ? { description } : {}),
    ...(path ? { path } : {}),
    ...(options.partial !== undefined ? { partial: Boolean(options.partial) } : {}),
    ...(options.error ? { error: options.error } : {}),
  };

  if (phase === 'input') {
    trace.input = payload;
  } else if (payload !== undefined) {
    trace.output = payload;
  }

  return trace;
}

export function toolTraceTitle(trace) {
  return [trace?.label, trace?.description].filter(Boolean).join(' ') || 'Tool';
}

export function emitToolQuestion(requestId, question) {
  emit({
    type: 'question',
    requestId,
    question,
  });
}

export function waitForToolResponse(questionId, signal) {
  if (signal?.aborted) {
    return Promise.reject(new Error('Tool question was cancelled'));
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingToolResponses.delete(questionId);
      reject(new Error('Timed out waiting for user answer'));
    }, TOOL_RESPONSE_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      pendingToolResponses.delete(questionId);
      reject(new Error('Tool question was cancelled'));
    };

    signal?.addEventListener('abort', abort, { once: true });
    pendingToolResponses.set(questionId, {
      resolve: (response) => {
        cleanup();
        resolve(response);
      },
      reject: (error) => {
        cleanup();
        reject(error);
      },
    });
  });
}

export function normalizeAnswerArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

async function main() {
  const input = await initialPayloadPromise;
  if (!input.requestId || !input.settings) {
    throw new Error('Invalid payload: missing requestId or settings');
  }
  activeRequestId = input.requestId;

  try {
    await runPi(input);
  } finally {
    closeInputBridge();
  }
}

main().catch((error) => {
  closeInputBridge();
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : '';
  // 记录完整的错误堆栈到 stderr
  console.error('[runner] Fatal error:', errorMessage);
  if (errorStack) {
    console.error('[runner] Stack:', errorStack);
  }
  emit({
    type: 'error',
    requestId: activeRequestId,
    error: errorMessage,
  });
  process.exitCode = 1;
});

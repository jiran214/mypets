import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, normalize } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { runPi } from './run-pi.mjs';
import { existingFile } from './runner-utils.mjs';

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

export function attachmentDirectories(attachments) {
  const directories = new Set();
  for (const attachment of attachments) {
    if (attachment.kind !== 'file') continue;
    const stat = statPath(attachment.path);
    if (!stat) continue;
    directories.add(normalize(stat.isDirectory() ? attachment.path : dirname(attachment.path)));
  }
  return [...directories];
}

function isTextBuffer(buffer) {
  return !buffer.includes(0);
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

export function buildPrompt(input, attachments) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  const persona = asOptionalString(input.settings?.petPersona);
  const personaContext = persona
    ? `你正在扮演当前桌宠的 AI 分身。请始终保持以下人设，除非用户明确要求切换角色。\n\n桌宠人设:\n${persona}`
    : '';

  const userPrompt = attachments.length === 0
    ? prompt
    : (() => {
        const context = attachments.map(renderAttachmentContext).join('\n\n');
        const userText = prompt || '请查看这些拖入的上下文。';
        return `${userText}\n\n用户拖入了以下内容，作为本轮聊天上下文。小文本文件内容和拖入文本已直接附在下面；其它文件请按路径读取。\n\n${context}`;
      })();

  return [personaContext, userPrompt].filter(Boolean).join('\n\n---\n\n');
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

const toolTraceById = new Map();

function rememberToolTrace(trace) {
  if (!trace?.id) return;
  toolTraceById.set(trace.id, trace);
}

function textFromToolResultBlock(block) {
  const content = block?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item?.text === 'string') return item.text;
        if (item?.type === 'image') return '[image]';
        return stringifyBrief(item);
      })
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }
  return '';
}

export function textDeltaFromStreamEvent(event) {
  if (event?.type !== 'content_block_delta') return '';
  const delta = event.delta;
  if (delta?.type !== 'text_delta' || typeof delta.text !== 'string') return '';
  return delta.text;
}

export function thinkingDeltaFromStreamEvent(event) {
  if (event?.type !== 'content_block_delta') return '';
  const delta = event.delta;
  if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') return delta.thinking;
  if (delta?.type === 'thinking_summary_delta' && typeof delta.summary === 'string') return delta.summary;
  return '';
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

function classifyTool(name) {
  const traceKind = traceKindFromToolName(name);
  return partKindForToolTraceKind(traceKind);
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

function isAskUserQuestionTool(toolName, input) {
  return toolName === 'AskUserQuestion' || (toolName.toLowerCase() === 'askuserquestion' && Array.isArray(input?.questions));
}

function normalizeQuestionOption(option, index) {
  const label = asOptionalString(option?.label) ?? `选项 ${index + 1}`;
  return {
    label,
    description: asOptionalString(option?.description) ?? label,
    ...(asOptionalString(option?.preview) ? { preview: asOptionalString(option.preview) } : {}),
  };
}

function normalizeQuestionItem(item, index) {
  const options = Array.isArray(item?.options)
    ? item.options.slice(0, 4).map(normalizeQuestionOption)
    : [];
  const questionText = asOptionalString(item?.question) ?? `请选择第 ${index + 1} 项`;

  return {
    question: questionText,
    header: asOptionalString(item?.header) ?? `问题 ${index + 1}`,
    options: options.length >= 2
      ? options
      : [
          { label: '确认', description: '使用默认确认。' },
          { label: '取消', description: '不继续此选择。' },
        ],
    multiSelect: Boolean(item?.multiSelect),
  };
}

function normalizeAskUserQuestions(input) {
  const questions = Array.isArray(input?.questions) ? input.questions : [];
  const normalized = questions.slice(0, 4).map(normalizeQuestionItem);
  return normalized.length > 0 ? normalized : [normalizeQuestionItem({}, 0)];
}

function createPermissionQuestion(toolName, input, ctx) {
  const title = ctx.title || `Agent 想使用 ${toolName}`;
  const description = ctx.description || stringifyBrief(input);
  return {
    question: title.endsWith('？') || title.endsWith('?') ? title : `${title}？`,
    header: ctx.displayName || toolName,
    options: [
      { label: '允许', description: description || '允许执行这个工具调用。' },
      { label: '拒绝', description: '不执行这个工具调用，并告诉 Agent 你拒绝了。' },
    ],
    multiSelect: false,
  };
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

async function handleAskUserQuestion(toolName, input, ctx) {
  const questionId = ctx.toolUseID || randomUUID();
  const questions = normalizeAskUserQuestions(input);
  const question = {
    id: questionId,
    requestId: activeRequestId,
    toolName,
    toolUseId: ctx.toolUseID || questionId,
    kind: 'ask-user-question',
    title: ctx.title || 'Agent 需要你的选择',
    ...(ctx.description ? { description: ctx.description } : {}),
    questions,
  };

  emitToolQuestion(activeRequestId, question);
  const response = await waitForToolResponse(questionId, ctx.signal);
  const nextAnswers = {};
  for (const item of questions) {
    nextAnswers[item.question] = normalizeAnswerArray(response?.answers?.[item.question]).join(', ');
  }
  return {
    behavior: 'allow',
    toolUseID: ctx.toolUseID,
    updatedInput: {
      ...input,
      answers: nextAnswers,
      ...(response?.annotations ? { annotations: response.annotations } : {}),
    },
  };
}

async function handlePermissionQuestion(toolName, input, ctx) {
  const questionId = ctx.toolUseID || randomUUID();
  const prompt = createPermissionQuestion(toolName, input, ctx);
  const question = {
    id: questionId,
    requestId: activeRequestId,
    toolName,
    toolUseId: ctx.toolUseID || questionId,
    kind: 'permission',
    title: ctx.title || `确认 ${toolName}`,
    ...(ctx.description ? { description: ctx.description } : {}),
    questions: [prompt],
  };

  emitToolQuestion(activeRequestId, question);
  const response = await waitForToolResponse(questionId, ctx.signal);
  const answer = normalizeAnswerArray(response?.answers?.[prompt.question]);
  if (answer.some((item) => item.includes('允许'))) {
    return {
      behavior: 'allow',
      toolUseID: ctx.toolUseID,
    };
  }

  return {
    behavior: 'deny',
    message: '用户拒绝了这个工具调用。',
    toolUseID: ctx.toolUseID,
  };
}

export async function canUseTool(toolName, input, ctx) {
  if (isAskUserQuestionTool(toolName, input)) {
    return handleAskUserQuestion(toolName, input, ctx);
  }
  return handlePermissionQuestion(toolName, input, ctx);
}

function emitContentBlock(requestId, block, includeText) {
  if (!block || typeof block !== 'object') return false;

  if (block.type === 'text' && includeText && typeof block.text === 'string') {
    emit({ type: 'delta', requestId, text: block.text });
    return true;
  }

  if ((block.type === 'thinking' || block.type === 'thinking_summary') && typeof block.thinking === 'string') {
    emitPart(requestId, 'thinking', block.thinking, '思考');
    return false;
  }

  if (block.type === 'tool_use' && typeof block.name === 'string') {
    if (isAskUserQuestionTool(block.name, block.input)) {
      return false;
    }
    const trace = toolTraceFromToolUse(block.name, 'input', block.input, { id: block.id });
    rememberToolTrace(trace);
    emitPart(requestId, classifyTool(block.name), stringifyBrief(block.input), toolTraceTitle(trace), trace);
    return false;
  }

  if (typeof block.type === 'string' && block.type.includes('tool')) {
    const trace = toolTraceFromToolUse(block.type, 'input', block, { id: block.id });
    rememberToolTrace(trace);
    emitPart(requestId, partKindForToolTrace(trace), stringifyBrief(block), toolTraceTitle(trace), trace);
    return false;
  }

  return false;
}

export function emitUserToolResultParts(requestId, message) {
  const content = message?.message?.content;
  if (!Array.isArray(content)) return false;

  let emitted = false;
  for (const block of content) {
    if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') {
      continue;
    }

    const previous = toolTraceById.get(block.tool_use_id);
    const output = textFromToolResultBlock(block);
    const trace = {
      id: block.tool_use_id,
      phase: 'output',
      kind: previous?.kind || 'tool',
      name: previous?.name || block.tool_use_id,
      label: previous?.label || 'Tool',
      ...(previous?.description ? { description: previous.description } : {}),
      ...(previous?.path ? { path: previous.path } : {}),
      ...(output ? { output } : {}),
      ...(block.is_error ? { error: output || '工具执行失败' } : {}),
    };
    emitPart(requestId, partKindForToolTrace(trace), output, toolTraceTitle(trace), trace);
    emitted = true;
  }

  return emitted;
}

export function emitAssistantParts(requestId, message, includeText) {
  const content = message?.message?.content;
  if (!Array.isArray(content)) return false;

  let emittedText = false;
  for (const block of content) {
    emittedText = emitContentBlock(requestId, block, includeText && !emittedText) || emittedText;
  }
  return emittedText;
}

export function emitSdkStatusPart(requestId, message) {
  if (message?.type === 'system' && message.subtype === 'init') {
    return;
  }

  if (message?.type === 'system' && message.subtype === 'permission_denied') {
    emitPart(requestId, 'status', message.message || message.decision_reason || '权限被拒绝', '权限');
    return;
  }

  if (message?.type === 'tool_use_summary') {
    emitPart(requestId, 'plan', message.summary, '工具摘要');
    return;
  }

  if (message?.type === 'system' && typeof message.subtype === 'string' && message.subtype.startsWith('task_')) {
    const text = message.summary || message.description || message.status || stringifyBrief(message);
    emitPart(requestId, 'tool', text, '任务');
  }
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
  emit({
    type: 'error',
    requestId: activeRequestId,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

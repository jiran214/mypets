import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { createInterface } from 'node:readline';
import { query } from '@anthropic-ai/claude-agent-sdk';

let activeRequestId = 'unknown';
const MAX_INLINE_ATTACHMENT_BYTES = 256 * 1024;
const TOOL_RESPONSE_TIMEOUT_MS = 30 * 60 * 1000;

function emit(event) {
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

function asOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function existingFile(path) {
  try {
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
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

function normalizeAttachments(value) {
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

function attachmentDirectories(attachments) {
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

function buildPrompt(input, attachments) {
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

function execText(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', timeout: 3000 }).trim();
  } catch {
    return '';
  }
}

function wherePaths(name) {
  if (process.platform !== 'win32') return [];
  return execText('where.exe', [name])
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
}

function npmClaudePath() {
  const root = execText('npm', ['root', '-g']);
  return root ? join(root, '@anthropic-ai', 'claude-code', 'cli-wrapper.cjs') : '';
}

function findClaudeExecutable() {
  const home = homedir();
  const candidates = [];

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    candidates.push(
      join(home, '.local', 'bin', 'claude.exe'),
      join(localAppData, 'Claude', 'claude.exe'),
      npmClaudePath(),
      ...wherePaths('claude'),
    );
  } else {
    candidates.push(
      join(home, '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      npmClaudePath(),
      execText('which', ['claude']),
    );
  }

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const path = normalize(candidate);
    if (seen.has(path)) continue;
    seen.add(path);
    const found = existingFile(path);
    if (found) return found;
  }

  return undefined;
}

function findCodexExecutable() {
  const home = homedir();
  const candidates = [];

  if (process.platform === 'win32') {
    const shellCandidates = [
      ...wherePaths('codex.cmd'),
      ...wherePaths('codex').filter((path) => {
        const lower = path.toLowerCase();
        return lower.endsWith('.cmd') || lower.endsWith('.bat');
      }),
    ];

    candidates.push(
      join(home, '.local', 'bin', 'codex.cmd'),
      ...shellCandidates,
      join(home, '.local', 'bin', 'codex.exe'),
      ...wherePaths('codex').filter((path) => {
        const lower = path.toLowerCase();
        return !lower.endsWith('.cmd') && !lower.endsWith('.bat') && !lower.endsWith('.ps1');
      }),
      ...wherePaths('codex.exe'),
    );
  } else {
    candidates.push(
      join(home, '.local', 'bin', 'codex'),
      '/usr/local/bin/codex',
      '/opt/homebrew/bin/codex',
      execText('which', ['codex']),
    );
  }

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const path = normalize(candidate);
    if (seen.has(path)) continue;
    seen.add(path);
    const found = existingFile(path);
    if (found) return found;
  }

  return undefined;
}

function parseCustomEnv(value) {
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

function emitPart(requestId, kind, text, title) {
  if (!text) return;
  emit({
    type: 'part',
    requestId,
    part: { kind, text, ...(title ? { title } : {}) },
  });
}

function textDeltaFromStreamEvent(event) {
  if (event?.type !== 'content_block_delta') return '';
  const delta = event.delta;
  if (delta?.type !== 'text_delta' || typeof delta.text !== 'string') return '';
  return delta.text;
}

function thinkingDeltaFromStreamEvent(event) {
  if (event?.type !== 'content_block_delta') return '';
  const delta = event.delta;
  if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') return delta.thinking;
  if (delta?.type === 'thinking_summary_delta' && typeof delta.summary === 'string') return delta.summary;
  return '';
}

function stringifyBrief(value) {
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
  if (name.startsWith('mcp__')) return 'mcp';
  if (name.toLowerCase().includes('skill')) return 'skill';
  return 'tool';
}

function toolTitle(name) {
  if (name.startsWith('mcp__')) {
    const parts = name.split('__').filter(Boolean);
    return parts.length >= 3 ? `MCP ${parts[1]} / ${parts.slice(2).join('/')}` : `MCP ${name}`;
  }
  if (name.toLowerCase().includes('skill')) return `Skill ${name}`;
  return `工具 ${name}`;
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

function emitToolQuestion(requestId, question) {
  emit({
    type: 'question',
    requestId,
    question,
  });
}

function waitForToolResponse(questionId, signal) {
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

function normalizeAnswerArray(value) {
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

async function canUseTool(toolName, input, ctx) {
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
    emitPart(requestId, classifyTool(block.name), stringifyBrief(block.input), toolTitle(block.name));
    return false;
  }

  if (typeof block.type === 'string' && block.type.includes('tool')) {
    emitPart(requestId, 'tool', stringifyBrief(block), `工具 ${block.type}`);
    return false;
  }

  return false;
}

function emitAssistantParts(requestId, message, includeText) {
  const content = message?.message?.content;
  if (!Array.isArray(content)) return false;

  let emittedText = false;
  for (const block of content) {
    emittedText = emitContentBlock(requestId, block, includeText && !emittedText) || emittedText;
  }
  return emittedText;
}

function emitSdkStatusPart(requestId, message) {
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

function parseProviderId(input) {
  const providerId = asOptionalString(input.providerId) ?? asOptionalString(input.settings?.providerId);
  return providerId === 'codex' ? 'codex' : 'claude';
}

async function runClaude(input) {
  const settings = input.settings ?? {};
  const claudeSettings = settings.claude ?? {};
  const providerState = input.providerState ?? {};
  const requestId = input.requestId;
  const attachments = normalizeAttachments(input.attachments);
  activeRequestId = requestId;
  let sawTextDelta = false;
  let lastSessionId = asOptionalString(providerState.claudeSessionId);

  const workspaceDir = asOptionalString(input.paths?.workspaceDir) ?? process.cwd();
  const claudeDir = asOptionalString(input.paths?.claudeDir);
  const additionalDirectories = attachmentDirectories(attachments);
  const customEnv = parseCustomEnv(claudeSettings.customEnvText);
  const thinkingIntensityMap = {
    low: 1024,
    medium: 5000,
    high: 10000,
    xhigh: 20000,
    max: 32000,
  };
  const thinkingBudget = thinkingIntensityMap[claudeSettings.thinkingIntensity] || thinkingIntensityMap.medium;

  const options = {
    includePartialMessages: true,
    canUseTool,
    toolConfig: {
      askUserQuestion: { previewFormat: 'markdown' },
    },
    permissionMode: claudeSettings.permissionMode || 'default',
    thinking: {
      type: 'enabled',
      budget_tokens: thinkingBudget,
    },
    settingSources: ['project', 'local'],
    skills: Array.isArray(claudeSettings.enabledSkills) && claudeSettings.enabledSkills.length > 0 ? claudeSettings.enabledSkills : 'all',
    cwd: workspaceDir,
    env: {
      ...process.env,
      ...customEnv,
      ...(claudeDir ? { CLAUDE_CONFIG_DIR: claudeDir } : {}),
      CLAUDE_AGENT_SDK_CLIENT_APP: 'wimipet',
    },
  };

  if (additionalDirectories.length > 0) {
    options.additionalDirectories = additionalDirectories;
  }

  if (claudeSettings.permissionMode === 'bypassPermissions') {
    options.allowDangerouslySkipPermissions = true;
  }

  const executable = asOptionalString(claudeSettings.pathToClaudeCodeExecutable) ?? findClaudeExecutable();
  if (executable) options.pathToClaudeCodeExecutable = executable;

  if (claudeSettings.useUserSettings) {
    const userSettingsPath = join(homedir(), '.claude', 'settings.json');
    if (existsSync(userSettingsPath)) {
      options.settings = userSettingsPath;
    }
  }

  if (lastSessionId) {
    options.resume = lastSessionId;
  }

  emit({ type: 'status', requestId, status: 'started' });

  for await (const message of query({ prompt: buildPrompt(input, attachments), options })) {
    if (message.session_id && message.session_id !== lastSessionId) {
      lastSessionId = message.session_id;
      emit({
        type: 'session',
        requestId,
        providerState: { claudeSessionId: lastSessionId },
      });
    }

    if (message.type === 'stream_event') {
      const delta = textDeltaFromStreamEvent(message.event);
      if (delta) {
        sawTextDelta = true;
        emit({ type: 'delta', requestId, text: delta });
      }

      const thinking = thinkingDeltaFromStreamEvent(message.event);
      if (thinking) {
        emitPart(requestId, 'thinking', thinking, '思考');
      }
      continue;
    }

    if (message.type === 'assistant') {
      sawTextDelta = emitAssistantParts(requestId, message, !sawTextDelta) || sawTextDelta;
      continue;
    }

    if (message.type === 'result') {
      if (!sawTextDelta && !message.is_error && typeof message.result === 'string') {
        emit({ type: 'delta', requestId, text: message.result });
      }

      if (message.is_error) {
        const detail = Array.isArray(message.errors) ? message.errors.join('\n') : 'Claude request failed';
        emit({ type: 'error', requestId, error: detail });
      } else {
        emit({
          type: 'done',
          requestId,
          providerState: lastSessionId ? { claudeSessionId: lastSessionId } : providerState,
        });
      }
      continue;
    }

    emitSdkStatusPart(requestId, message);
  }
}

function quoteWindowsArg(value) {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function spawnExecutable(executable, args, options) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/iu.test(executable)) {
    const command = [quoteWindowsArg(executable), ...args.map(quoteWindowsArg)].join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      ...options,
      windowsHide: true,
    });
  }

  return spawn(executable, args, {
    ...options,
    windowsHide: true,
  });
}

function createJsonRpcConnection(child) {
  let nextId = 1;
  const pending = new Map();
  const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const stderr = createInterface({ input: child.stderr, crlfDelay: Infinity });
  let notificationHandler = () => {};
  let requestHandler = () => Promise.resolve(undefined);
  let disposed = false;

  const exitPromise = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  const cleanupPending = (error) => {
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
  };

  stdout.on('line', (line) => {
    if (!line.trim()) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'id') && !Object.prototype.hasOwnProperty.call(message, 'method')) {
      const pendingRequest = pending.get(message.id);
      if (!pendingRequest) return;
      pending.delete(message.id);
      if (message.error) {
        pendingRequest.reject(new Error(message.error.message || stringifyBrief(message.error)));
      } else {
        pendingRequest.resolve(message.result);
      }
      return;
    }

    if (typeof message.method !== 'string') return;

    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      Promise.resolve(requestHandler(message))
        .then((result) => {
          if (disposed) return;
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: result ?? {} })}\n`);
        })
        .catch((error) => {
          if (disposed) return;
          child.stdin.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
          })}\n`);
        });
      return;
    }

    notificationHandler(message);
  });

  stderr.on('line', (line) => {
    process.stderr.write(`${line}\n`);
  });

  exitPromise.then(({ code, signal }) => {
    cleanupPending(new Error(`Codex app-server exited (${signal || code || 0})`));
  }).catch((error) => {
    cleanupPending(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    request(method, params) {
      const id = nextId++;
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    setHandlers({ onNotification, onRequest }) {
      notificationHandler = onNotification;
      requestHandler = onRequest;
    },
    async shutdown() {
      try {
        await Promise.race([
          this.request('shutdown', {}),
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ]);
      } catch {}
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      stdout.close();
      stderr.close();
      child.stdin.end();
      if (!child.killed) {
        child.kill();
      }
    },
    waitForExit() {
      return exitPromise;
    },
  };
}

function buildCodexThreadParams(settings, workspaceDir) {
  const params = {
    cwd: workspaceDir,
    approvalPolicy: settings.approvalPolicy || 'on-request',
    sandbox: 'workspace-write',
    personality: 'pragmatic',
  };

  const model = asOptionalString(settings.model);
  if (model) params.model = model;

  return params;
}

function buildCodexSandboxPolicy(workspaceDir, additionalDirectories) {
  const writableRoots = [...new Set([normalize(workspaceDir), ...additionalDirectories.map((dir) => normalize(dir))])];
  return {
    type: 'workspaceWrite',
    writableRoots,
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function summarizeFileChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return '无文件变更明细';
  }
  return changes
    .slice(0, 12)
    .map((change) => {
      const path = asOptionalString(change?.path) ?? asOptionalString(change?.newPath) ?? '未知路径';
      const kind = asOptionalString(change?.kind) ?? 'change';
      return `${kind}: ${path}`;
    })
    .join('\n');
}

function codexItemPart(item) {
  if (!item || typeof item !== 'object') return null;

  switch (item.type) {
    case 'plan':
      return { kind: 'plan', title: '计划', text: item.text || '正在生成计划' };
    case 'commandExecution':
      return { kind: 'tool', title: '命令执行', text: item.command || '执行命令' };
    case 'fileChange':
      return { kind: 'tool', title: '文件修改', text: summarizeFileChanges(item.changes) };
    case 'mcpToolCall':
      return { kind: 'mcp', title: `MCP ${item.server} / ${item.tool}`, text: stringifyBrief(item.arguments) };
    case 'dynamicToolCall': {
      const namespace = asOptionalString(item.namespace);
      return {
        kind: 'tool',
        title: `工具 ${namespace ? `${namespace} / ` : ''}${item.tool || 'dynamicToolCall'}`,
        text: stringifyBrief(item.arguments),
      };
    }
    case 'webSearch':
      return { kind: 'tool', title: 'Web 搜索', text: item.query || '搜索' };
    case 'collabAgentToolCall':
      return { kind: 'tool', title: `多代理 ${item.tool || ''}`.trim(), text: item.prompt || '协作代理调用' };
    case 'enteredReviewMode':
      return { kind: 'status', title: 'Review', text: item.review || '进入 review 模式' };
    case 'exitedReviewMode':
      return { kind: 'status', title: 'Review', text: item.review || '退出 review 模式' };
    default:
      return null;
  }
}

async function askCodexPermissionQuestion(requestId, toolName, title, description) {
  const questionId = randomUUID();
  const question = {
    id: questionId,
    requestId: activeRequestId,
    toolName,
    toolUseId: questionId,
    kind: 'permission',
    title,
    ...(description ? { description } : {}),
    questions: [{
      question: title.endsWith('？') || title.endsWith('?') ? title : `${title}？`,
      header: toolName,
      options: [
        { label: '允许', description: description || '允许继续执行。' },
        { label: '拒绝', description: '拒绝这次请求。' },
      ],
      multiSelect: false,
    }],
  };

  emitToolQuestion(requestId, question);
  const response = await waitForToolResponse(questionId);
  const answers = normalizeAnswerArray(response?.answers?.[question.questions[0].question]);
  return answers.some((item) => item.includes('允许'));
}

async function handleCodexToolQuestion(requestId, params) {
  const questionId = randomUUID();
  const questions = Array.isArray(params.questions)
    ? params.questions.slice(0, 4).map((question, index) => ({
        question: asOptionalString(question?.question) ?? `请选择第 ${index + 1} 项`,
        header: asOptionalString(question?.header) ?? `问题 ${index + 1}`,
        options: Array.isArray(question?.options) && question.options.length > 0
          ? question.options.map((option) => ({
              label: asOptionalString(option?.label) ?? '确认',
              description: asOptionalString(option?.description) ?? asOptionalString(option?.label) ?? '确认',
            }))
          : [
              { label: '确认', description: '使用默认确认。' },
              { label: '取消', description: '不继续此选择。' },
            ],
        multiSelect: false,
      }))
    : [];

  const question = {
    id: questionId,
    requestId,
    toolName: 'RequestUserInput',
    toolUseId: questionId,
    kind: 'ask-user-question',
    title: 'Codex 需要你的输入',
    questions,
  };

  emitToolQuestion(requestId, question);
  const response = await waitForToolResponse(questionId);
  const answers = {};
  for (let index = 0; index < questions.length; index += 1) {
    const prompt = questions[index];
    const original = params.questions[index];
    answers[original.id] = {
      answers: normalizeAnswerArray(response?.answers?.[prompt.question]),
    };
  }
  return { answers };
}

async function runCodex(input) {
  const settings = input.settings ?? {};
  const codexSettings = settings.codex ?? {};
  const providerState = input.providerState ?? {};
  const requestId = input.requestId;
  const attachments = normalizeAttachments(input.attachments);
  activeRequestId = requestId;

  const workspaceDir = asOptionalString(input.paths?.workspaceDir) ?? process.cwd();
  const additionalDirectories = attachmentDirectories(attachments);
  const executable = asOptionalString(codexSettings.pathToCodexExecutable) ?? findCodexExecutable();
  if (!executable) {
    throw new Error('Cannot find Codex executable');
  }

  const customEnv = parseCustomEnv(codexSettings.customEnvText);
  const child = spawnExecutable(executable, ['app-server'], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      ...customEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rpc = createJsonRpcConnection(child);

  let currentThreadId = asOptionalString(providerState.codexThreadId);
  let completed = false;
  let settleDone;
  let settleError;
  const donePromise = new Promise((resolve, reject) => {
    settleDone = resolve;
    settleError = reject;
  });

  rpc.setHandlers({
    onNotification(message) {
      switch (message.method) {
        case 'item/agentMessage/delta':
          emit({ type: 'delta', requestId, text: message.params?.delta || '' });
          return;
        case 'item/reasoning/textDelta':
        case 'item/reasoning/summaryTextDelta':
          emitPart(requestId, 'thinking', message.params?.delta || '', '思考');
          return;
        case 'item/plan/delta':
          emitPart(requestId, 'plan', message.params?.delta || '', '计划');
          return;
        case 'item/started': {
          const part = codexItemPart(message.params?.item);
          if (part) {
            emitPart(requestId, part.kind, part.text, part.title);
          }
          return;
        }
        case 'warning':
        case 'guardianWarning':
        case 'configWarning':
          emitPart(requestId, 'status', message.params?.message || stringifyBrief(message.params), '提示');
          return;
        case 'error':
          if (!completed) {
            completed = true;
            settleError(new Error(message.params?.message || 'Codex request failed'));
          }
          return;
        case 'turn/completed': {
          if (completed) return;
          const turn = message.params?.turn;
          if (turn?.status === 'failed') {
            completed = true;
            settleError(new Error(turn?.error?.message || 'Codex request failed'));
            return;
          }
          if (turn?.status === 'interrupted') {
            completed = true;
            emit({ type: 'cancelled', requestId });
            settleDone();
            return;
          }
          completed = true;
          emit({
            type: 'done',
            requestId,
            providerState: currentThreadId ? { codexThreadId: currentThreadId } : providerState,
          });
          settleDone();
          return;
        }
        default:
      }
    },
    async onRequest(message) {
      if (message.method === 'item/commandExecution/requestApproval') {
        const params = message.params ?? {};
        const description = [
          asOptionalString(params.reason),
          asOptionalString(params.command) ? `命令: ${params.command}` : '',
          asOptionalString(params.cwd) ? `目录: ${params.cwd}` : '',
        ].filter(Boolean).join('\n');
        const allowed = await askCodexPermissionQuestion(
          requestId,
          'CommandExecution',
          'Codex 想执行命令',
          description,
        );
        return { decision: allowed ? 'accept' : 'decline' };
      }

      if (message.method === 'item/fileChange/requestApproval') {
        const params = message.params ?? {};
        const allowed = await askCodexPermissionQuestion(
          requestId,
          'FileChange',
          'Codex 想应用文件修改',
          asOptionalString(params.reason) ?? '将把本轮建议的文件修改写入工作区。',
        );
        return { decision: allowed ? 'accept' : 'decline' };
      }

      if (message.method === 'item/tool/requestUserInput') {
        return handleCodexToolQuestion(requestId, message.params ?? {});
      }

      if (message.method === 'item/permissions/requestApproval') {
        const params = message.params ?? {};
        const allowed = await askCodexPermissionQuestion(
          requestId,
          'Permissions',
          'Codex 想申请额外权限',
          asOptionalString(params.reason) ?? '需要额外的文件或网络权限。',
        );
        return allowed
          ? { permissions: params.permissions ?? {}, scope: 'turn' }
          : { permissions: {}, scope: 'turn' };
      }

      throw new Error(`Unsupported Codex server request: ${message.method}`);
    },
  });

  emit({ type: 'status', requestId, status: 'started' });

  try {
    await rpc.request('initialize', {
      clientInfo: { name: 'wimipet', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });

    const threadParams = buildCodexThreadParams(codexSettings, workspaceDir);
    if (currentThreadId) {
      const resume = await rpc.request('thread/resume', {
        threadId: currentThreadId,
        ...threadParams,
        excludeTurns: true,
      });
      currentThreadId = resume?.thread?.id || currentThreadId;
    } else {
      const started = await rpc.request('thread/start', threadParams);
      currentThreadId = started?.thread?.id;
    }

    if (!currentThreadId) {
      throw new Error('Codex did not return a thread id');
    }

    emit({
      type: 'session',
      requestId,
      providerState: { codexThreadId: currentThreadId },
    });

    await rpc.request('turn/start', {
      threadId: currentThreadId,
      input: [{ type: 'text', text: buildPrompt(input, attachments) }],
      cwd: workspaceDir,
      approvalPolicy: codexSettings.approvalPolicy || 'on-request',
      sandboxPolicy: buildCodexSandboxPolicy(workspaceDir, additionalDirectories),
      ...(asOptionalString(codexSettings.model) ? { model: codexSettings.model.trim() } : {}),
      effort: codexSettings.reasoningEffort || 'medium',
      personality: 'pragmatic',
    });

    await Promise.race([
      donePromise,
      rpc.waitForExit().then(({ code, signal }) => {
        if (!completed) {
          throw new Error(`Codex app-server exited unexpectedly (${signal || code || 0})`);
        }
      }),
    ]);
  } finally {
    await rpc.shutdown();
    await rpc.dispose();
  }
}

async function main() {
  const input = await initialPayloadPromise;
  const providerId = parseProviderId(input);

  try {
    if (providerId === 'codex') {
      await runCodex(input);
    } else {
      await runClaude(input);
    }
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

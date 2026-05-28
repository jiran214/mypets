import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

import {
  normalizeAttachments,
  buildPrompt,
  asOptionalString,
  parseCustomEnv,
  stringifyBrief,
  emit,
  emitPart,
  partKindForToolTrace,
  toolTraceFromToolUse,
  toolTraceTitle,
  emitToolQuestion,
  waitForToolResponse,
  normalizeAnswerArray,
  setActiveRequestId,
  setActiveAbortHandler,
  getActiveRequestId,
} from './runner.mjs';
import { execText, wherePaths, spawnExecutable, findExecutable, createDisabledSkillNotice } from './runner-utils.mjs';

function attachStrictJsonlReader(stream, onLine) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';

  const consume = (chunk) => {
    buffer += decoder.write(chunk);
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      onLine(rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine);
      newlineIndex = buffer.indexOf('\n');
    }
  };

  stream.on('data', consume);
  stream.on('end', () => {
    buffer += decoder.end();
    if (buffer) {
      onLine(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer);
    }
  });

  return () => {
    stream.off('data', consume);
  };
}

export function findPiExecutable() {
  const candidates = [];
  const projectRoot = join(import.meta.dirname, '..');

  if (process.platform === 'win32') {
    candidates.push(
      join(projectRoot, 'node_modules', '.bin', 'pi.cmd'),
      join(projectRoot, 'node_modules', '.bin', 'pi.exe'),
      ...wherePaths('pi.cmd'),
      ...wherePaths('pi').filter((path) => {
        const lower = path.toLowerCase();
        return lower.endsWith('.cmd') || lower.endsWith('.bat');
      }),
      ...wherePaths('pi.exe'),
    );
  } else {
    candidates.push(
      join(projectRoot, 'node_modules', '.bin', 'pi'),
      execText('which', ['pi']),
      '/usr/local/bin/pi',
      '/opt/homebrew/bin/pi',
    );
  }

  return findExecutable(candidates);
}

function createPiRpcConnection(child, options = {}) {
  let nextId = 1;
  const pending = new Map();
  let eventHandler = () => {};
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

  const detachStdout = attachStrictJsonlReader(child.stdout, (line) => {
    if (!line.trim()) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.type === 'response' && typeof message.id === 'string') {
      const pendingRequest = pending.get(message.id);
      if (!pendingRequest) return;
      pending.delete(message.id);
      if (message.success === false) {
        pendingRequest.reject(new Error(message.error || `Pi command ${message.command || pendingRequest.command} failed`));
      } else {
        pendingRequest.resolve(message);
      }
      return;
    }

    eventHandler(message);
  });

  const detachStderr = attachStrictJsonlReader(child.stderr, (line) => {
    options.onStderr?.(line);
    if (line) process.stderr.write(`${line}\n`);
  });

  exitPromise.then(({ code, signal }) => {
    cleanupPending(new Error(`Pi RPC exited (${signal || code || 0})`));
  }).catch((error) => {
    cleanupPending(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    command(type, fields = {}) {
      const id = `pi-${nextId++}`;
      const payload = { id, type, ...fields };
      child.stdin.write(`${JSON.stringify(payload)}\n`);
      return new Promise((resolve, reject) => {
        pending.set(id, { command: type, resolve, reject });
      });
    },
    send(fields) {
      child.stdin.write(`${JSON.stringify(fields)}\n`);
    },
    onEvent(handler) {
      eventHandler = handler;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      detachStdout();
      detachStderr();
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

function normalizePiThinkingLevel(value) {
  return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(value) ? value : 'medium';
}

function normalizePiQueueMode(value) {
  return value === 'all' ? 'all' : 'one-at-a-time';
}

function parsePathList(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPiArgs(settings) {
  const args = ['--mode', 'rpc'];
  const provider = asOptionalString(settings.provider);
  const model = asOptionalString(settings.model);

  if (provider) args.push('--provider', provider);
  if (model) args.push('--model', model);

  for (const skillPath of parsePathList(settings.extraSkillPaths)) {
    args.push('--skill', skillPath);
  }

  return args;
}


function piPartFromToolName(toolName, fallbackKind = 'tool') {
  if (typeof toolName !== 'string') return fallbackKind;
  const normalized = toolName.toLowerCase();
  if (normalized.includes('skill') || normalized.startsWith('skill:')) return 'skill';
  if (normalized.includes('mcp')) return 'mcp';
  return fallbackKind;
}

function textFromPiToolResult(result) {
  if (!result || typeof result !== 'object') return stringifyBrief(result);
  if (Array.isArray(result.content)) {
    const text = result.content
      .map((item) => (typeof item?.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }
  if (typeof result.text === 'string') return result.text;
  if (typeof result.output === 'string') return result.output;
  return stringifyBrief(result);
}

function piErrorText(message, stderrLines) {
  const base = message instanceof Error ? message.message : String(message || 'Pi request failed');
  const stderr = Array.isArray(stderrLines)
    ? stderrLines.join('\n').trim()
    : '';
  if (!stderr) return base;
  if (base.includes(stderr)) return base;
  return `${base}\n\nPi stderr:\n${stderr}`;
}

function normalizePiSelectOptions(options) {
  if (!Array.isArray(options) || options.length === 0) {
    return [
      { label: '确认', description: '确认此请求。' },
      { label: '取消', description: '取消此请求。' },
    ];
  }

  return options.slice(0, 8).map((option, index) => {
    const label = typeof option === 'string'
      ? option
      : asOptionalString(option?.label) ?? asOptionalString(option?.value) ?? `选项 ${index + 1}`;
    return {
      label,
      description: typeof option === 'string'
        ? option
        : asOptionalString(option?.description) ?? asOptionalString(option?.value) ?? label,
    };
  });
}

function createPiExtensionQuestion(requestId, uiRequest) {
  const method = asOptionalString(uiRequest.method) ?? 'extension';
  const title = asOptionalString(uiRequest.title) ?? 'Pi 需要你的输入';
  const message = asOptionalString(uiRequest.message) ?? asOptionalString(uiRequest.placeholder) ?? '';

  if (method === 'confirm') {
    return {
      id: uiRequest.id,
      requestId,
      toolName: 'PiExtensionUI',
      toolUseId: uiRequest.id,
      kind: 'permission',
      title,
      ...(message ? { description: message } : {}),
      questions: [{
        question: title.endsWith('？') || title.endsWith('?') ? title : `${title}？`,
        header: 'Pi',
        options: [
          { label: '确认', description: message || '允许继续。' },
          { label: '取消', description: '拒绝或取消这次请求。' },
        ],
        multiSelect: false,
      }],
    };
  }

  if (method === 'select') {
    return {
      id: uiRequest.id,
      requestId,
      toolName: 'PiExtensionUI',
      toolUseId: uiRequest.id,
      kind: 'ask-user-question',
      title,
      ...(message ? { description: message } : {}),
      questions: [{
        question: title,
        header: 'Pi',
        options: normalizePiSelectOptions(uiRequest.options),
        multiSelect: false,
      }],
    };
  }

  const prefill = asOptionalString(uiRequest.prefill) ?? asOptionalString(uiRequest.value) ?? '';
  return {
    id: uiRequest.id,
    requestId,
    toolName: 'PiExtensionUI',
    toolUseId: uiRequest.id,
    kind: 'ask-user-question',
    title,
    ...(message || prefill ? { description: [message, prefill ? `默认内容: ${prefill}` : ''].filter(Boolean).join('\n') } : {}),
    questions: [{
      question: title,
      header: method === 'editor' ? '编辑器' : '输入',
      options: [
        { label: '提交默认值', description: prefill || message || '提交空内容。' },
        { label: '取消', description: '取消这次输入请求。' },
      ],
      multiSelect: false,
    }],
  };
}

function piExtensionResponseFromAnswer(uiRequest, question, response) {
  const answer = normalizeAnswerArray(response?.answers?.[question.questions[0].question]);
  const selected = answer[0] || '';
  const method = asOptionalString(uiRequest.method) ?? 'extension';

  if (selected.includes('取消')) {
    return { type: 'extension_ui_response', id: uiRequest.id, cancelled: true };
  }

  if (method === 'confirm') {
    return { type: 'extension_ui_response', id: uiRequest.id, confirmed: selected.includes('确认') || selected.includes('允许') };
  }

  if (method === 'select') {
    return { type: 'extension_ui_response', id: uiRequest.id, value: selected || undefined };
  }

  const fallback = asOptionalString(uiRequest.prefill) ?? asOptionalString(uiRequest.value) ?? '';
  return { type: 'extension_ui_response', id: uiRequest.id, value: fallback };
}

export async function runPi(input) {
  const settings = input.settings ?? {};
  const piSettings = settings.pi ?? {};
  const providerState = input.providerState ?? {};
  const requestId = input.requestId;
  const attachments = normalizeAttachments(input.attachments);
  setActiveRequestId(requestId);
  const activeToolIds = new Map();

  const toolIdForEvent = (event, toolName, create) => {
    const explicit = asOptionalString(event.toolCallId)
      ?? asOptionalString(event.toolUseId)
      ?? asOptionalString(event.toolCall?.id)
      ?? asOptionalString(event.id);
    if (explicit) return explicit;
    if (create || !activeToolIds.has(toolName)) {
      activeToolIds.set(toolName, randomUUID());
    }
    return activeToolIds.get(toolName);
  };

  const workspaceDir = asOptionalString(input.paths?.workspaceDir) ?? process.cwd();
  const executable = asOptionalString(piSettings.pathToPiExecutable) ?? findPiExecutable();
  if (!executable) {
    throw new Error('Cannot find Pi executable');
  }
  if (!asOptionalString(piSettings.model)) {
    throw new Error('请先在 Agent 设置中填写 Pi 模型。');
  }

  const customEnv = parseCustomEnv(piSettings.customEnvText);
  const child = spawnExecutable(executable, buildPiArgs(piSettings), {
    cwd: workspaceDir,
    env: {
      ...process.env,
      ...customEnv,
      PI_CODING_AGENT_CLIENT_APP: 'wimipet',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const piStderr = [];
  const MAX_STDERR_LINES = 200;
  const rpc = createPiRpcConnection(child, {
    onStderr(line) {
      if (line) {
        piStderr.push(line);
        if (piStderr.length > MAX_STDERR_LINES) piStderr.shift();
      }
    },
  });
  setActiveAbortHandler(() => {
    rpc.send({ type: 'abort' });
  });

  let completed = false;
  let sawTextDelta = false;
  let lastProviderState = {
    ...(providerState.piSessionId ? { piSessionId: providerState.piSessionId } : {}),
    ...(providerState.piSessionFile ? { piSessionFile: providerState.piSessionFile } : {}),
  };
  let settleDone;
  let settleError;
  const donePromise = new Promise((resolve, reject) => {
    settleDone = resolve;
    settleError = reject;
  });

  const emitPiState = async () => {
    try {
      const state = await rpc.command('get_state');
      const data = state.data ?? {};
      lastProviderState = {
        ...lastProviderState,
        ...(asOptionalString(data.sessionId) ? { piSessionId: data.sessionId } : {}),
        ...(asOptionalString(data.sessionFile) ? { piSessionFile: data.sessionFile } : {}),
      };
      emit({ type: 'session', requestId, providerState: lastProviderState });
    } catch {}
  };

  rpc.onEvent((event) => {
    switch (event.type) {
      case 'agent_start':
        emit({ type: 'status', requestId, status: 'started' });
        return;
      case 'message_update': {
        const delta = event.assistantMessageEvent ?? {};
        if (delta.type === 'text_delta' && typeof delta.delta === 'string') {
          sawTextDelta = true;
          emit({ type: 'delta', requestId, text: delta.delta });
          return;
        }
        if (delta.type === 'thinking_delta' && typeof delta.delta === 'string') {
          emitPart(requestId, 'thinking', delta.delta, '思考');
          return;
        }
        if (delta.type === 'toolcall_end' && delta.toolCall) {
          const toolName = asOptionalString(delta.toolCall.name) ?? 'tool';
          const trace = toolTraceFromToolUse(toolName, 'input', delta.toolCall.args ?? delta.toolCall, {
            id: asOptionalString(delta.toolCall.id) ?? randomUUID(),
            partial: false,
          });
          emitPart(requestId, partKindForToolTrace(trace), stringifyBrief(delta.toolCall.args ?? delta.toolCall), toolTraceTitle(trace), trace);
        }
        return;
      }
      case 'tool_execution_start': {
        const toolName = asOptionalString(event.toolName) ?? 'tool';
        const trace = toolTraceFromToolUse(toolName, 'input', event.args, {
          id: toolIdForEvent(event, toolName, true),
          partial: true,
        });
        emitPart(requestId, partKindForToolTrace(trace), stringifyBrief(event.args), toolTraceTitle(trace), trace);
        return;
      }
      case 'tool_execution_update': {
        const toolName = asOptionalString(event.toolName) ?? 'tool';
        const output = textFromPiToolResult(event.partialResult);
        const trace = toolTraceFromToolUse(toolName, 'update', output || event.partialResult, {
          id: toolIdForEvent(event, toolName, false),
          partial: true,
        });
        emitPart(requestId, partKindForToolTrace(trace), output, toolTraceTitle(trace), trace);
        return;
      }
      case 'tool_execution_end': {
        const toolName = asOptionalString(event.toolName) ?? 'tool';
        const output = textFromPiToolResult(event.result);
        const trace = toolTraceFromToolUse(toolName, 'output', output || event.result, {
          id: toolIdForEvent(event, toolName, false),
          error: event.isError ? output || '工具执行失败' : undefined,
          partial: false,
        });
        emitPart(requestId, partKindForToolTrace(trace), output, toolTraceTitle(trace), trace);
        activeToolIds.delete(toolName);
        return;
      }
      case 'queue_update':
        emitPart(requestId, 'status', stringifyBrief(event), '队列');
        return;
      case 'compaction_start':
        emitPart(requestId, 'status', '正在压缩上下文', '上下文');
        return;
      case 'compaction_end':
        emitPart(requestId, 'status', event.aborted ? '上下文压缩已取消' : '上下文压缩完成', '上下文');
        return;
      case 'auto_retry_start':
        emitPart(requestId, 'status', `自动重试 ${event.attempt}/${event.maxAttempts}`, '重试');
        return;
      case 'auto_retry_end':
        if (!event.success) {
          settleError(new Error(piErrorText(event.finalError || 'Pi auto retry failed', piStderr)));
        }
        return;
      case 'extension_error':
        emitPart(requestId, 'status', event.error || stringifyBrief(event), 'Pi 扩展');
        if (event.error) {
          settleError(new Error(piErrorText(event.error, piStderr)));
        }
        return;
      case 'extension_ui_request':
        void (async () => {
          if (!asOptionalString(event.id)) return;
          const method = asOptionalString(event.method) ?? '';
          if (['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text'].includes(method)) {
            const text = asOptionalString(event.message) ?? asOptionalString(event.statusText) ?? asOptionalString(event.title) ?? stringifyBrief(event);
            emitPart(requestId, 'status', text, 'Pi');
            return;
          }
          const question = createPiExtensionQuestion(requestId, event);
          emitToolQuestion(requestId, question);
          const response = await waitForToolResponse(event.id);
          rpc.send(piExtensionResponseFromAnswer(event, question, response));
        })().catch((error) => {
          settleError(error instanceof Error ? error : new Error(String(error)));
        });
        return;
      case 'agent_end':
        if (completed) return;
        completed = true;
        void emitPiState().finally(() => {
          emit({ type: 'done', requestId, providerState: lastProviderState });
          settleDone();
        });
        return;
      default:
    }
  });

  emit({ type: 'status', requestId, status: 'started' });

  try {
    await rpc.command('set_thinking_level', { level: normalizePiThinkingLevel(piSettings.thinkingLevel) });
    await rpc.command('set_auto_compaction', { enabled: piSettings.autoCompactionEnabled !== false });
    await rpc.command('set_auto_retry', { enabled: piSettings.autoRetryEnabled !== false });
    await rpc.command('set_steering_mode', { mode: normalizePiQueueMode(piSettings.steeringMode) });
    await rpc.command('set_follow_up_mode', { mode: normalizePiQueueMode(piSettings.followUpMode) });
    await emitPiState();

    const skillNotice = createDisabledSkillNotice('Pi', piSettings, input.allSkillNames);
    await rpc.command('prompt', {
      message: [skillNotice, buildPrompt(input, attachments)].filter(Boolean).join('\n\n'),
    });

    await Promise.race([
      donePromise,
      rpc.waitForExit().then(({ code, signal }) => {
        if (!completed) {
          throw new Error(piErrorText(`Pi RPC exited unexpectedly (${signal || code || 0})`, piStderr));
        }
      }),
    ]);

    if (!sawTextDelta && completed) {
      // Pi may finish after a purely tool-driven turn; ChatRuntime will render a status fallback.
    }
  } catch (error) {
    throw new Error(piErrorText(error, piStderr));
  } finally {
    setActiveAbortHandler(null);
    rpc.dispose();
  }
}

import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

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
} from './runner.mjs';
import { createDisabledSkillNotice } from './runner-utils.mjs';
import extraPromptExtension from './extensions/extra-prompt.mjs';

/**
 * Fix UTF-16LE encoded text.
 * Some APIs return content where each character is followed by a null byte.
 * E.g. "h e l l o" should become "hello"
 */
function fixUtf16LeEncoding(text) {
  if (typeof text !== 'string') return text;

  // Count null characters (UTF-16LE artifact)
  let nullCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0) nullCount++;
  }
  if (nullCount < text.length * 0.2) return text;

  // Remove all null characters
  let result = '';
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 0) {
      result += text[i];
    }
  }

  return result;
}

/**
 * Recursively fix encoding in all strings of an object
 */
function fixEncodingInObject(obj) {
  if (typeof obj === 'string') {
    return fixUtf16LeEncoding(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(fixEncodingInObject);
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = fixEncodingInObject(value);
    }
    return result;
  }
  return obj;
}

function normalizePiThinkingLevel(value) {
  // mimo-v2.5-pro only supports 'low', 'medium', 'high'
  const mapping = {
    'off': 'low',
    'minimal': 'low',
    'low': 'low',
    'medium': 'medium',
    'high': 'high',
    'xhigh': 'high',
  };
  return mapping[value] || 'medium';
}

function splitProviderModel(value) {
  const text = asOptionalString(value);
  if (!text) return undefined;
  const slashIndex = text.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= text.length - 1) return undefined;
  return {
    provider: text.slice(0, slashIndex).trim(),
    modelId: text.slice(slashIndex + 1).trim(),
  };
}

function resolveConfiguredModel(modelRegistry, providerValue, modelValue) {
  const configuredProvider = asOptionalString(providerValue);
  const configuredModel = asOptionalString(modelValue);
  if (!configuredModel) {
    throw new Error('请先在 Agent 设置中填写 Pi 模型。');
  }

  const candidates = [];
  if (configuredProvider) {
    candidates.push({
      provider: configuredProvider,
      modelId: configuredModel,
      label: `${configuredProvider}/${configuredModel}`,
    });
  }

  const split = splitProviderModel(configuredModel);
  if (split) {
    const duplicate = candidates.some(
      (candidate) => candidate.provider === split.provider && candidate.modelId === split.modelId,
    );
    if (!duplicate) {
      candidates.push({
        provider: split.provider,
        modelId: split.modelId,
        label: `${split.provider}/${split.modelId}`,
      });
    }
  }

  for (const candidate of candidates) {
    try {
      const model = modelRegistry.find(candidate.provider, candidate.modelId);
      if (model) return model;
    } catch {
      // Try the next candidate and report a single clear error below.
    }
  }

  const display = candidates.map((candidate) => candidate.label).join(' 或 ') || configuredModel;
  throw new Error(`找不到 Pi 模型 ${display}。请检查 Agent 设置中的 provider 和模型，模型可填写 model-id 或 provider/model-id。`);
}

/**
 * Create an ExtensionUIContext that bridges to the existing stdin/stdout protocol.
 * This handles tool questions (select, confirm, input) by emitting question events
 * and waiting for responses from the Rust process.
 */
function createBridgeUIContext(requestId) {
  return {
    async select(title, options, opts) {
      const questionId = randomUUID();
      const normalizedOptions = Array.isArray(options) && options.length > 0
        ? options.slice(0, 8).map((opt, index) => ({
            label: typeof opt === 'string' ? opt : (opt?.label ?? opt?.value ?? `选项 ${index + 1}`),
            description: typeof opt === 'string' ? opt : (opt?.description ?? opt?.value ?? opt?.label ?? `选项 ${index + 1}`),
          }))
        : [
            { label: '确认', description: '确认此请求。' },
            { label: '取消', description: '取消此请求。' },
          ];

      const question = {
        id: questionId,
        requestId,
        toolName: 'PiExtensionUI',
        toolUseId: questionId,
        kind: 'ask-user-question',
        title: opts?.title ?? title,
        ...(opts?.description ? { description: opts.description } : {}),
        questions: [{
          question: title,
          header: 'Pi',
          options: normalizedOptions,
          multiSelect: false,
        }],
      };

      emitToolQuestion(requestId, question);
      const response = await waitForToolResponse(questionId);
      const answer = normalizeAnswerArray(response?.answers?.[title]);
      const selected = answer[0] || '';

      if (selected.includes('取消')) {
        return undefined;
      }

      // Find the matching option value
      for (const opt of normalizedOptions) {
        if (opt.label === selected) {
          return opt.label;
        }
      }
      return selected || undefined;
    },

    async confirm(title, message, opts) {
      const questionId = randomUUID();
      const question = {
        id: questionId,
        requestId,
        toolName: 'PiExtensionUI',
        toolUseId: questionId,
        kind: 'permission',
        title: opts?.title ?? title,
        ...(opts?.description ? { description: opts.description } : {}),
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

      emitToolQuestion(requestId, question);
      const response = await waitForToolResponse(questionId);
      const answer = normalizeAnswerArray(response?.answers?.[question.questions[0].question]);
      const selected = answer[0] || '';
      return selected.includes('确认') || selected.includes('允许');
    },

    async input(title, placeholder, opts) {
      const questionId = randomUUID();
      const message = opts?.description ?? '';
      const prefill = placeholder ?? '';
      const question = {
        id: questionId,
        requestId,
        toolName: 'PiExtensionUI',
        toolUseId: questionId,
        kind: 'ask-user-question',
        title: opts?.title ?? title,
        ...(message || prefill ? { description: [message, prefill ? `默认内容: ${prefill}` : ''].filter(Boolean).join('\n') } : {}),
        questions: [{
          question: title,
          header: '输入',
          options: [
            { label: '提交默认值', description: prefill || message || '提交空内容。' },
            { label: '取消', description: '取消这次输入请求。' },
          ],
          multiSelect: false,
        }],
      };

      emitToolQuestion(requestId, question);
      const response = await waitForToolResponse(questionId);
      const answer = normalizeAnswerArray(response?.answers?.[title]);
      const selected = answer[0] || '';

      if (selected.includes('取消')) {
        return undefined;
      }

      return prefill || undefined;
    },

    notify(message, type) {
      emitPart(requestId, 'status', message, 'Pi');
    },

    setStatus(key, text) {
      if (text) {
        emitPart(requestId, 'status', text, 'Pi');
      }
    },

    // Unused but required by interface
    onTerminalInput() { return () => {}; },
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setWidget() {},
  };
}

export async function runPi(input, logger) {
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
  // agentDir defaults to ~/.pi/agent, consistent with Pi SDK's default behavior
  const agentDir = join(homedir(), '.pi', 'agent');

  const customEnv = parseCustomEnv(piSettings.customEnvText);
  // Apply custom environment variables
  for (const [key, value] of Object.entries(customEnv)) {
    process.env[key] = value;
  }
  process.env.PI_CODING_AGENT_CLIENT_APP = 'wimipet';
  process.env.LANG = 'en_US.UTF-8';
  process.env.LC_ALL = 'en_US.UTF-8';

  // Create auth storage (reads ~/.pi/agent/auth.json)
  const authStorage = await AuthStorage.create();

  // Create model registry
  const modelRegistry = await ModelRegistry.create(authStorage);

  const model = resolveConfiguredModel(modelRegistry, piSettings.provider, piSettings.model);

  // Create settings manager — load from ~/.pi/agent/settings.json so shellPath etc. take effect
  const settingsManager = SettingsManager.create(workspaceDir, agentDir);
  settingsManager.applyOverrides({
    compaction: { enabled: piSettings.autoCompactionEnabled !== false },
    retry: { enabled: piSettings.autoRetryEnabled !== false },
  });

  // Create session manager
  let sessionManager;
  const piSessionFile = asOptionalString(providerState.piSessionFile);
  if (piSessionFile) {
    sessionManager = SessionManager.open(piSessionFile);
  } else if (piSettings.useNoSession) {
    sessionManager = SessionManager.inMemory(workspaceDir);
  } else {
    sessionManager = SessionManager.create(workspaceDir);
  }

  // Create resource loader
  let systemPrompt = '';
  try {
    const soulContent = readFileSync(join(workspaceDir, 'SOUL.md'), 'utf-8');
    systemPrompt = `<SOUL>\n${soulContent}\n</SOUL>`;
  } catch {}

  // Append INSTRUCTION.md if memory is enabled
  if (settings.memoryEnabled) {
    try {
      const appDir = join(homedir(), '.wimipet');
      const instructionPath = join(appDir, 'prompts', 'INSTRUCTION.md');
      const instructionContent = readFileSync(instructionPath, 'utf-8');
      systemPrompt += `\n\n${instructionContent}`;
    } catch {}
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd: workspaceDir,
    agentDir,
    settingsManager,
    extensionFactories: [(pi) => extraPromptExtension(pi, logger)],
    systemPrompt,
  });
  await resourceLoader.reload();

  // Create the agent session
  const resolvedThinkingLevel = normalizePiThinkingLevel(piSettings.thinkingLevel);
  console.log('[run-pi] createAgentSession config:', JSON.stringify({
    model: { id: model?.id, name: model?.name, provider: model?.provider },
    thinkingLevel: resolvedThinkingLevel,
    workspaceDir,
    agentDir,
    useNoSession: piSettings.useNoSession ?? false,
    piSessionFile: asOptionalString(providerState.piSessionFile) ?? null,
    autoCompactionEnabled: piSettings.autoCompactionEnabled !== false,
    autoRetryEnabled: piSettings.autoRetryEnabled !== false,
  }));
  const { session, extensionsResult } = await createAgentSession({
    model,
    thinkingLevel: resolvedThinkingLevel,
    sessionManager,
    resourceLoader,
    settingsManager,
  });

  // Set up the bridge UI context for tool questions
  const uiContext = createBridgeUIContext(requestId);
  extensionsResult.runtime.setUIContext?.(uiContext);

  // Set up abort handler
  setActiveAbortHandler(() => {
    session.abort().catch(() => {});
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

  // Subscribe to session events
  const unsubscribe = session.subscribe((event) => {
    switch (event.type) {
      case 'agent_start':
        emit({ type: 'status', requestId, status: 'started' });
        return;

      case 'message_update': {
        const delta = event.assistantMessageEvent ?? {};
        if (delta.type === 'text_delta' && typeof delta.delta === 'string') {
          sawTextDelta = true;
          const fixedText = fixUtf16LeEncoding(delta.delta);
          emit({ type: 'delta', requestId, text: fixedText });
          return;
        }
        if (delta.type === 'thinking_delta' && typeof delta.delta === 'string') {
          const fixedText = fixUtf16LeEncoding(delta.delta);
          emitPart(requestId, 'thinking', fixedText, '思考');
          return;
        }
        if (delta.type === 'toolcall_end' && delta.toolCall) {
          const toolName = asOptionalString(delta.toolCall.name) ?? 'tool';
          const fixedToolCall = fixEncodingInObject(delta.toolCall);
          const trace = toolTraceFromToolUse(toolName, 'input', fixedToolCall.args ?? fixedToolCall, {
            id: asOptionalString(fixedToolCall.id) ?? randomUUID(),
            partial: false,
          });
          emitPart(requestId, partKindForToolTrace(trace), stringifyBrief(fixedToolCall.args ?? fixedToolCall), toolTraceTitle(trace), trace);
        }
        return;
      }

      case 'message_end': {
        if (event.message?.role !== 'assistant' || completed) return;
        if (event.message.stopReason === 'error') {
          completed = true;
          emit({
            type: 'error',
            requestId,
            error: asOptionalString(event.message.errorMessage) ?? 'Pi 请求失败。',
          });
          settleDone();
          return;
        }
        if (event.message.stopReason === 'aborted') {
          completed = true;
          emit({ type: 'cancelled', requestId });
          settleDone();
          return;
        }
        return;
      }

      case 'tool_execution_start': {
        const toolName = asOptionalString(event.toolName) ?? 'tool';
        const fixedArgs = fixEncodingInObject(event.args);
        const trace = toolTraceFromToolUse(toolName, 'input', fixedArgs, {
          id: toolIdForEvent(event, toolName, true),
          partial: true,
        });
        emitPart(requestId, partKindForToolTrace(trace), stringifyBrief(fixedArgs), toolTraceTitle(trace), trace);
        return;
      }

      case 'tool_execution_update': {
        const toolName = asOptionalString(event.toolName) ?? 'tool';
        const output = textFromToolResult(event.partialResult);
        const fixedOutput = fixUtf16LeEncoding(output);
        const fixedPartialResult = fixEncodingInObject(event.partialResult);
        const trace = toolTraceFromToolUse(toolName, 'update', fixedOutput || fixedPartialResult, {
          id: toolIdForEvent(event, toolName, false),
          partial: true,
        });
        emitPart(requestId, partKindForToolTrace(trace), fixedOutput, toolTraceTitle(trace), trace);
        return;
      }

      case 'tool_execution_end': {
        const toolName = asOptionalString(event.toolName) ?? 'tool';
        const output = textFromToolResult(event.result);
        const fixedOutput = fixUtf16LeEncoding(output);
        const fixedResult = fixEncodingInObject(event.result);
        const trace = toolTraceFromToolUse(toolName, 'output', fixedOutput || fixedResult, {
          id: toolIdForEvent(event, toolName, false),
          error: event.isError ? fixedOutput || '工具执行失败' : undefined,
          partial: false,
        });
        emitPart(requestId, partKindForToolTrace(trace), fixedOutput, toolTraceTitle(trace), trace);
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
          settleError(new Error(event.finalError || 'Pi auto retry failed'));
        }
        return;

      case 'agent_end':
        if (completed) return;
        completed = true;
        // Get session state
        lastProviderState = {
          ...lastProviderState,
          ...(session.sessionId ? { piSessionId: session.sessionId } : {}),
          ...(session.sessionFile ? { piSessionFile: session.sessionFile } : {}),
        };
        emit({ type: 'session', requestId, providerState: lastProviderState });
        emit({ type: 'done', requestId, providerState: lastProviderState });
        settleDone();
        return;

      default:
    }
  });

  emit({ type: 'status', requestId, status: 'started' });

  try {
    // Build and send the prompt
    const skillNotice = createDisabledSkillNotice('Pi', piSettings, input.allSkillNames);
    const promptText = [skillNotice, buildPrompt(input, attachments)].filter(Boolean).join('\n\n');

    await session.prompt(promptText);

    await donePromise;

    if (!sawTextDelta && completed) {
      // Pi may finish after a purely tool-driven turn; ChatRuntime will render a status fallback.
    }
  } catch (error) {
    // Log full error stack
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('[run-pi] Error:', errorMessage);
    if (errorStack) {
      console.error('[run-pi] Stack:', errorStack);
    }
    throw new Error(errorMessage);
  } finally {
    setActiveAbortHandler(null);
    unsubscribe();
    session.dispose();
  }
}

function textFromToolResult(result) {
  if (!result || typeof result !== 'object') return stringifyBrief(result);
  if (Array.isArray(result.content)) {
    const text = result.content
      .map((item) => (typeof item?.text === 'string' ? fixUtf16LeEncoding(item.text) : ''))
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }
  if (typeof result.text === 'string') return fixUtf16LeEncoding(result.text);
  if (typeof result.output === 'string') return fixUtf16LeEncoding(result.output);
  return stringifyBrief(result);
}

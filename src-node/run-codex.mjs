import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

import {
  normalizeAttachments,
  attachmentDirectories,
  buildPrompt,
  asOptionalString,
  parseCustomEnv,
  stringifyBrief,
  emit,
  emitPart,
  emitToolQuestion,
  waitForToolResponse,
  normalizeAnswerArray,
  setActiveRequestId,
  setActiveAbortHandler,
  getActiveRequestId,
} from './claude-runner.mjs';
import { execText, wherePaths, spawnExecutable, findExecutable, createDisabledSkillNotice } from './runner-utils.mjs';

export function findCodexExecutable() {
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

  return findExecutable(candidates);
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
    requestId: getActiveRequestId(),
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

export async function runCodex(input) {
  const settings = input.settings ?? {};
  const codexSettings = settings.codex ?? {};
  const providerState = input.providerState ?? {};
  const requestId = input.requestId;
  const attachments = normalizeAttachments(input.attachments);
  setActiveRequestId(requestId);

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
  setActiveAbortHandler(() => { try { child.kill(); } catch {} });

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

    const skillNotice = createDisabledSkillNotice('Codex', codexSettings, input.allSkillNames);
    await rpc.request('turn/start', {
      threadId: currentThreadId,
      input: [{ type: 'text', text: [skillNotice, buildPrompt(input, attachments)].filter(Boolean).join('\n\n') }],
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
    setActiveAbortHandler(null);
    await rpc.shutdown();
    await rpc.dispose();
  }
}

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';

let activeRequestId = 'unknown';
const MAX_INLINE_ATTACHMENT_BYTES = 256 * 1024;

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
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
      const path = asOptionalString(item?.path);
      if (!path) return undefined;
      return {
        path: normalize(path),
        name: asOptionalString(item?.name) ?? fileNameFromPath(path),
      };
    })
    .filter(Boolean);
}

function attachmentDirectories(attachments) {
  const directories = new Set();
  for (const attachment of attachments) {
    const stat = statPath(attachment.path);
    if (!stat) continue;
    directories.add(stat.isDirectory() ? attachment.path : dirname(attachment.path));
  }
  return [...directories];
}

function isTextBuffer(buffer) {
  return !buffer.includes(0);
}

function renderAttachmentContext(attachment) {
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
        const userText = prompt || '请查看这些上传文件。';
        return `${userText}\n\n用户上传了以下文件，作为本轮聊天上下文。小文本文件内容已直接附在下面；其它文件请按路径读取。\n\n${context}`;
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
      ...execText('where.exe', ['claude'])
        .split(/\r?\n/)
        .map((path) => path.trim())
        .filter((path) => path && !path.includes('WindowsApps') && !path.endsWith('.cmd') && !path.endsWith('.ps1')),
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

async function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const settings = input.settings ?? {};
  const providerState = input.providerState ?? {};
  const requestId = input.requestId;
  const attachments = normalizeAttachments(input.attachments);
  activeRequestId = requestId;
  let sawTextDelta = false;
  let lastSessionId = asOptionalString(providerState.claudeSessionId);

  const workspaceDir = asOptionalString(input.paths?.workspaceDir) ?? process.cwd();
  const claudeDir = asOptionalString(input.paths?.claudeDir);
  const additionalDirectories = attachmentDirectories(attachments);
  const customEnv = parseCustomEnv(settings.customEnvText);
  const options = {
    includePartialMessages: true,
    permissionMode: settings.permissionMode || 'default',
    settingSources: ['project', 'local'],
    cwd: workspaceDir,
    env: {
      ...process.env,
      ...customEnv,
      ...(claudeDir ? { CLAUDE_CONFIG_DIR: claudeDir } : {}),
      CLAUDE_AGENT_SDK_CLIENT_APP: 'mypets',
    },
  };

  if (additionalDirectories.length > 0) {
    options.additionalDirectories = additionalDirectories;
  }

  if (settings.permissionMode === 'bypassPermissions') {
    options.allowDangerouslySkipPermissions = true;
  }

  const executable = asOptionalString(settings.pathToClaudeCodeExecutable) ?? findClaudeExecutable();
  if (executable) options.pathToClaudeCodeExecutable = executable;

  if (settings.useUserSettings) {
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

main().catch((error) => {
  emit({
    type: 'error',
    requestId: activeRequestId,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

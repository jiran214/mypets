import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';

import {
  normalizeAttachments,
  attachmentDirectories,
  buildPrompt,
  asOptionalString,
  parseCustomEnv,
  canUseTool,
  emitAssistantParts,
  emitUserToolResultParts,
  emitSdkStatusPart,
  textDeltaFromStreamEvent,
  thinkingDeltaFromStreamEvent,
  emit,
  emitPart,
  getActiveRequestId,
  setActiveAbortHandler,
} from './runner.mjs';
import { execText, wherePaths, findExecutable } from './runner-utils.mjs';

function npmClaudePath() {
  const root = execText('npm', ['root', '-g']);
  return root ? join(root, '@anthropic-ai', 'claude-code', 'cli-wrapper.cjs') : '';
}

export function findClaudeExecutable() {
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

  return findExecutable(candidates);
}

export async function runClaude(input) {
  const settings = input.settings ?? {};
  const claudeSettings = settings.claude ?? {};
  const providerState = input.providerState ?? {};
  const requestId = input.requestId;
  const attachments = normalizeAttachments(input.attachments);
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
    skills: (() => {
      const disabled = Array.isArray(claudeSettings.disabledSkills) ? claudeSettings.disabledSkills : [];
      const allNames = Array.isArray(input.allSkillNames) ? input.allSkillNames : [];
      if (disabled.length === 0 || allNames.length === 0) return 'all';
      return allNames.filter((name) => !disabled.includes(name));
    })(),
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

  const ac = new AbortController();
  setActiveAbortHandler(() => ac.abort());

  try {
    for await (const message of query({ prompt: buildPrompt(input, attachments), options, abortSignal: ac.signal })) {
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

      if (message.type === 'user') {
        emitUserToolResultParts(requestId, message);
        continue;
      }

      if (message.type === 'result') {
        if (!sawTextDelta && !message.is_error && typeof message.result === 'string') {
          emit({ type: 'delta', requestId, text: message.result });
        }

        if (message.is_error) {
          const detail = Array.isArray(message.errors) ? message.errors.join('\n') : 'Claude request failed';
          emit({ type: 'error', requestId, error: detail });
        } else if (!sawTextDelta && typeof message.result !== 'string') {
          emit({ type: 'error', requestId, error: 'Claude 没有返回任何内容，可能是工作空间路径包含特殊字符导致的。' });
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
  } finally {
    setActiveAbortHandler(null);
  }
}

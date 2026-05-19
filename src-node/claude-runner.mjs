import { readFileSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';

let activeRequestId = 'unknown';

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function asOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function textFromAssistant(message) {
  const content = message?.message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function textDeltaFromStreamEvent(event) {
  if (event?.type !== 'content_block_delta') return '';
  const delta = event.delta;
  if (delta?.type !== 'text_delta' || typeof delta.text !== 'string') return '';
  return delta.text;
}

async function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const settings = input.settings ?? {};
  const providerState = input.providerState ?? {};
  const requestId = input.requestId;
  activeRequestId = requestId;
  let sawTextDelta = false;
  let lastSessionId = asOptionalString(providerState.claudeSessionId);

  const options = {
    includePartialMessages: true,
    permissionMode: settings.permissionMode || 'default',
    settingSources: settings.useProjectSettings ? ['user', 'project', 'local'] : ['user'],
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: input.paths.claudeConfigDir,
      CLAUDE_AGENT_SDK_CLIENT_APP: 'mypets',
    },
  };

  const cwd = asOptionalString(settings.cwd);
  if (cwd) options.cwd = cwd;

  const model = asOptionalString(settings.model);
  if (model) options.model = model;

  const executable = asOptionalString(settings.pathToClaudeCodeExecutable);
  if (executable) options.pathToClaudeCodeExecutable = executable;

  if (Number.isInteger(settings.maxTurns) && settings.maxTurns > 0) {
    options.maxTurns = settings.maxTurns;
  }

  const systemPrompt = asOptionalString(settings.systemPrompt);
  if (systemPrompt) options.systemPrompt = systemPrompt;

  if (lastSessionId) {
    options.resume = lastSessionId;
  }

  emit({ type: 'status', requestId, status: 'started' });

  for await (const message of query({ prompt: input.prompt, options })) {
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
      continue;
    }

    if (message.type === 'assistant' && !sawTextDelta) {
      const text = textFromAssistant(message);
      if (text) {
        sawTextDelta = true;
        emit({ type: 'delta', requestId, text });
      }
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
    }
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

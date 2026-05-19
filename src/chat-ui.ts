import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import type { ChatRuntime } from './chat-runtime';

type Size = { width: number; height: number };

export interface ChatBubbleController {
  resolvePetWindowSize: (base: Size) => Size;
  close: () => void;
}

export function mountChatUi(root: HTMLElement, runtime: ChatRuntime, compact = false): void {
  root.innerHTML = `
    <div class="chat-panel ${compact ? 'chat-panel-compact' : ''}">
      <div class="chat-list" data-chat-list></div>
      <form class="chat-form" data-chat-form>
        <textarea class="chat-input" data-chat-input rows="2" placeholder="输入消息"></textarea>
        <button class="chat-send" type="submit">发送</button>
      </form>
      <div class="chat-status" data-chat-status></div>
    </div>
  `;

  const list = root.querySelector<HTMLElement>('[data-chat-list]')!;
  const form = root.querySelector<HTMLFormElement>('[data-chat-form]')!;
  const input = root.querySelector<HTMLTextAreaElement>('[data-chat-input]')!;
  const sendButton = root.querySelector<HTMLButtonElement>('.chat-send')!;
  const status = root.querySelector<HTMLElement>('[data-chat-status]')!;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value;
    input.value = '';
    void runtime.send(value);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  runtime.subscribe(() => {
    const conversation = runtime.getConversation();
    list.innerHTML = conversation.messages
      .map((message) => {
        const role = message.role === 'user' ? '你' : 'Claude';
        const classes = ['chat-message', `chat-message-${message.role}`];
        if (message.error) classes.push('chat-message-error');
        if (message.pending) classes.push('chat-message-pending');
        return `
          <div class="${classes.join(' ')}">
            <div class="chat-message-role">${role}</div>
            <div class="chat-message-text">${escapeHtml(message.text)}</div>
          </div>
        `;
      })
      .join('');

    const isStreaming = runtime.isStreaming();
    sendButton.disabled = isStreaming || !input.value.trim();
    input.disabled = isStreaming;
    status.textContent = runtime.getStatusText();
    list.scrollTop = list.scrollHeight;
  });

  input.addEventListener('input', () => {
    sendButton.disabled = runtime.isStreaming() || !input.value.trim();
  });
}

export function setupChatBubble(stage: HTMLElement, canvas: HTMLCanvasElement): ChatBubbleController {
  const bubble = document.getElementById('chat-bubble') as HTMLElement;
  const win = getCurrentWindow();
  let open = false;
  let pointerStart: { x: number; y: number } | null = null;

  const resolvePetWindowSize = (base: Size): Size => {
    if (!open) return base;
    return {
      width: base.width + 332,
      height: Math.max(base.height, 372),
    };
  };

  const syncWindowSize = (): void => {
    const base = { width: stage.offsetWidth, height: stage.offsetHeight };
    const size = resolvePetWindowSize(base);
    void win.setSize(new LogicalSize(size.width, size.height));
  };

  const setOpen = (next: boolean): void => {
    open = next;
    bubble.hidden = !open;
    syncWindowSize();
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointerStart = { x: event.screenX, y: event.screenY };
  });

  canvas.addEventListener('pointerup', (event) => {
    if (event.button !== 0 || !pointerStart) return;
    const dx = event.screenX - pointerStart.x;
    const dy = event.screenY - pointerStart.y;
    pointerStart = null;
    if (Math.hypot(dx, dy) > 6) return;
    setOpen(!open);
  });

  document.addEventListener('close-chat-bubble', () => setOpen(false));

  return {
    resolvePetWindowSize,
    close: () => setOpen(false),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('\n', '<br>');
}

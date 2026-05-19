import { getCurrentWindow, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import type { ChatRuntime } from './chat-runtime';
import type { ChatMessagePart } from './ai-types';

type Size = { width: number; height: number };
type BubbleLayout = Size & { petOffsetX: number; petOffsetY: number };
const BUBBLE_WIDTH = 340;
const BUBBLE_HEIGHT = 300;
const BUBBLE_GAP = 4;

export interface ChatBubbleController {
  resolvePetWindowSize: (base: Size) => Size;
  close: () => void;
}

export function mountChatUi(root: HTMLElement, runtime: ChatRuntime, compact = false): void {
  root.innerHTML = `
    <div class="chat-panel ${compact ? 'chat-panel-compact' : ''}">
      ${compact ? '<div class="chat-panel-header"><span>聊天</span><button class="chat-close" type="button" aria-label="关闭聊天">×</button></div>' : ''}
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
  const closeButton = root.querySelector<HTMLButtonElement>('.chat-close');

  closeButton?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('close-chat-bubble'));
  });

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
        const classes = ['chat-message', `chat-message-${message.role}`];
        if (message.error) classes.push('chat-message-error');
        if (message.pending) classes.push('chat-message-pending');
        return `
          <div class="${classes.join(' ')}">
            <div class="chat-message-body">${message.parts.map(renderPart).join('')}</div>
          </div>
        `;
      })
      .join('');

    const isStreaming = runtime.isStreaming();
    sendButton.disabled = isStreaming || !input.value.trim() || !runtime.hasWorkspace();
    input.disabled = isStreaming;
    status.textContent = runtime.getStatusText() || (runtime.hasWorkspace() ? '' : '请先选择桌宠工作空间');
    list.scrollTop = list.scrollHeight;
  });

  input.addEventListener('input', () => {
    sendButton.disabled = runtime.isStreaming() || !input.value.trim() || !runtime.hasWorkspace();
  });
}

export function setupChatBubble(stage: HTMLElement, canvas: HTMLCanvasElement): ChatBubbleController {
  const bubble = document.getElementById('chat-bubble') as HTMLElement;
  const win = safeCurrentWindow();
  let open = false;
  let pointerStart: { x: number; y: number } | null = null;

  const currentPetSize = (): Size => ({
    width: canvas.offsetWidth || canvas.width,
    height: canvas.offsetHeight || canvas.height,
  });

  const createLayout = (base: Size, withBubble: boolean): BubbleLayout => {
    if (!withBubble) {
      return { ...base, petOffsetX: 0, petOffsetY: 0 };
    }

    const petOffsetX = Math.max(0, Math.round((BUBBLE_WIDTH - base.width) / 2));
    const petOffsetY = BUBBLE_HEIGHT + BUBBLE_GAP;
    return {
      width: Math.max(base.width, BUBBLE_WIDTH),
      height: base.height + petOffsetY,
      petOffsetX,
      petOffsetY,
    };
  };

  const applyBubbleLayout = (layout: BubbleLayout, petSize: Size): void => {
    stage.style.setProperty('--pet-offset-x', `${layout.petOffsetX}px`);
    stage.style.setProperty('--pet-offset-y', `${layout.petOffsetY}px`);
    stage.style.setProperty('--bubble-left', `${layout.petOffsetX + petSize.width / 2}px`);
    stage.style.setProperty('--bubble-height', `${BUBBLE_HEIGHT}px`);
    stage.style.setProperty('--bubble-gap', `${BUBBLE_GAP}px`);
  };

  const resolvePetWindowSize = (base: Size): Size => {
    const petSize = base.width > 0 && base.height > 0 ? base : currentPetSize();
    const layout = createLayout(petSize, open);
    applyBubbleLayout(layout, petSize);
    return { width: layout.width, height: layout.height };
  };

  const syncWindowFrame = (previousLayout: BubbleLayout, nextLayout: BubbleLayout): void => {
    if (!win) return;

    void Promise.all([win.outerPosition(), win.scaleFactor()])
      .then(([position, scaleFactor]) => {
        const dx = Math.round((previousLayout.petOffsetX - nextLayout.petOffsetX) * scaleFactor);
        const dy = Math.round((previousLayout.petOffsetY - nextLayout.petOffsetY) * scaleFactor);
        const updates: Promise<void>[] = [win.setSize(new LogicalSize(nextLayout.width, nextLayout.height))];
        if (dx !== 0 || dy !== 0) {
          updates.push(win.setPosition(new PhysicalPosition(position.x + dx, position.y + dy)));
        }
        return Promise.all(updates);
      })
      .catch((error) => {
        console.warn('Failed to sync chat bubble window:', error);
      });
  };

  const setOpen = (next: boolean, syncFrame = true): void => {
    if (next === open) return;
    const petSize = currentPetSize();
    const previousLayout = createLayout(petSize, open);
    const nextLayout = createLayout(petSize, next);
    open = next;
    bubble.hidden = !open;
    stage.classList.toggle('chat-open', open);
    applyBubbleLayout(nextLayout, petSize);
    if (syncFrame) {
      syncWindowFrame(previousLayout, nextLayout);
    }
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

  document.addEventListener('close-chat-bubble', (event) => {
    const syncFrame = !(event instanceof CustomEvent) || event.detail?.syncFrame !== false;
    setOpen(false, syncFrame);
  });

  return {
    resolvePetWindowSize,
    close: () => setOpen(false),
  };
}

function safeCurrentWindow(): ReturnType<typeof getCurrentWindow> | null {
  try {
    return getCurrentWindow();
  } catch (error) {
    console.warn('Tauri window controls are unavailable outside Tauri:', error);
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderPart(part: ChatMessagePart): string {
  const title = part.title ? `<div class="chat-part-title">${escapeHtml(part.title)}</div>` : '';
  return `
    <div class="chat-part chat-part-${part.kind}">
      ${title}
      <div class="chat-part-text">${renderInlineText(part.text)}</div>
    </div>
  `;
}

function renderInlineText(value: string): string {
  const pattern = /([A-Za-z]:\\[^\s<>"']+|(?:\.{1,2}\/|\/)[^\s<>"']+)/g;
  let result = '';
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const path = match[0];
    result += escapeHtml(value.slice(lastIndex, match.index));
    result += `<span class="chat-path-chip">${escapeHtml(path)}</span>`;
    lastIndex = (match.index ?? 0) + path.length;
  }
  result += escapeHtml(value.slice(lastIndex));
  return result.replaceAll('\n', '<br>');
}

import { getCurrentWindow, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import type { ChatRuntime } from './chat-runtime';
import type { AiSessionSummary, ChatAttachment, ChatMessagePart, ChatPartKind } from './ai-types';

type Size = { width: number; height: number };
type BubbleLayout = Size & { petOffsetX: number; petOffsetY: number; bubbleTop: number };
const BUBBLE_WIDTH = 340;
const BUBBLE_HEIGHT = 640;
const BUBBLE_GAP = 5;

export interface ChatBubbleController {
  resolvePetWindowSize: (base: Size) => Size;
  close: () => void;
}

export function mountChatUi(root: HTMLElement, runtime: ChatRuntime, compact = false): void {
  root.innerHTML = `
    <div class="chat-panel ${compact ? 'chat-panel-compact' : ''}">
      <div class="chat-panel-header">
        <span class="chat-title" data-chat-title></span>
        <div class="chat-header-actions">
          <button class="chat-icon-button" data-chat-history-toggle type="button" title="对话历史" aria-label="对话历史">◷</button>
          <button class="chat-icon-button" data-chat-new type="button" title="新对话" aria-label="新对话">＋</button>
          ${compact ? '<button class="chat-icon-button chat-close" type="button" title="关闭" aria-label="关闭聊天">×</button>' : ''}
        </div>
        <div class="chat-history-popover" data-chat-history hidden>
          <div class="chat-history-list" data-chat-history-list></div>
        </div>
      </div>
      <div class="chat-list" data-chat-list></div>
      <form class="chat-form" data-chat-form>
        <div class="chat-input-shell" data-chat-drop-zone>
          <div class="chat-attachments" data-chat-attachments hidden></div>
          <div class="chat-input-row">
            <textarea class="chat-input" data-chat-input rows="1" placeholder="输入消息"></textarea>
          </div>
          <div class="chat-input-actions">
            <button class="chat-attach-trigger" data-chat-attach-trigger type="button" title="添加文件" aria-label="添加文件">＋</button>
            <button class="chat-send" type="submit" title="发送" aria-label="发送"></button>
          </div>
          <div class="chat-attachment-menu" data-chat-attachment-menu hidden>
            <button class="chat-attachment-menu-item" data-chat-pick-file type="button">
              <span class="chat-file-icon" aria-hidden="true"></span>
              <strong>上传文件</strong>
            </button>
          </div>
        </div>
      </form>
      <div class="chat-status" data-chat-status></div>
    </div>
  `;

  const list = root.querySelector<HTMLElement>('[data-chat-list]')!;
  const form = root.querySelector<HTMLFormElement>('[data-chat-form]')!;
  const dropZone = root.querySelector<HTMLElement>('[data-chat-drop-zone]')!;
  const input = root.querySelector<HTMLTextAreaElement>('[data-chat-input]')!;
  const sendButton = root.querySelector<HTMLButtonElement>('.chat-send')!;
  const attachTrigger = root.querySelector<HTMLButtonElement>('[data-chat-attach-trigger]')!;
  const attachmentMenu = root.querySelector<HTMLElement>('[data-chat-attachment-menu]')!;
  const pickFileButton = root.querySelector<HTMLButtonElement>('[data-chat-pick-file]')!;
  const attachmentsRoot = root.querySelector<HTMLElement>('[data-chat-attachments]')!;
  const title = root.querySelector<HTMLElement>('[data-chat-title]')!;
  const status = root.querySelector<HTMLElement>('[data-chat-status]')!;
  const historyToggle = root.querySelector<HTMLButtonElement>('[data-chat-history-toggle]')!;
  const newButton = root.querySelector<HTMLButtonElement>('[data-chat-new]')!;
  const historyPopover = root.querySelector<HTMLElement>('[data-chat-history]')!;
  const historyList = root.querySelector<HTMLElement>('[data-chat-history-list]')!;
  const closeButton = root.querySelector<HTMLButtonElement>('.chat-close');
  let historyOpen = false;
  let attachmentMenuOpen = false;
  let attachments: ChatAttachment[] = [];

  const updateSendDisabled = (): void => {
    sendButton.disabled = runtime.isStreaming() || (!input.value.trim() && attachments.length === 0) || !runtime.hasWorkspace();
  };

  const resizeInput = (): void => {
    const maxHeight = Number.parseFloat(getComputedStyle(input).maxHeight);
    input.style.height = 'auto';
    const nextHeight = Number.isFinite(maxHeight)
      ? Math.min(input.scrollHeight, maxHeight)
      : input.scrollHeight;
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > nextHeight ? 'auto' : 'hidden';
  };

  const setHistoryOpen = (next: boolean): void => {
    historyOpen = next;
    historyPopover.hidden = !historyOpen;
    historyToggle.classList.toggle('active', historyOpen);
  };

  const setAttachmentMenuOpen = (next: boolean): void => {
    attachmentMenuOpen = next;
    attachmentMenu.hidden = !attachmentMenuOpen;
    attachTrigger.classList.toggle('active', attachmentMenuOpen);
  };

  const renderAttachments = (): void => {
    attachmentsRoot.hidden = attachments.length === 0;
    attachmentsRoot.innerHTML = attachments
      .map((attachment) => `
        <span class="chat-file-chip" title="${escapeAttribute(attachment.path)}">
          <span class="chat-file-icon" aria-hidden="true"></span>
          <strong>${escapeHtml(attachment.name)}</strong>
          <button type="button" data-remove-attachment="${escapeAttribute(attachment.id)}" aria-label="移除 ${escapeAttribute(attachment.name)}">×</button>
        </span>
      `)
      .join('');
    updateSendDisabled();
  };

  const addAttachments = (paths: string[]): void => {
    const existingPaths = new Set(attachments.map((attachment) => attachment.path));
    const next = paths
      .map((path) => path.trim())
      .filter((path) => path && !existingPaths.has(path))
      .map((path) => ({
        id: crypto.randomUUID(),
        path,
        name: fileNameFromPath(path),
      }));

    if (next.length === 0) return;
    attachments = [...attachments, ...next];
    renderAttachments();
    input.focus();
  };

  const pickFiles = async (): Promise<void> => {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        title: '选择文件',
      });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      addAttachments(paths);
    } catch (error) {
      console.warn('Failed to pick chat attachment:', error);
      status.textContent = '无法选择文件';
    }
  };

  closeButton?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('close-chat-bubble'));
  });

  attachTrigger.addEventListener('click', (event) => {
    event.stopPropagation();
    setAttachmentMenuOpen(!attachmentMenuOpen);
  });

  pickFileButton.addEventListener('click', () => {
    setAttachmentMenuOpen(false);
    void pickFiles();
  });

  attachmentsRoot.addEventListener('click', (event) => {
    const removeButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove-attachment]');
    if (!removeButton) return;
    attachments = attachments.filter((attachment) => attachment.id !== removeButton.dataset.removeAttachment);
    renderAttachments();
  });

  document.addEventListener('click', (event) => {
    if (!attachmentMenuOpen) return;
    if (form.contains(event.target as Node)) return;
    setAttachmentMenuOpen(false);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && attachmentMenuOpen) {
      setAttachmentMenuOpen(false);
    }
  });

  historyToggle.addEventListener('click', async () => {
    if (!historyOpen) {
      setHistoryOpen(true);
      renderHistory(historyList, runtime.getSessions(), runtime.hasWorkspace());
      const sessions = await runtime.refreshSessions();
      renderHistory(historyList, sessions, runtime.hasWorkspace());
      return;
    }
    setHistoryOpen(false);
  });

  newButton.addEventListener('click', () => {
    runtime.startNewConversation();
    setHistoryOpen(false);
  });

  historyList.addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-session-id]');
    if (!item) return;

    const session = runtime.getSessions().find((entry) => entry.id === item.dataset.sessionId);
    if (!session) return;
    runtime.resumeConversation(session);
    setHistoryOpen(false);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value;
    const files = attachments;
    input.value = '';
    resizeInput();
    attachments = [];
    renderAttachments();
    void runtime.send(value, files);
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
        const parts = message.parts.map(renderPart).filter(Boolean).join('');
        return `
          <div class="${classes.join(' ')}">
            <div class="chat-message-body">${parts}</div>
          </div>
        `;
      })
      .join('');

    const isStreaming = runtime.isStreaming();
    title.textContent = runtime.getConversationTitle();
    title.title = runtime.getConversationTitle();
    updateSendDisabled();
    newButton.disabled = isStreaming;
    attachTrigger.disabled = isStreaming || !runtime.hasWorkspace();
    historyToggle.disabled = isStreaming || !runtime.hasWorkspace();
    input.disabled = isStreaming;
    status.textContent = runtime.getStatusText() || (runtime.hasWorkspace() ? '' : '请先选择桌宠工作空间');
    if (historyOpen) {
      renderHistory(historyList, runtime.getSessions(), runtime.hasWorkspace());
    }
    list.scrollTop = list.scrollHeight;
  });

  input.addEventListener('input', () => {
    updateSendDisabled();
    resizeInput();
  });

  try {
    void getCurrentWindow().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === 'enter' || payload.type === 'over') {
        dropZone.classList.add('drag-active');
        return;
      }
      dropZone.classList.remove('drag-active');
      if (payload.type === 'drop') {
        addAttachments(payload.paths);
        if (compact) {
          document.dispatchEvent(new CustomEvent('open-chat-bubble'));
        }
      }
    }).catch((error) => {
      console.warn('File drag and drop is unavailable outside Tauri:', error);
    });
  } catch (error) {
    console.warn('File drag and drop is unavailable outside Tauri:', error);
  }

  renderAttachments();
  resizeInput();
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
      return { ...base, petOffsetX: 0, petOffsetY: 0, bubbleTop: 0 };
    }

    const petOffsetX = Math.max(0, Math.round((BUBBLE_WIDTH - base.width) / 2));
    const petOffsetY = BUBBLE_HEIGHT + BUBBLE_GAP;
    return {
      width: Math.max(base.width, BUBBLE_WIDTH),
      height: base.height + petOffsetY,
      petOffsetX,
      petOffsetY,
      bubbleTop: 0,
    };
  };

  const applyBubbleLayout = (layout: BubbleLayout, petSize: Size): void => {
    stage.style.setProperty('--pet-offset-x', `${layout.petOffsetX}px`);
    stage.style.setProperty('--pet-offset-y', `${layout.petOffsetY}px`);
    stage.style.setProperty('--bubble-width', `${BUBBLE_WIDTH}px`);
    stage.style.setProperty('--bubble-left', `${layout.petOffsetX + petSize.width / 2}px`);
    stage.style.setProperty('--bubble-height', `${BUBBLE_HEIGHT}px`);
    stage.style.setProperty('--bubble-gap', `${BUBBLE_GAP}px`);
    stage.style.setProperty('--bubble-top', `${layout.bubbleTop}px`);
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

  document.addEventListener('open-chat-bubble', (event) => {
    const syncFrame = !(event instanceof CustomEvent) || event.detail?.syncFrame !== false;
    setOpen(true, syncFrame);
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

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderHistory(container: HTMLElement, sessions: AiSessionSummary[], hasWorkspace: boolean): void {
  if (!hasWorkspace) {
    container.innerHTML = '<div class="chat-history-empty">请先选择桌宠工作空间</div>';
    return;
  }

  if (sessions.length === 0) {
    container.innerHTML = '<div class="chat-history-empty">暂无历史对话</div>';
    return;
  }

  container.innerHTML = sessions
    .map((session) => `
      <button class="chat-history-item" type="button" data-session-id="${escapeAttribute(session.id)}">
        <strong>${escapeHtml(session.title || '历史对话')}</strong>
        <span>${formatSessionTime(session.updatedAt)}</span>
      </button>
    `)
    .join('');
}

function formatSessionTime(value: number): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function renderPart(part: ChatMessagePart): string {
  if (part.kind === 'status' && part.title === '会话') return '';

  if (shouldCollapsePart(part)) {
    const meta = partMeta(part.kind);
    const title = part.title || meta.label;
    return `
      <details class="chat-part chat-part-folded chat-part-${part.kind}">
        <summary>
          <span class="chat-part-badge">${escapeHtml(meta.badge)}</span>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(partPreview(part.text))}</span>
        </summary>
        <div class="chat-part-text">${renderInlineText(part.text)}</div>
      </details>
    `;
  }

  const meta = partMeta(part.kind);
  const title = part.title
    ? `<div class="chat-part-title"><span class="chat-part-badge">${escapeHtml(meta.badge)}</span>${escapeHtml(part.title)}</div>`
    : '';
  return `
    <div class="chat-part chat-part-${part.kind}">
      ${title}
      <div class="chat-part-text">${renderInlineText(part.text)}</div>
    </div>
  `;
}

function shouldCollapsePart(part: ChatMessagePart): boolean {
  return ['thinking', 'tool', 'mcp', 'skill'].includes(part.kind) && part.text.trim().length > 0;
}

function partPreview(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 72 ? `${compact.slice(0, 72)}...` : compact;
}

function partMeta(kind: ChatPartKind): { badge: string; label: string } {
  if (kind === 'thinking') return { badge: '思', label: '思考' };
  if (kind === 'tool') return { badge: '工具', label: '工具' };
  if (kind === 'mcp') return { badge: 'MCP', label: 'MCP 调用' };
  if (kind === 'skill') return { badge: 'Skill', label: 'Skill' };
  if (kind === 'plan') return { badge: '摘要', label: '摘要' };
  if (kind === 'status') return { badge: '状态', label: '状态' };
  if (kind === 'path') return { badge: '路径', label: '路径' };
  return { badge: '聊', label: '聊天' };
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

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

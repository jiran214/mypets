import {
  answerAiToolQuestion,
  cancelAiChatMessage,
  listenToAiChatEvents,
  listAiSessions,
  loadAiState,
  sendAiChatMessage,
} from './ai-api';
import type {
  AiChatEvent,
  AiSessionSummary,
  AiState,
  ChatAttachment,
  ChatMessagePart,
  ChatMessage,
  ClaudeProviderState,
  Conversation,
  ToolQuestionAnswerPayload,
  ToolQuestionPartData,
  ToolQuestionRequest,
} from './ai-types';

type Listener = () => void;

interface StoredConversation {
  title: string;
  conversation: Conversation;
}

export class ChatRuntime {
  private aiState: AiState | null = null;
  private workspaceFolder = '';
  private conversation: Conversation = {
    id: `conv-${Date.now()}`,
    providerId: 'claude',
    providerState: {},
    messages: [],
  };
  private conversationTitle = '';
  private currentRequestId: string | null = null;
  private currentAssistantId: string | null = null;
  private sessions: AiSessionSummary[] = [];
  private statusText = '';
  private cancellingRequestId: string | null = null;
  private listeners = new Set<Listener>();

  async init(): Promise<void> {
    await listenToAiChatEvents((event) => this.handleEvent(event));
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener();
    return () => this.listeners.delete(listener);
  }

  getAiState(): AiState | null {
    return this.aiState;
  }

  setAiState(state: AiState): void {
    this.aiState = state;
    this.notify();
  }

  getWorkspaceFolder(): string {
    return this.workspaceFolder;
  }

  hasWorkspace(): boolean {
    return Boolean(this.workspaceFolder);
  }

  async setWorkspace(folder: string): Promise<void> {
    if (folder === this.workspaceFolder) return;

    this.workspaceFolder = folder;
    this.aiState = folder ? await loadAiState(folder) : null;
    this.sessions = folder ? await this.loadSessions() : [];
    this.conversation = {
      id: `conv-${Date.now()}`,
      providerId: 'claude',
      providerState: {},
      messages: [],
    };
    this.conversationTitle = '';
    this.currentRequestId = null;
    this.currentAssistantId = null;
    this.cancellingRequestId = null;
    this.statusText = folder ? '' : '请先选择桌宠工作空间';
    this.notify();
  }

  getConversation(): Conversation {
    return this.conversation;
  }

  getConversationTitle(): string {
    return this.conversationTitle;
  }

  getSessions(): AiSessionSummary[] {
    return this.sessions;
  }

  getStatusText(): string {
    return this.statusText;
  }

  isStreaming(): boolean {
    return this.currentRequestId !== null;
  }

  startNewConversation(): void {
    if (this.currentRequestId) return;

    this.conversation = {
      id: `conv-${Date.now()}`,
      providerId: 'claude',
      providerState: {},
      messages: [],
    };
    this.conversationTitle = '';
    this.currentAssistantId = null;
    this.cancellingRequestId = null;
    this.statusText = this.workspaceFolder ? '' : '请先选择桌宠工作空间';
    this.notify();
  }

  resumeConversation(session: AiSessionSummary): void {
    if (this.currentRequestId) return;

    const stored = this.loadStoredConversation(session.id);
    this.conversation = stored?.conversation ?? {
      id: session.id,
      providerId: 'claude',
      providerState: session.providerState,
      messages: [],
    };
    this.conversation.providerState = {
      ...this.conversation.providerState,
      ...session.providerState,
    };
    this.conversationTitle = stored?.title || session.title || '';
    this.currentAssistantId = null;
    this.cancellingRequestId = null;
    this.statusText = '';
    this.notify();
  }

  async refreshSessions(): Promise<AiSessionSummary[]> {
    this.sessions = await this.loadSessions();
    this.notify();
    return this.sessions;
  }

  async send(text: string, attachments: ChatAttachment[] = []): Promise<void> {
    const prompt = text.trim();
    if ((!prompt && attachments.length === 0) || this.currentRequestId) return;
    if (!this.workspaceFolder) {
      this.statusText = '请先选择桌宠工作空间';
      this.notify();
      return;
    }

    const requestId = crypto.randomUUID();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [
        ...(prompt ? [{ id: crypto.randomUUID(), kind: 'text' as const, text: prompt }] : []),
        ...attachments.map((attachment) => ({
          id: crypto.randomUUID(),
          kind: attachment.kind === 'text' ? 'attachment' as const : 'path' as const,
          title: attachment.name,
          text: attachment.kind === 'text' ? attachment.text ?? '' : attachment.path ?? '',
        })),
      ],
    };
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      parts: [],
      pending: true,
    };

    this.currentRequestId = requestId;
    this.currentAssistantId = assistantMessage.id;
    this.cancellingRequestId = null;
    if (!this.conversationTitle) {
      this.conversationTitle = createTitle(prompt || attachments[0]?.name || '文件');
    }
    this.statusText = '正在连接 Claude...';
    this.conversation.messages.push(userMessage, assistantMessage);
    this.saveCurrentConversation();
    this.notify();

    try {
      await sendAiChatMessage({
        requestId,
        conversationId: this.conversation.id,
        workspaceFolder: this.workspaceFolder,
        prompt,
        attachments,
        providerState: this.conversation.providerState,
      });
    } catch (error) {
      this.finishWithError(error instanceof Error ? error.message : String(error));
    }
  }

  async interrupt(): Promise<void> {
    const requestId = this.currentRequestId;
    if (!requestId || this.cancellingRequestId === requestId) return;

    this.cancellingRequestId = requestId;
    this.statusText = '正在打断 Claude...';
    this.notify();

    try {
      await cancelAiChatMessage(requestId);
    } catch (error) {
      if (this.currentRequestId !== requestId) return;
      const message = error instanceof Error ? error.message : String(error);
      this.finishWithError(message || '打断 Claude 失败。');
    }
  }

  async answerToolQuestion(
    partId: string,
    questionId: string,
    response: ToolQuestionAnswerPayload,
  ): Promise<void> {
    if (!this.workspaceFolder) return;

    const request = this.updateToolQuestionPart(partId, (data) => ({
      ...data,
      status: 'submitting',
      response,
      error: undefined,
    }));
    if (!request) return;

    this.statusText = '已发送选择，等待 Claude 继续...';
    this.saveCurrentConversation();
    this.notify();

    try {
      await answerAiToolQuestion({
        requestId: request.requestId,
        questionId,
        response,
      });
      this.updateToolQuestionPart(partId, (data) => ({
        ...data,
        status: 'answered',
        response,
        error: undefined,
      }));
      this.saveCurrentConversation();
      this.notify();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateToolQuestionPart(partId, (data) => ({
        ...data,
        status: 'error',
        response,
        error: message || '发送回答失败。',
      }));
      this.statusText = message || '发送回答失败。';
      this.saveCurrentConversation();
      this.notify();
    }
  }

  private handleEvent(event: AiChatEvent): void {
    if (event.requestId !== this.currentRequestId) return;

    if (event.type === 'status') {
      this.statusText = event.status === 'started' ? 'Claude 正在回复...' : event.status;
      this.notify();
      return;
    }

    if (event.type === 'session') {
      this.mergeProviderState(event.providerState);
      this.saveCurrentConversation();
      this.notify();
      return;
    }

    if (event.type === 'delta') {
      const assistant = this.currentAssistant();
      if (!assistant) return;
      this.appendPart(assistant, { kind: 'text', text: event.text });
      assistant.pending = true;
      this.statusText = 'Claude 正在回复...';
      this.saveCurrentConversation();
      this.notify();
      return;
    }

    if (event.type === 'part') {
      const assistant = this.currentAssistant();
      if (!assistant) return;
      this.appendPart(assistant, event.part);
      assistant.pending = true;
      this.statusText = 'Claude 正在回复...';
      this.saveCurrentConversation();
      this.notify();
      return;
    }

    if (event.type === 'question') {
      const assistant = this.currentAssistant();
      if (!assistant) return;
      this.appendPart(assistant, {
        kind: 'question',
        title: event.question.title || questionTitle(event.question),
        text: JSON.stringify({
          ...event.question,
          status: 'pending',
        } satisfies ToolQuestionPartData),
      });
      assistant.pending = true;
      this.statusText = '你的选择';
      this.saveCurrentConversation();
      this.notify();
      return;
    }

    if (event.type === 'done') {
      if (event.providerState) {
        this.mergeProviderState(event.providerState);
      }
      this.finish();
      return;
    }

    if (event.type === 'cancelled') {
      this.finishCancelled();
      return;
    }

    this.finishWithError(event.error);
  }

  private mergeProviderState(providerState: ClaudeProviderState): void {
    this.conversation.providerState = {
      ...this.conversation.providerState,
      ...providerState,
    };
  }

  private currentAssistant(): ChatMessage | null {
    if (!this.currentAssistantId) return null;
    return this.conversation.messages.find((message) => message.id === this.currentAssistantId) ?? null;
  }

  private appendPart(message: ChatMessage, part: Omit<ChatMessagePart, 'id'>): void {
    const last = message.parts[message.parts.length - 1];
    if (last && last.kind === part.kind && last.title === part.title && (part.kind === 'text' || part.kind === 'thinking')) {
      last.text += part.text;
      return;
    }

    message.parts.push({
      ...part,
      id: crypto.randomUUID(),
    });
  }

  private updateToolQuestionPart(
    partId: string,
    update: (data: ToolQuestionPartData) => ToolQuestionPartData,
  ): ToolQuestionPartData | null {
    for (const message of this.conversation.messages) {
      const part = message.parts.find((item) => item.id === partId && item.kind === 'question');
      if (!part) continue;

      const data = parseToolQuestionPartData(part.text);
      if (!data) return null;
      const next = update(data);
      part.title = next.title || questionTitle(next);
      part.text = JSON.stringify(next);
      return next;
    }

    return null;
  }

  private finish(): void {
    const assistant = this.currentAssistant();
    if (assistant) {
      assistant.pending = false;
      if (!assistant.parts.some((part) => part.text.trim())) {
        assistant.parts.push({
          id: crypto.randomUUID(),
          kind: 'status',
          text: 'Claude 没有返回文本内容。',
        });
      }
    }
    this.currentRequestId = null;
    this.currentAssistantId = null;
    this.cancellingRequestId = null;
    this.statusText = '';
    this.saveCurrentConversation();
    this.notify();
    void this.refreshSessions().catch((error) => {
      console.warn('Failed to refresh AI sessions:', error);
    });
  }

  private finishWithError(error: string): void {
    const assistant = this.currentAssistant();
    if (assistant) {
      assistant.pending = false;
      assistant.error = true;
      assistant.parts = [{
        id: crypto.randomUUID(),
        kind: 'status',
        text: error || 'Claude 请求失败。',
      }];
    }
    this.currentRequestId = null;
    this.currentAssistantId = null;
    this.cancellingRequestId = null;
    this.statusText = '';
    this.saveCurrentConversation();
    this.notify();
  }

  private finishCancelled(): void {
    const assistant = this.currentAssistant();
    if (assistant) {
      assistant.pending = false;
      if (!assistant.parts.some((part) => part.text.trim())) {
        assistant.parts.push({
          id: crypto.randomUUID(),
          kind: 'status',
          text: '已打断。',
        });
      }
    }
    this.currentRequestId = null;
    this.currentAssistantId = null;
    this.cancellingRequestId = null;
    this.statusText = '';
    this.saveCurrentConversation();
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async loadSessions(): Promise<AiSessionSummary[]> {
    if (!this.workspaceFolder) return [];

    try {
      return await listAiSessions(this.workspaceFolder);
    } catch (error) {
      console.warn('Failed to load AI sessions:', error);
      return [];
    }
  }

  private saveCurrentConversation(): void {
    if (!this.workspaceFolder || this.conversation.messages.length === 0) return;

    try {
      const stored: StoredConversation = {
        title: this.conversationTitle,
        conversation: this.conversation,
      };
      localStorage.setItem(conversationStorageKey(this.workspaceFolder, this.conversation.id), JSON.stringify(stored));
    } catch (error) {
      console.warn('Failed to save chat conversation:', error);
    }
  }

  private loadStoredConversation(conversationId: string): StoredConversation | null {
    if (!this.workspaceFolder) return null;

    try {
      const raw = localStorage.getItem(conversationStorageKey(this.workspaceFolder, conversationId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredConversation>;
      if (!isConversation(parsed.conversation)) return null;
      return {
        title: typeof parsed.title === 'string' ? parsed.title : '',
        conversation: parsed.conversation,
      };
    } catch (error) {
      console.warn('Failed to load chat conversation:', error);
      return null;
    }
  }
}

function createTitle(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  return compact.length > 28 ? `${compact.slice(0, 28)}...` : compact;
}

function conversationStorageKey(workspaceFolder: string, conversationId: string): string {
  return `mypets-chat-conversation:${workspaceFolder}:${conversationId}`;
}

function questionTitle(question: Pick<ToolQuestionRequest, 'kind' | 'toolName'>): string {
  return question.kind === 'permission' ? `确认 ${question.toolName}` : '需要你的选择';
}

function parseToolQuestionPartData(text: string): ToolQuestionPartData | null {
  try {
    const value = JSON.parse(text) as Partial<ToolQuestionPartData>;
    if (
      typeof value.id !== 'string'
      || typeof value.requestId !== 'string'
      || typeof value.toolName !== 'string'
      || typeof value.toolUseId !== 'string'
      || (value.kind !== 'ask-user-question' && value.kind !== 'permission')
      || !Array.isArray(value.questions)
      || !isToolQuestionStatus(value.status)
    ) {
      return null;
    }

    return value as ToolQuestionPartData;
  } catch {
    return null;
  }
}

function isToolQuestionStatus(value: unknown): value is ToolQuestionPartData['status'] {
  return value === 'pending' || value === 'submitting' || value === 'answered' || value === 'error';
}

function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== 'object') return false;
  const conversation = value as Partial<Conversation>;
  return (
    typeof conversation.id === 'string'
    && conversation.providerId === 'claude'
    && typeof conversation.providerState === 'object'
    && Array.isArray(conversation.messages)
  );
}

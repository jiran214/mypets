import {
  listenToAiChatEvents,
  loadAiState,
  sendAiChatMessage,
} from './ai-api';
import type {
  AiChatEvent,
  AiState,
  ChatMessage,
  ClaudeProviderState,
  Conversation,
} from './ai-types';

type Listener = () => void;

export class ChatRuntime {
  private aiState: AiState | null = null;
  private conversation: Conversation = {
    id: `conv-${Date.now()}`,
    providerId: 'claude',
    providerState: {},
    messages: [],
  };
  private currentRequestId: string | null = null;
  private currentAssistantId: string | null = null;
  private statusText = '';
  private listeners = new Set<Listener>();

  async init(): Promise<void> {
    this.aiState = await loadAiState();
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

  getConversation(): Conversation {
    return this.conversation;
  }

  getStatusText(): string {
    return this.statusText;
  }

  isStreaming(): boolean {
    return this.currentRequestId !== null;
  }

  async send(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt || this.currentRequestId) return;

    const requestId = crypto.randomUUID();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: prompt,
    };
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      pending: true,
    };

    this.currentRequestId = requestId;
    this.currentAssistantId = assistantMessage.id;
    this.statusText = '正在连接 Claude...';
    this.conversation.messages.push(userMessage, assistantMessage);
    this.notify();

    try {
      await sendAiChatMessage({
        requestId,
        conversationId: this.conversation.id,
        prompt,
        providerState: this.conversation.providerState,
      });
    } catch (error) {
      this.finishWithError(error instanceof Error ? error.message : String(error));
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
      this.notify();
      return;
    }

    if (event.type === 'delta') {
      const assistant = this.currentAssistant();
      if (!assistant) return;
      assistant.text += event.text;
      assistant.pending = true;
      this.statusText = 'Claude 正在回复...';
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

  private finish(): void {
    const assistant = this.currentAssistant();
    if (assistant) {
      assistant.pending = false;
      if (!assistant.text.trim()) {
        assistant.text = 'Claude 没有返回文本内容。';
      }
    }
    this.currentRequestId = null;
    this.currentAssistantId = null;
    this.statusText = '';
    this.notify();
  }

  private finishWithError(error: string): void {
    const assistant = this.currentAssistant();
    if (assistant) {
      assistant.pending = false;
      assistant.error = true;
      assistant.text = error || 'Claude 请求失败。';
    }
    this.currentRequestId = null;
    this.currentAssistantId = null;
    this.statusText = '';
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

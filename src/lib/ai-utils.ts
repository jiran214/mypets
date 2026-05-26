import type {
  ChatMessage,
  ChatMessagePart,
  Conversation,
  ToolQuestionPartData,
} from '@/ai/ai-types';

export interface StoredConversation {
  title: string;
  conversation: Conversation;
}

/** Conversation storage key for localStorage. */
export function conversationStorageKey(workspaceFolder: string, conversationId: string): string {
  return `wimipet-chat-conversation:${workspaceFolder}:${conversationId}`;
}

/** Merge consecutive text/thinking parts with the same kind and title. */
export function appendPart(message: ChatMessage, part: Omit<ChatMessagePart, 'id'>): void {
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

/** Persist a conversation to localStorage. */
export function persistConversation(workspaceFolder: string, title: string, conversation: Conversation): void {
  try {
    const stored: StoredConversation = { title, conversation };
    localStorage.setItem(conversationStorageKey(workspaceFolder, conversation.id), JSON.stringify(stored));
  } catch (error) {
    console.warn('Failed to save conversation:', error);
  }
}

export function isToolQuestionStatus(value: unknown): value is ToolQuestionPartData['status'] {
  return value === 'pending' || value === 'submitting' || value === 'answered' || value === 'error';
}

export function parseToolQuestionPartData(text: string): ToolQuestionPartData | null {
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

export function getToolQuestionData(part: ChatMessagePart): ToolQuestionPartData | null {
  if (part.questionData) return part.questionData;
  return parseToolQuestionPartData(part.text);
}

export interface ClaudeSettings {
  pathToClaudeCodeExecutable: string;
  permissionMode: string;
  useUserSettings: boolean;
  customEnvText: string;
}

export interface AiSettings {
  providerId: 'claude';
  claude: ClaudeSettings;
}

export interface AiPaths {
  workspaceDir: string;
  mypetsAiDir: string;
  claudeDir: string;
  sessionsDir: string;
  logFile: string;
}

export interface AiState {
  settings: AiSettings;
  paths: AiPaths;
}

export interface ClaudeProviderState {
  claudeSessionId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: ChatMessagePart[];
  pending?: boolean;
  error?: boolean;
}

export type ChatPartKind = 'text' | 'thinking' | 'plan' | 'tool' | 'mcp' | 'skill' | 'path' | 'status';

export interface ChatMessagePart {
  id: string;
  kind: ChatPartKind;
  text: string;
  title?: string;
}

export interface Conversation {
  id: string;
  providerId: 'claude';
  providerState: ClaudeProviderState;
  messages: ChatMessage[];
}

export interface AiChatRequest {
  requestId: string;
  conversationId: string;
  workspaceFolder: string;
  prompt: string;
  providerState: ClaudeProviderState;
}

export type AiChatEvent =
  | { type: 'status'; requestId: string; status: string }
  | { type: 'session'; requestId: string; providerState: ClaudeProviderState }
  | { type: 'part'; requestId: string; part: Omit<ChatMessagePart, 'id'> }
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string; providerState?: ClaudeProviderState }
  | { type: 'error'; requestId: string; error: string };

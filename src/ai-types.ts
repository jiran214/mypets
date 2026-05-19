export interface ClaudeSettings {
  pathToClaudeCodeExecutable: string;
  cwd: string;
  model: string;
  permissionMode: string;
  maxTurns: number | null;
  systemPrompt: string;
  useProjectSettings: boolean;
}

export interface AiSettings {
  providerId: 'claude';
  claude: ClaudeSettings;
}

export interface AiPaths {
  appDataDir: string;
  mypetsAiDir: string;
  claudeDir: string;
  sessionsDir: string;
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
  text: string;
  pending?: boolean;
  error?: boolean;
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
  prompt: string;
  providerState: ClaudeProviderState;
}

export type AiChatEvent =
  | { type: 'status'; requestId: string; status: string }
  | { type: 'session'; requestId: string; providerState: ClaudeProviderState }
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string; providerState?: ClaudeProviderState }
  | { type: 'error'; requestId: string; error: string };

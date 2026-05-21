export interface ClaudeSettings {
  pathToClaudeCodeExecutable: string;
  permissionMode: string;
  useUserSettings: boolean;
  customEnvText: string;
  enabledSkills: string[];
}

export interface AiSettings {
  providerId: 'claude';
  petPersona: string;
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

export interface AiSessionSummary {
  id: string;
  providerId: 'claude';
  providerState: ClaudeProviderState;
  title: string;
  createdAt: number;
  updatedAt: number;
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

export interface ChatAttachment {
  id: string;
  path: string;
  name: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  scope: 'global' | 'workspace';
  path: string;
}

export interface AiChatRequest {
  requestId: string;
  conversationId: string;
  workspaceFolder: string;
  prompt: string;
  attachments?: ChatAttachment[];
  providerState: ClaudeProviderState;
}

export type AiChatEvent =
  | { type: 'status'; requestId: string; status: string }
  | { type: 'session'; requestId: string; providerState: ClaudeProviderState }
  | { type: 'part'; requestId: string; part: Omit<ChatMessagePart, 'id'> }
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string; providerState?: ClaudeProviderState }
  | { type: 'error'; requestId: string; error: string };

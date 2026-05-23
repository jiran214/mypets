export interface ClaudeSettings {
  pathToClaudeCodeExecutable: string;
  permissionMode: string;
  useUserSettings: boolean;
  customEnvText: string;
  enabledSkills: string[];
}

export interface AiSettings {
  providerId: 'claude';
  petAlwaysOnTop: boolean;
  petGravityEnabled: boolean;
  petScale: number;
  petResizeEnabled: boolean;
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

export type ChatPartKind = 'text' | 'thinking' | 'plan' | 'tool' | 'mcp' | 'skill' | 'path' | 'attachment' | 'status' | 'question';

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
  kind: 'file' | 'text';
  name: string;
  path?: string;
  text?: string;
  mediaType?: string;
}

export type ToolQuestionKind = 'ask-user-question' | 'permission';

export interface ToolQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface ToolQuestionItem {
  question: string;
  header: string;
  options: ToolQuestionOption[];
  multiSelect: boolean;
}

export interface ToolQuestionRequest {
  id: string;
  requestId: string;
  toolName: string;
  toolUseId: string;
  kind: ToolQuestionKind;
  title?: string;
  description?: string;
  questions: ToolQuestionItem[];
}

export interface ToolQuestionAnswerPayload {
  answers: Record<string, string>;
  annotations?: Record<string, { preview?: string; notes?: string }>;
}

export type ToolQuestionPartStatus = 'pending' | 'submitting' | 'answered' | 'error';

export interface ToolQuestionPartData extends ToolQuestionRequest {
  status: ToolQuestionPartStatus;
  response?: ToolQuestionAnswerPayload;
  error?: string;
}

export interface SavedDroppedChatFile {
  path: string;
  name: string;
  mediaType: string;
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

export interface AiToolQuestionAnswerRequest {
  requestId: string;
  questionId: string;
  response: ToolQuestionAnswerPayload;
}

export type AiChatEvent =
  | { type: 'status'; requestId: string; status: string }
  | { type: 'session'; requestId: string; providerState: ClaudeProviderState }
  | { type: 'part'; requestId: string; part: Omit<ChatMessagePart, 'id'> }
  | { type: 'question'; requestId: string; question: ToolQuestionRequest }
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string; providerState?: ClaudeProviderState }
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId: string; error: string };

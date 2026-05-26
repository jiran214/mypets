export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions';
export type ThinkingIntensity = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ProviderId = 'pi' | 'claude' | 'codex';
export type CodexApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';
export type CodexReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type PiQueueMode = 'all' | 'one-at-a-time';

export interface PiSettings {
  pathToPiExecutable: string;
  provider: string;
  model: string;
  thinkingLevel: PiThinkingLevel;
  sessionDir: string;
  useNoSession: boolean;
  autoCompactionEnabled: boolean;
  autoRetryEnabled: boolean;
  steeringMode: PiQueueMode;
  followUpMode: PiQueueMode;
  customEnvText: string;
  disabledSkills: string[];
  extraSkillPaths: string;
}

export interface PiProviderAuth {
  provider: string;
  authKey: string;
  key: string;
}

export interface ClaudeSettings {
  pathToClaudeCodeExecutable: string;
  permissionMode: PermissionMode;
  thinkingIntensity: ThinkingIntensity;
  useUserSettings: boolean;
  customEnvText: string;
  disabledSkills: string[];
}

export interface CodexSettings {
  pathToCodexExecutable: string;
  model: string;
  approvalPolicy: CodexApprovalPolicy;
  reasoningEffort: CodexReasoningEffort;
  customEnvText: string;
  disabledSkills: string[];
}

export interface AiSettings {
  providerId: ProviderId;
  petAlwaysOnTop: boolean;
  petGravityEnabled: boolean;
  petScale: number;
  petResizeEnabled: boolean;
  petPersona: string;
  displayName: string;
  pi: PiSettings;
  claude: ClaudeSettings;
  codex: CodexSettings;
}

export interface AiPaths {
  workspaceDir: string;
  wimipetDir: string;
  claudeDir: string;
  sessionsDir: string;
  logFile: string;
}

export interface AiState {
  settings: AiSettings;
  paths: AiPaths;
}

export interface ProviderState {
  piSessionId?: string;
  piSessionFile?: string;
  claudeSessionId?: string;
  codexThreadId?: string;
}

export interface AiSessionSummary {
  id: string;
  providerId: ProviderId;
  providerState: ProviderState;
  title: string;
  createdAt: number;
  updatedAt: number;
  autoTaskId?: string;
  autoTaskName?: string;
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
  questionData?: ToolQuestionPartData;
}

export interface Conversation {
  id: string;
  providerId: ProviderId;
  providerState: ProviderState;
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
  answers: Record<string, string[]>;
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
  scope: 'workspace' | 'builtin' | 'global';
  path: string;
}

export interface AiChatRequest {
  requestId: string;
  conversationId: string;
  workspaceFolder: string;
  providerId: ProviderId;
  title?: string;
  autoTaskId?: string;
  autoTaskName?: string;
  prompt: string;
  attachments?: ChatAttachment[];
  providerState: ProviderState;
}

export interface AiToolQuestionAnswerRequest {
  requestId: string;
  questionId: string;
  response: ToolQuestionAnswerPayload;
}

export type AiChatEvent =
  | { type: 'status'; requestId: string; status: string }
  | { type: 'session'; requestId: string; providerState: ProviderState }
  | { type: 'part'; requestId: string; part: Omit<ChatMessagePart, 'id'> }
  | { type: 'question'; requestId: string; question: ToolQuestionRequest }
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string; providerState?: ProviderState }
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId: string; error: string };

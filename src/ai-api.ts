import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AiChatEvent,
  AiChatRequest,
  AiSessionSummary,
  AiSettings,
  AiState,
  AiToolQuestionAnswerRequest,
  SavedDroppedChatFile,
  SkillInfo,
} from './ai-types';

export function loadAiState(workspaceFolder: string): Promise<AiState> {
  return invoke<AiState>('load_ai_state', { workspaceFolder });
}

export function listAiSessions(workspaceFolder: string): Promise<AiSessionSummary[]> {
  return invoke<AiSessionSummary[]>('list_ai_sessions', { workspaceFolder });
}

export function saveAiSettings(workspaceFolder: string, settings: AiSettings): Promise<AiState> {
  return invoke<AiState>('save_ai_settings', { workspaceFolder, settings });
}

export function listSkills(workspaceFolder: string): Promise<SkillInfo[]> {
  return invoke<SkillInfo[]>('list_skills', { workspaceFolder });
}

export function saveDroppedChatFile(
  workspaceFolder: string,
  name: string,
  mediaType: string,
  dataBase64: string,
): Promise<SavedDroppedChatFile> {
  return invoke<SavedDroppedChatFile>('save_dropped_chat_file', {
    workspaceFolder,
    name,
    mediaType,
    dataBase64,
  });
}

export function sendAiChatMessage(request: AiChatRequest): Promise<string> {
  return invoke<string>('send_ai_chat_message', { request });
}

export function cancelAiChatMessage(requestId: string): Promise<void> {
  return invoke<void>('cancel_ai_chat_message', { requestId });
}

export function answerAiToolQuestion(request: AiToolQuestionAnswerRequest): Promise<void> {
  return invoke<void>('answer_ai_tool_question', { request });
}

export async function listenToAiChatEvents(handler: (event: AiChatEvent) => void): Promise<UnlistenFn> {
  if (!hasTauriRuntime()) {
    return () => {};
  }

  try {
    return await listen<AiChatEvent>('ai-chat-event', (event) => handler(event.payload));
  } catch (error) {
    console.warn('AI chat events are unavailable outside Tauri:', error);
    return () => {};
  }
}

function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

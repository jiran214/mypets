import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AiChatEvent, AiChatRequest, AiSettings, AiState } from './ai-types';

export function loadAiState(): Promise<AiState> {
  return invoke<AiState>('load_ai_state');
}

export function saveAiSettings(settings: AiSettings): Promise<AiState> {
  return invoke<AiState>('save_ai_settings', { settings });
}

export function sendAiChatMessage(request: AiChatRequest): Promise<string> {
  return invoke<string>('send_ai_chat_message', { request });
}

export function listenToAiChatEvents(handler: (event: AiChatEvent) => void): Promise<UnlistenFn> {
  return listen<AiChatEvent>('ai-chat-event', (event) => handler(event.payload));
}

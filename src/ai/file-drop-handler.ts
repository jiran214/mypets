import { saveDroppedChatFile } from './ai-api';
import type { ChatAttachment } from './ai-types';
import { hasTauriRuntime } from '@/lib/tauri-utils';

const MAX_DROPPED_FILE_COPY_BYTES = 25 * 1024 * 1024;
const MAX_DROPPED_FILE_TEXT_BYTES = 256 * 1024;
const TEXT_DROP_TYPES = ['text/plain', 'text/uri-list', 'text/html', 'text/x-moz-url'];

export function hasSupportedDragData(dataTransfer: DataTransfer): boolean {
  const types = dataTransferTypes(dataTransfer);
  return types.includes('Files') || TEXT_DROP_TYPES.some((type) => types.includes(type));
}

export function dataTransferTypes(dataTransfer: DataTransfer): string[] {
  return Array.from(dataTransfer.types ?? []);
}

export async function attachmentsFromDataTransfer(
  dataTransfer: DataTransfer,
  workspaceFolder: string,
): Promise<ChatAttachment[]> {
  const attachments: ChatAttachment[] = [];
  const files = Array.from(dataTransfer.files);
  const textAttachment = createTextAttachment(droppedTextFromDataTransfer(dataTransfer), droppedTextName(dataTransfer));
  if (textAttachment) {
    attachments.push(textAttachment);
  }

  if (files.length === 0) {
    return attachments;
  }

  const fileAttachments = await Promise.all(files.map((file) => browserFileToAttachment(file, workspaceFolder)));
  return [...attachments, ...fileAttachments.filter((attachment): attachment is ChatAttachment => attachment !== null)];
}

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

export function createFileAttachment(path: string, name?: string, mediaType?: string): ChatAttachment | null {
  const trimmedPath = path.trim();
  if (!trimmedPath) return null;

  return {
    id: crypto.randomUUID(),
    kind: 'file',
    path: trimmedPath,
    name: name?.trim() || fileNameFromPath(trimmedPath),
    mediaType,
  };
}

export function createTextAttachment(text: string, name = '拖入文本', mediaType = 'text/plain'): ChatAttachment | null {
  const trimmedText = text.trim();
  if (!trimmedText) return null;

  return {
    id: crypto.randomUUID(),
    kind: 'text',
    name,
    text: trimmedText,
    mediaType,
  };
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

async function browserFileToAttachment(file: File, workspaceFolder: string): Promise<ChatAttachment | null> {
  const directPath = droppedFilePath(file);
  if (directPath) {
    return createFileAttachment(directPath, file.name, file.type || undefined);
  }

  if (hasTauriRuntime() && workspaceFolder) {
    if (file.size > MAX_DROPPED_FILE_COPY_BYTES) {
      return createTextAttachment(
        `文件过大，未复制到聊天上下文。文件名: ${file.name}\n类型: ${file.type || '未知'}\n大小: ${file.size} bytes`,
        file.name || '拖入文件',
        file.type || 'application/octet-stream',
      );
    }

    try {
      const saved = await saveDroppedChatFile(
        workspaceFolder,
        file.name || '拖入文件',
        file.type || 'application/octet-stream',
        await fileToBase64(file),
      );
      return createFileAttachment(saved.path, saved.name, saved.mediaType);
    } catch (error) {
      console.warn('Failed to persist dropped file:', error);
    }
  }

  try {
    if (file.size > MAX_DROPPED_FILE_TEXT_BYTES) {
      return createTextAttachment(
        `无法获取本地文件路径。文件名: ${file.name}\n类型: ${file.type || '未知'}\n大小: ${file.size} bytes`,
        file.name || '拖入文件',
        file.type || 'application/octet-stream',
      );
    }

    const text = await file.text();
    return createTextAttachment(text, file.name || '拖入文件', file.type || 'text/plain');
  } catch {
    return createTextAttachment(
      `无法读取此文件。文件名: ${file.name}\n类型: ${file.type || '未知'}\n大小: ${file.size} bytes`,
      file.name || '拖入文件',
      file.type || 'application/octet-stream',
    );
  }
}

function droppedFilePath(file: File): string {
  const candidate = file as File & { path?: unknown; webkitRelativePath?: string };
  return typeof candidate.path === 'string' && candidate.path.trim()
    ? candidate.path.trim()
    : candidate.webkitRelativePath || '';
}

function droppedTextFromDataTransfer(dataTransfer: DataTransfer): string {
  const plain = safeDataTransferText(dataTransfer, 'text/plain');
  const uriList = normalizeUriList(safeDataTransferText(dataTransfer, 'text/uri-list'));
  const htmlText = htmlToPlainText(safeDataTransferText(dataTransfer, 'text/html'));
  const mozText = safeDataTransferText(dataTransfer, 'text/x-moz-url').split(/\r?\n/).filter(Boolean).join('\n');

  if (plain && uriList && plain !== uriList) {
    return `${plain}\n${uriList}`;
  }

  return plain || uriList || htmlText || mozText;
}

function droppedTextName(dataTransfer: DataTransfer): string {
  const types = dataTransferTypes(dataTransfer);
  if (types.includes('text/uri-list')) return '拖入链接';
  if (types.includes('text/html')) return '拖入网页内容';
  return '拖入文本';
}

function safeDataTransferText(dataTransfer: DataTransfer, type: string): string {
  try {
    return dataTransfer.getData(type).trim();
  } catch {
    return '';
  }
}

function normalizeUriList(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .join('\n');
}

function htmlToPlainText(value: string): string {
  if (!value) return '';

  const doc = new DOMParser().parseFromString(value, 'text/html');
  return doc.body.textContent?.trim() ?? '';
}

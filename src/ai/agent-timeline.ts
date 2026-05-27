import { getToolQuestionData } from '@/lib/ai-utils';
import type { ChatMessagePart, ChatPartKind } from './ai-types';

export interface TimelineItem {
  id: string;
  kind: ChatPartKind;
  title: string;
  parts: ChatMessagePart[];
}

export interface TimelineGroup {
  id: string;
  items: TimelineItem[];
}

export type TimelineBlock =
  | { type: 'text'; part: ChatMessagePart }
  | { type: 'thinking'; part: ChatMessagePart }
  | { type: 'group'; group: TimelineGroup }
  | { type: 'question'; part: ChatMessagePart };

export function buildTimelineGroups(parts: ChatMessagePart[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  let currentGroup: TimelineGroup | null = null;

  const flushGroup = (): void => {
    if (!currentGroup || currentGroup.items.length === 0) return;
    blocks.push({ type: 'group', group: currentGroup });
    currentGroup = null;
  };

  for (const part of parts) {
    if (part.kind === 'status' && part.title === '会话') {
      continue;
    }

    if (part.kind === 'text') {
      flushGroup();
      if (part.text.trim()) {
        blocks.push({ type: 'text', part });
      }
      continue;
    }

    if (part.kind === 'thinking') {
      flushGroup();
      if (part.text.trim()) {
        blocks.push({ type: 'thinking', part });
      }
      continue;
    }

    if (part.kind === 'question') {
      flushGroup();
      const questionData = getToolQuestionData(part);
      if (questionData?.status === 'pending') {
        continue;
      }
      blocks.push({ type: 'question', part });
      continue;
    }

    if (!currentGroup) {
      currentGroup = { id: part.id, items: [] };
    }

    appendTimelineItem(currentGroup, part);
  }

  flushGroup();
  return blocks;
}

function appendTimelineItem(group: TimelineGroup, part: ChatMessagePart): void {
  const title = part.title || timelineKindLabel(part.kind);
  const last = group.items[group.items.length - 1];

  if (last && part.kind !== 'thinking' && last.kind === part.kind && last.title === title) {
    last.parts.push(part);
    return;
  }

  group.items.push({
    id: part.id,
    kind: part.kind,
    title,
    parts: [part],
  });
}

function timelineKindLabel(kind: ChatPartKind): string {
  if (kind === 'plan') return '计划';
  if (kind === 'mcp') return 'MCP 调用';
  if (kind === 'skill') return 'Skill';
  if (kind === 'path') return '路径';
  if (kind === 'status') return '状态';
  if (kind === 'attachment') return '附件';
  return '工具调用';
}

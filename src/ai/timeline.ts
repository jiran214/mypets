import type {
  ChatMessagePart,
  ChatPartKind,
  ToolTrace,
  ToolTraceKind,
  ToolTracePhase,
} from './ai-types';

export type TimelineItemKind = ToolTraceKind | 'thinking';

export interface TimelineItem {
  id: string;
  kind: TimelineItemKind;
  name: string;
  label: string;
  title: string;
  description?: string;
  path?: string;
  parts: ChatMessagePart[];
  traces: ToolTrace[];
}

export interface ChainOfThoughtModel {
  id: string;
  items: TimelineItem[];
  summaryParts: ChatMessagePart[];
}

export function buildChainOfThought(parts: ChatMessagePart[]): ChainOfThoughtModel {
  const items: TimelineItem[] = [];
  const summaryParts: ChatMessagePart[] = [];

  for (const part of parts) {
    if (part.kind === 'status' && part.title === '会话') {
      continue;
    }

    if (part.kind === 'question') {
      continue;
    }

    if (part.kind === 'text') {
      if (part.text.trim()) {
        summaryParts.push(part);
      }
      continue;
    }

    const item = partToTimelineItem(part);
    if (!item) continue;

    const last = items[items.length - 1];
    if (last && canMergeTimelineItem(last, item)) {
      last.parts.push(...item.parts);
      last.traces.push(...item.traces);
      last.path ??= item.path;
      last.description ??= item.description;
      continue;
    }

    items.push(item);
  }

  return {
    id: items[0]?.id ?? summaryParts[0]?.id ?? 'chain-of-thought',
    items,
    summaryParts,
  };
}

function partToTimelineItem(part: ChatMessagePart): TimelineItem | null {
  if (part.kind === 'thinking') {
    if (!part.text.trim()) return null;
    const trace: ToolTrace = {
      id: part.id,
      phase: 'output',
      kind: 'status',
      name: 'thinking',
      label: '思考',
      output: part.text,
    };
    return {
      id: part.id,
      kind: 'thinking',
      name: 'thinking',
      label: '思考',
      title: '思考',
      parts: [part],
      traces: [trace],
    };
  }

  const trace = normalizeToolTrace(part);
  if (!trace) return null;

  const label = displayLabelForTrace(trace);
  const description = trace.description || descriptionFromTrace(trace);
  const path = trace.path || pathFromTrace(trace);
  const title = [label, description].filter(Boolean).join(' ');

  return {
    id: trace.id || part.id,
    kind: trace.kind,
    name: groupingName(trace),
    label,
    title,
    ...(description ? { description } : {}),
    ...(path ? { path } : {}),
    parts: [part],
    traces: [trace],
  };
}

function canMergeTimelineItem(previous: TimelineItem, next: TimelineItem): boolean {
  return previous.kind === next.kind && previous.name === next.name;
}

function normalizeToolTrace(part: ChatMessagePart): ToolTrace | null {
  const trace = part.toolTrace ?? legacyToolTrace(part);
  if (!trace) return null;

  const kind = normalizeTraceKind(trace.kind, part.kind);
  const phase = normalizeTracePhase(trace.phase);
  const label = trace.label || labelForTraceKind(kind);
  const name = trace.name || nameFromLabel(label) || kind;
  const path = trace.path || pathFromTrace(trace);
  const description = trace.description || descriptionFromTrace({ ...trace, kind, label, name, path });

  return {
    ...trace,
    id: trace.id || part.id,
    phase,
    kind,
    name,
    label,
    ...(description ? { description } : {}),
    ...(path ? { path } : {}),
  };
}

function legacyToolTrace(part: ChatMessagePart): ToolTrace | null {
  if (!part.text.trim() && part.kind !== 'status') return null;

  const rawTitle = part.title || legacyKindLabel(part.kind);
  const input = parseJson(part.text);
  const toolName = legacyToolName(rawTitle);
  const kind = legacyTraceKind(part.kind, toolName, rawTitle);
  const label = labelForTraceKind(kind);
  const path = kind === 'read'
    ? stringFromObject(input, ['path', 'filePath', 'file_path']) || part.text.trim()
    : undefined;
  const description = legacyDescription(kind, rawTitle, part.text, input, path);
  const phase: ToolTracePhase = kind === 'status' || part.kind === 'plan' ? 'status' : 'input';

  return {
    id: part.id,
    phase,
    kind,
    name: defaultTraceName(kind, toolName),
    label,
    ...(description ? { description } : {}),
    ...(path ? { path } : {}),
    ...(phase === 'input' ? { input: input ?? part.text } : { output: input ?? part.text }),
  };
}

function normalizeTraceKind(kind: ToolTraceKind | undefined, fallback: ChatPartKind): ToolTraceKind {
  if (
    kind === 'bash'
    || kind === 'read'
    || kind === 'mcp'
    || kind === 'tool'
    || kind === 'skill'
    || kind === 'plan'
    || kind === 'status'
  ) {
    return kind;
  }

  if (fallback === 'mcp') return 'mcp';
  if (fallback === 'skill') return 'skill';
  if (fallback === 'plan') return 'plan';
  if (fallback === 'status') return 'status';
  return 'tool';
}

function normalizeTracePhase(phase: ToolTracePhase | undefined): ToolTracePhase {
  if (phase === 'input' || phase === 'output' || phase === 'update' || phase === 'status') {
    return phase;
  }
  return 'input';
}

function legacyTraceKind(kind: ChatPartKind, toolName: string, title: string): ToolTraceKind {
  const normalized = `${toolName} ${title}`.toLowerCase();
  if (kind === 'mcp' || normalized.includes('mcp')) return 'mcp';
  if (kind === 'skill' || normalized.includes('skill')) return 'skill';
  if (kind === 'plan') return 'plan';
  if (kind === 'status') return 'status';
  if (kind === 'path' || normalized.includes('read')) return 'read';
  if (normalized.includes('bash') || normalized.includes('commandexecution') || title === '命令执行') return 'bash';
  return 'tool';
}

function legacyToolName(title: string): string {
  return title
    .replace(/^工具失败\s+/u, '')
    .replace(/^工具\s+/u, '')
    .replace(/^MCP\s+/iu, '')
    .replace(/^Skill\s+/iu, '')
    .trim();
}

function legacyDescription(
  kind: ToolTraceKind,
  title: string,
  text: string,
  input: unknown,
  path: string | undefined,
): string | undefined {
  if (kind === 'bash') {
    return stringFromObject(input, ['description', 'command']) || text.trim() || title;
  }
  if (kind === 'read') {
    return path || title;
  }
  if (kind === 'mcp') {
    return title.replace(/^MCP\s+/iu, '').trim() || undefined;
  }
  if (kind === 'plan') {
    return title === '计划' ? undefined : title;
  }
  if (kind === 'status') {
    return title === '状态' ? undefined : title;
  }
  return title || undefined;
}

function displayLabelForTrace(trace: ToolTrace): string {
  if (trace.kind === 'bash') return 'Bash';
  if (trace.kind === 'read') return 'Read';
  if (trace.kind === 'mcp') return 'MCP';
  if (trace.kind === 'plan') return '计划';
  if (trace.kind === 'status') return trace.label || '状态';
  return trace.label || labelForTraceKind(trace.kind);
}

function labelForTraceKind(kind: ToolTraceKind): string {
  if (kind === 'bash') return 'Bash';
  if (kind === 'read') return 'Read';
  if (kind === 'mcp') return 'MCP';
  if (kind === 'skill') return 'Skill';
  if (kind === 'plan') return '计划';
  if (kind === 'status') return '状态';
  return 'Tool';
}

function groupingName(trace: ToolTrace): string {
  if (trace.kind === 'bash') return 'Bash';
  if (trace.kind === 'read') return 'Read';
  if (trace.kind === 'mcp') return trace.name || trace.description || 'MCP';
  return trace.name || trace.label || trace.kind;
}

function defaultTraceName(kind: ToolTraceKind, toolName: string): string {
  if (kind === 'bash') return 'Bash';
  if (kind === 'read') return 'Read';
  if (kind === 'mcp') return toolName || 'MCP';
  return toolName || kind;
}

function descriptionFromTrace(trace: Partial<ToolTrace>): string | undefined {
  if (trace.kind === 'bash') {
    return stringFromObject(trace.input, ['description', 'command']) || stringFromUnknown(trace.input);
  }
  if (trace.kind === 'read') {
    return trace.path || stringFromObject(trace.input, ['path', 'filePath', 'file_path']);
  }
  if (trace.kind === 'mcp') {
    return trace.description || trace.name;
  }
  return trace.description;
}

function pathFromTrace(trace: Partial<ToolTrace>): string | undefined {
  if (trace.path) return trace.path;
  return stringFromObject(trace.input, ['path', 'filePath', 'file_path', 'filename']);
}

function legacyKindLabel(kind: ChatPartKind): string {
  if (kind === 'plan') return '计划';
  if (kind === 'mcp') return 'MCP';
  if (kind === 'skill') return 'Skill';
  if (kind === 'path') return 'Read';
  if (kind === 'status') return '状态';
  return 'Tool';
}

function nameFromLabel(label: string): string {
  return label.trim();
}

function stringFromObject(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const current = record[key];
    if (typeof current === 'string' && current.trim()) return current.trim();
  }
  return undefined;
}

function stringFromUnknown(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function parseJson(text: string): unknown {
  try {
    const trimmed = text.trim();
    if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  } catch (error) {
    // 记录 startsWith 错误的详细信息
    console.error('[timeline] parseJson error:', error, {
      textType: typeof text,
      textValue: text,
      textLength: text?.length,
    });
    return undefined;
  }
}

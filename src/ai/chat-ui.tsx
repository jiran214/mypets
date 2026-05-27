import { getCurrentWindow, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { hasTauriRuntime, safeCurrentWindow } from '@/lib/tauri-utils';
import { getToolQuestionData } from '@/lib/ai-utils';
import {
  Check,
  CalendarDays,
  CircleQuestionMark,
  FileIcon,
  FileText,
  History,
  ListTodo,
  MessageCircle,
  Paperclip,
  Plus,
  Search,
  SendHorizontal,
  Sparkles,
  Timer,
  X,
} from 'lucide-react';
import type { ToolUIPart } from 'ai';
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  type AttachmentData,
} from '@/components/ai-elements/attachments';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CountdownPanel } from '@/components/tools/countdown-panel';
import { PomodoroPanel } from '@/components/tools/pomodoro-panel';
import { TodolistPanel } from '@/components/tools/todolist-panel';
import { cn } from '@/lib/utils';
import type { ChatRuntime } from './chat-runtime';
import type {
  AiSessionSummary,
  ChatAttachment,
  ChatMessagePart,
  ToolQuestionAnswerPayload,
  ToolQuestionItem,
  ToolQuestionOption,
  ToolQuestionPartData,
} from './ai-types';
import {
  attachmentsFromDataTransfer,
  createFileAttachment,
  hasSupportedDragData,
} from './file-drop-handler';
import {
  BUBBLE_GAP,
  BUBBLE_HEIGHT,
  BUBBLE_WIDTH,
  calculateBubbleLayout,
  type BubbleLayout,
  type Size,
} from './bubble-layout';
const roots = new WeakMap<HTMLElement, Root>();

export interface ChatBubbleController {
  resolvePetWindowSize: (base: Size) => Size;
  close: () => void;
}

type ChatPanelVariant = 'embedded' | 'bubble';
type ToolView = 'chat' | 'todolist' | 'pomodoro' | 'countdown';

const TOOL_VIEW_OPTIONS: { value: ToolView; label: string }[] = [
  { value: 'chat', label: '聊天' },
  { value: 'todolist', label: 'Todolist' },
  { value: 'pomodoro', label: '番茄钟' },
  { value: 'countdown', label: '倒数日' },
];

interface ChatPanelProps {
  runtime: ChatRuntime;
  compact?: boolean;
  variant?: ChatPanelVariant;
  petName?: string;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
  onDragActive?: (active: boolean) => void;
}

export function mountChatUi(
  root: HTMLElement,
  runtime: ChatRuntime,
  compact = false,
  options?: { petName?: string; onInputFocus?: () => void; onInputBlur?: () => void; onDragActive?: (active: boolean) => void },
): void {
  roots.get(root)?.unmount();
  root.innerHTML = '';

  const reactRoot = createRoot(root);
  roots.set(root, reactRoot);
  reactRoot.render(
    <TooltipProvider>
      <ChatPanel
        runtime={runtime}
        compact={compact}
        variant={compact ? 'bubble' : 'embedded'}
        petName={options?.petName}
        onInputFocus={options?.onInputFocus}
        onInputBlur={options?.onInputBlur}
        onDragActive={options?.onDragActive}
      />
    </TooltipProvider>,
  );
}

export function ChatPanel({ runtime, compact = false, variant, petName, onInputFocus, onInputBlur, onDragActive }: ChatPanelProps): ReactNode {
  const [, forceRender] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [activeView, setActiveView] = useState<ToolView>('chat');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const resolvedVariant = variant ?? (compact ? 'bubble' : 'embedded');
  const isBubble = resolvedVariant === 'bubble';
  const isChatView = activeView === 'chat';
  const workspaceFolder = runtime.getWorkspaceFolder();
  const panelTitle = isChatView ? runtime.getConversationTitle() : toolViewLabel(activeView);

  const conversation = runtime.getConversation();
  const isStreaming = runtime.isStreaming();
  const hasWorkspace = runtime.hasWorkspace();
  const hasMessages = conversation.messages.length > 0;
  const sendDisabled = isStreaming || (!inputValue.trim() && attachments.length === 0) || !hasWorkspace;
  const hasPendingQuestion = conversation.messages.some((message) => (
    message.parts.some((part) => part.kind === 'question' && getToolQuestionData(part)?.status === 'pending')
  ));

  const addAttachments = useCallback((incoming: ChatAttachment[]): void => {
    setAttachments((current) => {
      const existing = new Set(current.map(attachmentIdentity));
      const next = incoming.filter((attachment) => {
        const key = attachmentIdentity(attachment);
        if (existing.has(key)) return false;
        existing.add(key);
        return true;
      });

      return next.length > 0 ? [...current, ...next] : current;
    });
  }, []);

  const addFileAttachments = useCallback((paths: string[]): void => {
    addAttachments(paths.map((path) => createFileAttachment(path)).filter((attachment): attachment is ChatAttachment => attachment !== null));
  }, [addAttachments]);

  const pickFiles = useCallback(async (): Promise<void> => {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        title: '选择文件',
      });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      addFileAttachments(paths);
    } catch (error) {
      console.warn('Failed to pick chat attachment:', error);
    }
  }, [addFileAttachments]);

  const submit = useCallback((message: PromptInputMessage): void => {
    const value = message.text || inputValue;
    if (!isChatView || sendDisabled) return;

    const files = attachments;
    setInputValue('');
    setAttachments([]);
    void runtime.send(value, files);
  }, [attachments, inputValue, isChatView, runtime, sendDisabled]);

  const handleHistoryOpenChange = useCallback((open: boolean): void => {
    setHistoryOpen(open);
    if (!open) return;
    void runtime.refreshSessions();
  }, [runtime]);

  const startNewConversation = useCallback((): void => {
    runtime.startNewConversation();
    setHistoryOpen(false);
  }, [runtime]);

  useEffect(() => runtime.subscribe(() => {
    forceRender((version) => version + 1);
  }), [runtime]);

  useEffect(() => {
    if (compact && hasPendingQuestion) {
      document.dispatchEvent(new CustomEvent('open-chat-bubble'));
    }
  }, [compact, hasPendingQuestion]);

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    try {
      void getCurrentWindow().onDragDropEvent((event) => {
        if (isStreaming) {
          setDragActive(false);
          return;
        }

        const payload = event.payload;
        if (payload.type === 'enter' || payload.type === 'over') {
          setDragActive(true);
          return;
        }

        setDragActive(false);
        if (payload.type === 'drop') {
          setActiveView('chat');
          addFileAttachments(payload.paths);
          if (compact) {
            document.dispatchEvent(new CustomEvent('open-chat-bubble'));
          }
        }
      })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
            return;
          }
          cleanup = unlisten;
        })
        .catch((error) => {
          console.warn('File drag and drop is unavailable outside Tauri:', error);
        });
    } catch (error) {
      console.warn('File drag and drop is unavailable outside Tauri:', error);
    }

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [addFileAttachments, compact, isStreaming]);

  useEffect(() => {
    let dragDepth = 0;

    const handleDragEnter = (event: DragEvent): void => {
      if (isStreaming) return;
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer || !hasSupportedDragData(dataTransfer)) return;

      dragDepth += 1;
      event.preventDefault();
      event.stopPropagation();
      setDragActive(true);
    };

    const handleDragOver = (event: DragEvent): void => {
      if (isStreaming) return;
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer || !hasSupportedDragData(dataTransfer)) return;

      event.preventDefault();
      event.stopPropagation();
      dataTransfer.dropEffect = 'copy';
      setDragActive(true);
    };

    const handleDragLeave = (event: DragEvent): void => {
      if (isStreaming) return;
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer || !hasSupportedDragData(dataTransfer)) return;

      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setDragActive(false);
      }
    };

    const handleDrop = (event: DragEvent): void => {
      if (isStreaming) return;
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer || !hasSupportedDragData(dataTransfer)) return;

      event.preventDefault();
      event.stopPropagation();
      dragDepth = 0;
      setDragActive(false);

      void attachmentsFromDataTransfer(dataTransfer, runtime.getWorkspaceFolder())
        .then((droppedAttachments) => {
          if (droppedAttachments.length === 0) return;
          setActiveView('chat');
          addAttachments(droppedAttachments);
          if (compact) {
            document.dispatchEvent(new CustomEvent('open-chat-bubble'));
          }
        })
        .catch((error) => {
          console.warn('Failed to read dropped chat context:', error);
        });
    };

    document.addEventListener('dragenter', handleDragEnter, true);
    document.addEventListener('dragover', handleDragOver, true);
    document.addEventListener('dragleave', handleDragLeave, true);
    document.addEventListener('drop', handleDrop, true);
    return () => {
      document.removeEventListener('dragenter', handleDragEnter, true);
      document.removeEventListener('dragover', handleDragOver, true);
      document.removeEventListener('dragleave', handleDragLeave, true);
      document.removeEventListener('drop', handleDrop, true);
    };
  }, [addAttachments, compact, isStreaming, runtime]);

  useEffect(() => { onDragActive?.(dragActive); }, [dragActive, onDragActive]);

  return (
    <div
      className={cn(
        'relative flex size-full min-h-0 flex-col overflow-hidden bg-background',
        isBubble && 'rounded-[18px] border shadow-xl',
      )}
    >
      <div className={cn('relative flex h-11 shrink-0 items-center justify-between border-b px-4', !isBubble && 'bg-background')}>
        {panelTitle ? (
          <span className="truncate text-sm font-medium">{panelTitle}</span>
        ) : (
          <span />
        )}
        <div className="flex items-center">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant={isChatView ? 'ghost' : 'secondary'}
                size="icon-sm"
                type="button"
                className="size-8 rounded-md"
                title="切换小工具"
                aria-label="切换小工具"
              >
                {toolViewIcon(activeView)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              onCloseAutoFocus={(event) => event.preventDefault()}
              className="min-w-40"
            >
              <DropdownMenuRadioGroup
                value={activeView}
                onValueChange={(value) => setActiveView(value as ToolView)}
              >
                {TOOL_VIEW_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    {toolViewIcon(option.value)}
                    <span>{option.label}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu modal={false} open={historyOpen} onOpenChange={handleHistoryOpenChange}>
            <DropdownMenuTrigger asChild disabled={isStreaming || !hasWorkspace}>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                className={cn('size-8 rounded-md', isStreaming && 'pointer-events-none cursor-default opacity-50')}
                title="对话历史"
                aria-label="对话历史"
              >
                <History data-icon="inline-start" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              onCloseAutoFocus={(event) => event.preventDefault()}
              className="w-[min(320px,calc(100vw-32px))] min-w-[280px] p-0"
            >
              <HistoryList
                sessions={runtime.getSessions()}
                hasWorkspace={hasWorkspace}
                onSelect={(session) => {
                  runtime.resumeConversation(session);
                  setActiveView('chat');
                  setHistoryOpen(false);
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            className={cn('size-8 rounded-md', isStreaming && 'pointer-events-none cursor-default opacity-50')}
            title="新对话"
            aria-label="新对话"
            aria-disabled={isStreaming}
            onClick={() => {
              if (isStreaming) return;
              startNewConversation();
              setActiveView('chat');
            }}
          >
            <Plus data-icon="inline-start" />
          </Button>
          {compact && (
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              className="size-8 rounded-md"
              title="关闭"
              aria-label="关闭聊天"
              onClick={() => document.dispatchEvent(new CustomEvent('close-chat-bubble'))}
            >
              <X data-icon="inline-start" />
            </Button>
          )}
        </div>
      </div>

      {isChatView ? (
        <Conversation className={cn('min-h-0', isBubble ? 'bg-muted/20' : 'bg-background')}>
          <ConversationContent className={cn('min-h-full gap-5 p-4', compact && 'gap-4 p-3', !hasMessages && 'justify-center')}>
            {!hasMessages && (
              <ConversationEmptyState
                icon={<Sparkles />}
                title={hasWorkspace ? `开始和${petName ?? '桌宠'}聊天` : '请选择桌宠'}
                description={hasWorkspace ? 'Hello World!' : '从左侧列表选择一个可用桌宠后即可对话。'}
              />
            )}
            {conversation.messages.map((message) => (
              <Message
                key={message.id}
                from={message.role}
                className={cn(
                  message.role === 'assistant'
                    ? 'max-w-full'
                    : compact ? 'max-w-[94%]' : 'max-w-[82%]',
                  message.error && 'text-destructive',
                )}
              >
                <MessageContent
                  className={cn(
                    'text-[13px] leading-relaxed',
                    message.role === 'assistant' && 'w-full max-w-full',
                  )}
                >
                  {message.role === 'assistant' && message.pending && message.parts.length === 0 ? (
                    <AssistantReasoningWait />
                  ) : (
                    message.parts.map((part) => (
                      <ChatPartView
                        key={part.id}
                        part={part}
                        role={message.role}
                        streaming={Boolean(message.pending)}
                        runtime={runtime}
                      />
                    ))
                  )}
                </MessageContent>
              </Message>
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      ) : (
        <div className={cn('min-h-0 flex-1', isBubble ? 'bg-muted/20' : 'bg-background')}>
          {activeView === 'todolist' && <TodolistPanel workspaceFolder={workspaceFolder} compact={compact} />}
          {activeView === 'pomodoro' && <PomodoroPanel workspaceFolder={workspaceFolder} compact={compact} />}
          {activeView === 'countdown' && <CountdownPanel workspaceFolder={workspaceFolder} compact={compact} />}
        </div>
      )}

      {isChatView && (
        <div className="shrink-0 border-t bg-background">
          <div className={cn('p-3', compact && 'p-2.5')}>
            <PromptInput
              className={cn(dragActive && 'rounded-lg ring-2 ring-ring/30')}
              multiple
              onSubmit={submit}
            >
              {attachments.length > 0 && (
                <PromptInputHeader>
                  <Attachments variant="inline">
                    {attachments.map((attachment) => (
                      <Attachment
                        key={attachment.id}
                        data={chatAttachmentData(attachment)}
                        draggable={false}
                        onDragStart={(event) => event.preventDefault()}
                        onRemove={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                      >
                        <AttachmentPreview
                          forceIcon
                          fallbackIcon={attachment.kind === 'text'
                            ? <FileText className="size-3 text-muted-foreground" />
                            : <FileIcon className="size-3 text-muted-foreground" />}
                        />
                        <AttachmentInfo />
                        <AttachmentRemove label={`移除 ${attachment.name}`} />
                      </Attachment>
                    ))}
                  </Attachments>
                </PromptInputHeader>
              )}
              <PromptInputBody>
                <PromptInputTextarea
                  value={inputValue}
                  disabled={!hasWorkspace}
                  readOnly={isStreaming}
                  aria-disabled={isStreaming}
                  tabIndex={isStreaming ? -1 : undefined}
                  placeholder={hasWorkspace ? '输入消息，Enter 发送' : '先选择一个桌宠'}
                  className={cn(
                    'min-h-14 text-sm',
                    compact && 'min-h-12 max-h-28',
                    isStreaming && 'pointer-events-none cursor-default select-none',
                  )}
                  onChange={(event) => setInputValue(event.currentTarget.value)}
                  onFocus={onInputFocus}
                  onBlur={onInputBlur}
                />
              </PromptInputBody>
              <PromptInputFooter>
                <PromptInputTools>
                  <PromptInputButton
                    tooltip="添加文件"
                    aria-disabled={isStreaming || !hasWorkspace}
                    className={cn(isStreaming && 'pointer-events-none cursor-default opacity-50')}
                    disabled={!hasWorkspace}
                    onClick={() => {
                      if (isStreaming) return;
                      void pickFiles();
                    }}
                  >
                    <Paperclip />
                  </PromptInputButton>
                </PromptInputTools>
                <PromptInputSubmit
                  aria-label={isStreaming ? '打断生成' : '发送消息'}
                  disabled={!isStreaming && sendDisabled}
                  status={isStreaming ? 'streaming' : 'ready'}
                  title={isStreaming ? '打断生成' : '发送'}
                  onStop={() => void runtime.interrupt()}
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      )}
    </div>
  );
}

interface HistoryListProps {
  sessions: AiSessionSummary[];
  hasWorkspace: boolean;
  onSelect: (session: AiSessionSummary) => void;
}

function HistoryList({ sessions, hasWorkspace, onSelect }: HistoryListProps): ReactNode {
  const [search, setSearch] = useState('');

  if (!hasWorkspace) {
    return <div className="px-3 py-4 text-center text-sm text-muted-foreground">请先选择桌宠工作空间</div>;
  }

  const filtered = search.trim()
    ? sessions.filter((s) => (s.title || '历史对话').toLowerCase().includes(search.trim().toLowerCase()))
    : sessions;

  return (
    <div className="flex min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b px-2.5 py-2">
        <div className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            placeholder="搜索对话标题..."
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          {search && (
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setSearch('')}
              aria-label="清除搜索"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="px-3 py-4 text-center text-sm text-muted-foreground">
          {sessions.length === 0 ? '暂无历史对话' : '无匹配结果'}
        </div>
      ) : (
        <ScrollArea className="max-h-72">
          <div className="flex flex-col gap-0.5 p-1.5 pr-2">
            {filtered.map((session) => (
              <Button
                className="h-auto w-full max-w-full shrink justify-start overflow-hidden px-2 py-2 text-left"
                variant="ghost"
                type="button"
                key={session.id}
                onClick={() => onSelect(session)}
                title={session.title || '历史对话'}
              >
                <span className="flex min-w-0 w-full flex-col gap-0.5 overflow-hidden">
                  <span className="block truncate text-sm font-medium">{session.title || '历史对话'}</span>
                  <span className="block truncate text-xs text-muted-foreground">{formatSessionTime(session.updatedAt)}</span>
                </span>
              </Button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function toolViewLabel(view: ToolView): string {
  return TOOL_VIEW_OPTIONS.find((option) => option.value === view)?.label ?? '小工具';
}

function toolViewIcon(view: ToolView): ReactNode {
  if (view === 'chat') return <MessageCircle data-icon="inline-start" />;
  if (view === 'todolist') return <ListTodo data-icon="inline-start" />;
  if (view === 'pomodoro') return <Timer data-icon="inline-start" />;
  return <CalendarDays data-icon="inline-start" />;
}

interface ChatPartViewProps {
  part: ChatMessagePart;
  role: 'user' | 'assistant';
  streaming: boolean;
  runtime: ChatRuntime;
}

function AssistantReasoningWait(): ReactNode {
  return (
    <Reasoning
      className="mb-0 rounded-lg border border-border/70 bg-background/80 px-3 py-2"
      defaultOpen
      isStreaming
    >
      <ReasoningTrigger className="text-xs" />
    </Reasoning>
  );
}

function ChatPartView({ part, role, streaming, runtime }: ChatPartViewProps): ReactNode {
  if (part.kind === 'status' && part.title === '会话') return null;

  if (role === 'user') {
    if (part.kind === 'path') {
      return (
        <div className="flex items-center gap-2 rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground">
          <FileIcon />
          <span className="truncate">{part.title || part.text}</span>
        </div>
      );
    }

    if (part.kind === 'attachment') {
      return (
        <div className="flex max-w-full flex-col gap-1 rounded-md bg-background/70 px-2 py-1.5 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2 font-medium">
            <FileText />
            <span className="truncate">{part.title || '拖入文本'}</span>
          </span>
          <span className="max-h-10 overflow-hidden break-words leading-relaxed">{part.text}</span>
        </div>
      );
    }

    return <MessageResponse isAnimating={streaming}>{part.text}</MessageResponse>;
  }

  if (part.kind === 'thinking') {
    return (
      <Reasoning
        className="mb-0 rounded-lg border border-border/70 bg-background/80 px-3 py-2"
        defaultOpen={streaming}
        isStreaming={streaming}
      >
        <ReasoningTrigger className="text-xs" />
        {part.text.trim() && (
          <ReasoningContent className="mt-3 text-xs leading-relaxed">
            {part.text}
          </ReasoningContent>
        )}
      </Reasoning>
    );
  }

  if (part.kind === 'tool' || part.kind === 'mcp' || part.kind === 'skill') {
    return <ToolPartView part={part} streaming={streaming} />;
  }

  if (part.kind === 'question') {
    return <ToolQuestionPartView part={part} runtime={runtime} streaming={streaming} />;
  }

  if (part.kind === 'path') {
    return (
      <div className="rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-sm">
        <PathText value={part.text} />
      </div>
    );
  }

  if (part.kind === 'status') {
    return (
      <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <MessageResponse isAnimating={streaming}>{part.text}</MessageResponse>
      </div>
    );
  }

  return (
    <div className="rounded-lg text-sm">
      <MessageResponse isAnimating={streaming}>{part.text}</MessageResponse>
    </div>
  );
}

function ToolQuestionPartView({
  part,
  runtime,
  streaming,
}: {
  part: ChatMessagePart;
  runtime: ChatRuntime;
  streaming: boolean;
}): ReactNode {
  const data = getToolQuestionData(part);
  if (!data) {
    return <ToolPartView part={{ ...part, kind: 'tool' }} streaming={streaming} />;
  }

  const state = data.status === 'answered'
    ? 'approval-responded'
    : data.status === 'error'
      ? 'output-error'
      : 'approval-requested';

  return (
    <Tool
      className="mb-0 border-border/70 bg-background/80 shadow-none"
      defaultOpen={data.status !== 'answered'}
    >
      <ToolHeader
        className="p-2.5"
        state={state}
        title={data.title || (data.kind === 'permission' ? `确认 ${data.toolName}` : '需要你的选择')}
        type={'tool-question' as ToolUIPart['type']}
      />
      <ToolContent className="p-3 pt-0">
        <ToolQuestionForm
          data={data}
          partId={part.id}
          runtime={runtime}
        />
      </ToolContent>
    </Tool>
  );
}

function ToolQuestionForm({
  data,
  partId,
  runtime,
}: {
  data: ToolQuestionPartData;
  partId: string;
  runtime: ChatRuntime;
}): ReactNode {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [activePreviews, setActivePreviews] = useState<Record<string, string>>({});

  if (data.status === 'answered') {
    return <ToolQuestionAnswerSummary response={data.response} />;
  }

  const disabled = data.status === 'submitting';
  const canSubmit = data.questions.every((question) => questionAnswerValues(question, answers, customAnswers).length > 0);

  const toggleOption = (question: ToolQuestionItem, option: ToolQuestionOption): void => {
    const key = question.question;
    setAnswers((current) => {
      const selected = current[key] ?? [];
      if (question.multiSelect) {
        return {
          ...current,
          [key]: selected.includes(option.label)
            ? selected.filter((value) => value !== option.label)
            : [...selected, option.label],
        };
      }

      return {
        ...current,
        [key]: [option.label],
      };
    });
    if (!question.multiSelect) {
      setCustomAnswers((current) => ({ ...current, [key]: '' }));
    }
    if (option.preview) {
      setActivePreviews((current) => ({ ...current, [key]: option.preview ?? '' }));
    }
  };

  const updateCustomAnswer = (question: ToolQuestionItem, value: string): void => {
    const key = question.question;
    setCustomAnswers((current) => ({ ...current, [key]: value }));
    if (!question.multiSelect && value.trim()) {
      setAnswers((current) => ({ ...current, [key]: [] }));
    }
  };

  const submitAnswer = (): void => {
    if (!canSubmit || disabled) return;

    const response: ToolQuestionAnswerPayload = { answers: {}, annotations: {} };
    for (const question of data.questions) {
      response.answers[question.question] = questionAnswerValues(question, answers, customAnswers);

      const preview = selectedPreview(question, answers, activePreviews);
      if (preview) {
        response.annotations![question.question] = { preview };
      }
    }

    if (Object.keys(response.annotations ?? {}).length === 0) {
      delete response.annotations;
    }

    void runtime.answerToolQuestion(partId, data.id, response);
  };

  return (
    <div className="space-y-3">
      {data.description && (
        <p className="text-xs leading-relaxed text-muted-foreground">{data.description}</p>
      )}
      {data.questions.map((question, index) => {
        const key = question.question;
        const selected = answers[key] ?? [];
        const custom = customAnswers[key] ?? '';
        const preview = activePreviews[key] || selectedPreview(question, answers, activePreviews);

        return (
          <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-2.5" key={`${question.question}-${index}`}>
            <div className="flex items-start gap-2">
              <Badge variant="secondary" className="mt-0.5 shrink-0">{question.header || `问题 ${index + 1}`}</Badge>
              <p className="min-w-0 flex-1 text-sm font-medium leading-relaxed">{question.question}</p>
            </div>
            <div className="grid gap-1.5">
              {question.options.map((option) => {
                const isSelected = selected.includes(option.label);
                return (
                  <Button
                    key={option.label}
                    type="button"
                    variant={isSelected ? 'secondary' : 'outline'}
                    className="h-auto min-h-10 justify-start whitespace-normal rounded-md px-2.5 py-2 text-left"
                    disabled={disabled}
                    onClick={() => toggleOption(question, option)}
                    onFocus={() => option.preview && setActivePreviews((current) => ({ ...current, [key]: option.preview ?? '' }))}
                    onMouseEnter={() => option.preview && setActivePreviews((current) => ({ ...current, [key]: option.preview ?? '' }))}
                  >
                    <span className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                      isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                    )}>
                      {isSelected && <Check className="size-3" />}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-medium leading-snug">{option.label}</span>
                      <span className="text-xs leading-relaxed text-muted-foreground">{option.description}</span>
                    </span>
                  </Button>
                );
              })}
            </div>
            {preview && (
              <div className="rounded-md bg-background/80 px-2.5 py-2 text-xs leading-relaxed">
                <MessageResponse isAnimating={false}>{preview}</MessageResponse>
              </div>
            )}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CircleQuestionMark className="size-3.5" />
                <span>自定义回答</span>
              </div>
              <Textarea
                value={custom}
                disabled={disabled}
                placeholder={question.multiSelect ? '可补充一个自定义选项' : '选择其他答案时填写'}
                className="min-h-10 resize-none rounded-md text-xs"
                onChange={(event) => updateCustomAnswer(question, event.currentTarget.value)}
              />
            </div>
          </div>
        );
      })}
      {data.error && (
        <div className="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">{data.error}</div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {data.status === 'submitting' ? '正在回传...' : '选择会继续当前回复'}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={!canSubmit || disabled}
          onClick={submitAnswer}
        >
          <SendHorizontal data-icon="inline-start" />
          回答
        </Button>
      </div>
    </div>
  );
}

function ToolQuestionAnswerSummary({ response }: { response?: ToolQuestionAnswerPayload }): ReactNode {
  const entries = Object.entries(response?.answers ?? {});
  if (entries.length === 0) {
    return <div className="text-xs text-muted-foreground">已回传回答。</div>;
  }

  return (
    <div className="space-y-2">
      {entries.map(([question, answer]) => (
        <div className="rounded-md bg-muted/40 px-2.5 py-2 text-xs" key={question}>
          <div className="mb-1 text-muted-foreground">{question}</div>
          <div className="font-medium text-foreground">{answer.join(', ')}</div>
        </div>
      ))}
    </div>
  );
}

function ToolPartView({ part, streaming }: { part: ChatMessagePart; streaming: boolean }): ReactNode {
  const content = (
    <MessageResponse isAnimating={streaming}>
      {part.text}
    </MessageResponse>
  );

  return (
    <Tool
      className="mb-0 border-border/70 bg-background/80 shadow-none"
      defaultOpen={streaming}
    >
      <ToolHeader
        className="p-2.5"
        state={streaming ? 'input-available' : 'output-available'}
        title={part.title || toolDisplayName(part.kind)}
        type={toolUiType(part)}
      />
      <ToolContent className="p-3 pt-0">
        <ToolOutput output={content as ToolUIPart['output']} errorText={undefined} />
      </ToolContent>
    </Tool>
  );
}


function questionAnswerValues(
  question: ToolQuestionItem,
  answers: Record<string, string[]>,
  customAnswers: Record<string, string>,
) : string[] {
  const selected = answers[question.question] ?? [];
  const custom = customAnswers[question.question]?.trim();
  return [...selected, ...(custom ? [custom] : [])];
}

function selectedPreview(
  question: ToolQuestionItem,
  answers: Record<string, string[]>,
  activePreviews: Record<string, string>,
): string {
  const active = activePreviews[question.question];
  if (active) return active;

  const selected = answers[question.question] ?? [];
  const option = question.options.find((item) => selected.includes(item.label) && item.preview);
  return option?.preview ?? '';
}

function PathText({ value }: { value: string }): ReactNode {
  const pattern = /([A-Za-z]:\\[^\s<>"']+|(?:\.{1,2}\/|\/)[^\s<>"']+)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(pattern)) {
    const path = match[0];
    const index = match.index ?? 0;
    nodes.push(value.slice(lastIndex, index));
    nodes.push(<span className="rounded bg-muted px-1 font-mono text-xs" key={`${path}-${index}`}>{path}</span>);
    lastIndex = index + path.length;
  }

  nodes.push(value.slice(lastIndex));
  return <>{nodes}</>;
}

export function setupChatBubble(stage: HTMLElement, canvas: HTMLCanvasElement): ChatBubbleController {
  const bubble = document.getElementById('chat-bubble');
  if (!bubble) throw new Error('Chat bubble element not found');
  const win = safeCurrentWindow();
  let open = false;
  let desiredOpen = false;
  let transitionRunning = false;
  let pointerStart: { x: number; y: number } | null = null;

  const currentPetSize = (): Size => ({
    width: canvas.offsetWidth || canvas.width,
    height: canvas.offsetHeight || canvas.height,
  });

  const createLayout = (base: Size, withBubble: boolean): BubbleLayout => calculateBubbleLayout(base, withBubble);

  const applyBubbleLayout = (layout: BubbleLayout, petSize: Size): void => {
    stage.style.setProperty('--pet-offset-x', `${layout.petOffsetX}px`);
    stage.style.setProperty('--pet-offset-y', `${layout.petOffsetY}px`);
    stage.style.setProperty('--bubble-width', `${BUBBLE_WIDTH}px`);
    stage.style.setProperty('--bubble-left', `${layout.petOffsetX + petSize.width / 2}px`);
    stage.style.setProperty('--bubble-height', `${BUBBLE_HEIGHT}px`);
    stage.style.setProperty('--bubble-gap', `${BUBBLE_GAP}px`);
    stage.style.setProperty('--bubble-top', `${layout.bubbleTop}px`);
  };

  const resolvePetWindowSize = (base: Size): Size => {
    const petSize = base.width > 0 && base.height > 0 ? base : currentPetSize();
    const layout = createLayout(petSize, open);
    applyBubbleLayout(layout, petSize);
    return { width: layout.width, height: layout.height };
  };

  const syncWindowFrame = async (previousLayout: BubbleLayout, nextLayout: BubbleLayout): Promise<void> => {
    if (!win) return;

    const [position, scaleFactor] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
    const dx = Math.round((previousLayout.petOffsetX - nextLayout.petOffsetX) * scaleFactor);
    const dy = Math.round((previousLayout.petOffsetY - nextLayout.petOffsetY) * scaleFactor);
    const updates: Promise<void>[] = [win.setSize(new LogicalSize(nextLayout.width, nextLayout.height))];
    if (dx !== 0 || dy !== 0) {
      updates.push(win.setPosition(new PhysicalPosition(position.x + dx, position.y + dy)));
    }
    await Promise.all(updates);
  };

  const applyOpenLayout = (next: boolean, layout: BubbleLayout, petSize: Size): void => {
    open = next;
    bubble.hidden = !open;
    stage.classList.toggle('chat-open', open);
    applyBubbleLayout(layout, petSize);
  };

  const runOpenTransition = async (): Promise<void> => {
    if (transitionRunning) return;
    transitionRunning = true;
    stage.dataset.bubbleTransition = 'true';

    try {
      while (desiredOpen !== open) {
        const next = desiredOpen;
        const petSize = currentPetSize();
        const previousLayout = createLayout(petSize, open);
        const nextLayout = createLayout(petSize, next);

        applyOpenLayout(next, nextLayout, petSize);
        await syncWindowFrame(previousLayout, nextLayout);
      }
    } catch (error) {
      console.warn('Failed to sync chat bubble window:', error);
    } finally {
      transitionRunning = false;
      delete stage.dataset.bubbleTransition;
      if (desiredOpen !== open) {
        void runOpenTransition();
      }
    }
  };

  const setOpen = (next: boolean, syncFrame = true): void => {
    if (next === desiredOpen && (!transitionRunning || next === open)) return;
    desiredOpen = next;
    const petSize = currentPetSize();
    const nextLayout = createLayout(petSize, next);
    if (!syncFrame) {
      applyOpenLayout(next, nextLayout, petSize);
      return;
    }

    void runOpenTransition();
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointerStart = { x: event.screenX, y: event.screenY };
  });

  canvas.addEventListener('pointerup', (event) => {
    if (event.button !== 0 || !pointerStart) return;
    const dx = event.screenX - pointerStart.x;
    const dy = event.screenY - pointerStart.y;
    pointerStart = null;
    if (Math.hypot(dx, dy) > 6) return;
    setOpen(!open);
  });

  document.addEventListener('close-chat-bubble', (event) => {
    const syncFrame = !(event instanceof CustomEvent) || event.detail?.syncFrame !== false;
    setOpen(false, syncFrame);
  });

  document.addEventListener('open-chat-bubble', (event) => {
    const syncFrame = !(event instanceof CustomEvent) || event.detail?.syncFrame !== false;
    setOpen(true, syncFrame);
  });

  return {
    resolvePetWindowSize,
    close: () => setOpen(false),
  };
}

function chatAttachmentData(attachment: ChatAttachment): AttachmentData {
  if (attachment.kind === 'text') {
    return {
      id: attachment.id,
      type: 'file',
      filename: attachment.name,
      mediaType: attachment.mediaType ?? 'text/plain',
      url: '',
    };
  }

  return {
    id: attachment.id,
    type: 'file',
    filename: attachment.name,
    mediaType: attachment.mediaType ?? 'application/octet-stream',
    url: attachment.path ?? '',
  };
}

function attachmentIdentity(attachment: ChatAttachment): string {
  if (attachment.kind === 'text') {
    return `text:${normalizeTextForIdentity(attachment.text ?? '')}`;
  }

  return `file:${attachment.path ?? ''}`;
}

function normalizeTextForIdentity(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function formatSessionTime(value: number): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function toolUiType(part: ChatMessagePart): ToolUIPart['type'] {
  return `tool-${part.kind}` as ToolUIPart['type'];
}

function toolDisplayName(kind: ChatMessagePart['kind']): string {
  if (kind === 'mcp') return 'MCP 调用';
  if (kind === 'skill') return 'Skill';
  return '工具调用';
}

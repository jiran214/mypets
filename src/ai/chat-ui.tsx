import { getCurrentWindow, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { hasTauriRuntime, safeCurrentWindow } from '@/lib/tauri-utils';
import { useCollapseScrollPreservation } from '@/lib/use-collapse-scroll-preservation';
import { getToolQuestionData } from '@/lib/ai-utils';
import {
  Check,
  CalendarDays,
  Lightbulb,
  ChevronDown,
  CircleQuestionMark,
  Clock,
  FileIcon,
  FilePenLine,
  FileText,
  FolderOpen,
  History,
  ListTodo,
  MessageCircle,
  Paperclip,
  PenLine,
  Plug,
  Plus,
  Search,
  SendHorizontal,
  Sparkles,
  SquareTerminal,
  Timer,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
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
import { Shimmer } from '@/components/ai-elements/shimmer';
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought';
import { Task, TaskTrigger, TaskContent } from '@/components/ai-elements/task';
import { CodeBlock } from '@/components/ai-elements/code-block';
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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  ChatMessage,
  ChatMessagePart,
  ToolTrace,
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
import { openFileWithDefaultApp, saveAiSettings } from './ai-api';
import {
  buildChainOfThought,
  type ChainOfThoughtModel,
  type TimelineItem,
} from './timeline';
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

const THINKING_LEVELS: readonly string[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

function ThinkingSelector({ runtime, disabled }: { runtime: ChatRuntime; disabled?: boolean }): ReactNode {
  const aiState = runtime.getAiState();
  if (!aiState) return null;

  const { pi } = aiState.settings;
  const currentLevel = pi.thinkingLevel;

  const handleChange = async (level: string) => {
    const settings = { ...aiState.settings };
    settings.pi = { ...settings.pi, thinkingLevel: level as typeof pi.thinkingLevel };
    const newState = await saveAiSettings(runtime.getWorkspaceFolder(), settings);
    runtime.setAiState(newState);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PromptInputButton
          tooltip="思考强度"
          disabled={disabled}
          aria-disabled={disabled}
          className={cn(disabled && 'pointer-events-none cursor-default opacity-50')}
        >
          <Lightbulb />
        </PromptInputButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={6}>
        <DropdownMenuRadioGroup value={currentLevel} onValueChange={(v) => { void handleChange(v); }}>
          {THINKING_LEVELS.map((level) => (
            <DropdownMenuRadioItem key={level} value={level} className="text-xs">
              {level}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChatPanel({ runtime, compact = false, variant, petName, onInputFocus, onInputBlur, onDragActive }: ChatPanelProps): ReactNode {
  const [renderVersion, forceRender] = useState(0);
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
  const sendDisabled = isStreaming || (!inputValue.trim() && attachments.length === 0) || !hasWorkspace;
  const pendingQuestions = pendingToolQuestionParts(conversation.messages);
  const hasPendingQuestion = pendingQuestions.length > 0;

  const conversationTree = useMemo(() => {
    const messages = conversation.messages;
    const hasMessages = messages.length > 0;

    return (
      <Conversation className={cn('min-h-0', isBubble ? 'bg-muted/20' : 'bg-background')}>
        <ConversationContent className={cn('min-h-full gap-5 p-4', compact && 'gap-4 p-3', !hasMessages && 'justify-center')}>
          {!hasMessages && (
            <ConversationEmptyState
              icon={<Sparkles />}
              title={hasWorkspace ? `开始和${petName ?? '桌宠'}聊天` : '请选择桌宠'}
              description={hasWorkspace ? 'Hello World!' : '从左侧列表选择一个可用桌宠后即可对话。'}
            />
          )}
          {messages.map((message) => (
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
                ) : message.role === 'assistant' ? (
                  <AssistantTimelineParts
                    parts={message.parts}
                    streaming={Boolean(message.pending)}
                  />
                ) : (
                  message.parts.map((part) => (
                    <ChatPartView
                      key={part.id}
                      part={part}
                      role={message.role}
                      streaming={Boolean(message.pending)}
                    />
                  ))
                )}
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    );
  }, [renderVersion, compact, isBubble, hasWorkspace, petName]);

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
      <div className={cn('relative flex h-11 shrink-0 items-center justify-between border-b px-2', !isBubble && 'bg-background')}>
        <div className="flex items-center gap-1.5">
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
              align="start"
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
          {panelTitle ? (
            <span className="truncate text-sm font-medium">{panelTitle}</span>
          ) : (
            <span />
          )}
        </div>
        <div className="flex items-center">
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
              collisionPadding={isBubble ? 12 : 16}
              className={cn(
                'max-w-[calc(100vw-16px)] p-0!',
                isBubble ? 'w-[220px]! min-w-[220px]!' : 'w-[300px]! min-w-[300px]!',
              )}
            >
              <HistoryList
                sessions={runtime.getSessions()}
                hasWorkspace={hasWorkspace}
                compact={isBubble}
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

      {isChatView ? conversationTree : (
        <div className={cn('min-h-0 flex-1', isBubble ? 'bg-muted/20' : 'bg-background')}>
          {activeView === 'todolist' && <TodolistPanel workspaceFolder={workspaceFolder} compact={compact} />}
          {activeView === 'pomodoro' && <PomodoroPanel workspaceFolder={workspaceFolder} compact={compact} />}
          {activeView === 'countdown' && <CountdownPanel workspaceFolder={workspaceFolder} compact={compact} />}
        </div>
      )}

      {isChatView && (
        <div className="shrink-0 border-t bg-background">
          <div className={cn('p-3', compact && 'p-2.5')}>
            {hasPendingQuestion ? (
              <QuestionOverlay
                compact={compact}
                onInputBlur={onInputBlur}
                onInputFocus={onInputFocus}
                pendingQuestions={pendingQuestions}
                runtime={runtime}
              />
            ) : (
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
                    <ThinkingSelector runtime={runtime} disabled={isStreaming || !hasWorkspace} />
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface HistoryListProps {
  sessions: AiSessionSummary[];
  hasWorkspace: boolean;
  compact?: boolean;
  onSelect: (session: AiSessionSummary) => void;
}

function HistoryList({ sessions, hasWorkspace, compact, onSelect }: HistoryListProps): ReactNode {
  const [search, setSearch] = useState('');

  if (!hasWorkspace) {
    return <div className="px-3 py-4 text-center text-sm text-muted-foreground">请先选择桌宠工作空间</div>;
  }

  const filtered = search.trim()
    ? sessions.filter((s) => (s.title || '历史对话').toLowerCase().includes(search.trim().toLowerCase()))
    : sessions;

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden', compact ? 'h-[min(248px,calc(100vh-32px))]' : 'h-[min(320px,calc(100vh-48px))]')}>
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
        <ScrollArea className="min-h-0 flex-1">
          <div className={cn('flex flex-col p-1', compact ? 'gap-0' : 'gap-px')}>
            {filtered.map((session) => (
              <Button
                className={cn(
                  'grid h-auto w-full grid-cols-[minmax(0,1fr)] shrink! min-w-0 max-w-full justify-start overflow-hidden whitespace-normal! px-2 text-left',
                  compact ? 'py-1' : 'py-1.5',
                )}
                variant="ghost"
                type="button"
                key={session.id}
                onClick={() => onSelect(session)}
                title={session.title || '历史对话'}
              >
                <span className="block min-w-0 w-full overflow-hidden">
                  <span className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium">{session.title || '历史对话'}</span>
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
}

function AssistantReasoningWait(): ReactNode {
  return (
    <ChainOfThoughtView
      chain={{ id: 'pending-chain-of-thought', items: [], summaryParts: [] }}
      streaming
    />
  );
}

const SKIP_ANSWER_LABEL = '跳过';

interface PendingToolQuestionPart {
  partId: string;
  data: ToolQuestionPartData;
}

function pendingToolQuestionParts(messages: ChatMessage[]): PendingToolQuestionPart[] {
  const pending: PendingToolQuestionPart[] = [];

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.kind !== 'question') continue;
      const data = getToolQuestionData(part);
      if (data?.status === 'pending') {
        pending.push({ partId: part.id, data });
      }
    }
  }

  return pending;
}

function ChatPartView({ part, role, streaming }: ChatPartViewProps): ReactNode {
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

  return (
    <div className="rounded-lg text-sm">
      <MessageResponse isAnimating={streaming}>{part.text}</MessageResponse>
    </div>
  );
}

function AssistantTimelineParts({
  parts,
  streaming,
}: {
  parts: ChatMessagePart[];
  streaming: boolean;
}): ReactNode {
  const chain = buildChainOfThought(parts);

  return (
    <>
      {(chain.items.length > 0 || streaming) && (
        <ChainOfThoughtView chain={chain} streaming={streaming} />
      )}
      {chain.summaryParts.map((part) => (
        <div className="rounded-lg text-sm" key={part.id}>
          <MessageResponse isAnimating={streaming}>{part.text}</MessageResponse>
        </div>
      ))}
    </>
  );
}

function ChainOfThoughtView({
  chain,
  streaming,
}: {
  chain: ChainOfThoughtModel;
  streaming: boolean;
}): ReactNode {
  const taskRef = useRef<HTMLDivElement>(null);
  const [taskOpen, setTaskOpen] = useState(true);
  const setTaskOpenRef = useRef(setTaskOpen);
  setTaskOpenRef.current = setTaskOpen;
  const { onOpenChange: taskOnOpenChange } = useCollapseScrollPreservation(taskRef, setTaskOpenRef);

  const chainRef = useRef<HTMLDivElement>(null);
  const [chainOpen, setChainOpen] = useState(true);
  const setChainOpenRef = useRef(setChainOpen);
  setChainOpenRef.current = setChainOpen;
  const { onOpenChange: chainOnOpenChange } = useCollapseScrollPreservation(chainRef, setChainOpenRef);

  return (
    <Task ref={taskRef} className="mb-2" open={taskOpen} onOpenChange={taskOnOpenChange}>
      <TaskTrigger title="思考过程" asChild>
        <div className="flex w-full cursor-pointer items-center gap-2 text-sm transition-colors hover:text-foreground">
          <Sparkles className="size-4" />
          {streaming ? (
            <Shimmer className="text-sm">思考中...</Shimmer>
          ) : (
            <span className="text-sm">已思考</span>
          )}
          <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
        </div>
      </TaskTrigger>
      <TaskContent>
        <div ref={chainRef}>
        <ChainOfThought className="px-0" open={chainOpen} onOpenChange={chainOnOpenChange}>
          {chain.items.length > 0 && (
            <ChainOfThoughtContent>
              <div className="space-y-2 pl-0.5">
                {chain.items.map((item) => (
                  <TimelineCollapsibleItem
                    key={item.id}
                    item={item}
                    streaming={streaming}
                  />
                ))}
              </div>
            </ChainOfThoughtContent>
          )}
        </ChainOfThought>
        </div>
      </TaskContent>
    </Task>
  );
}

function TimelineCollapsibleItem({
  item,
  streaming,
}: {
  item: TimelineItem;
  streaming: boolean;
}): ReactNode {
  const description = item.description || item.path;
  const isPartial = streaming && item.traces.some((t) => t.partial);
  const isHiddenTool = item.kind === 'read' || item.kind === 'write' || item.kind === 'edit';

  const isThinking = item.kind === 'thinking';
  const thinkingSnippet = isThinking ? getThinkingSnippet(item.traces[0]?.output) : undefined;

  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const setIsOpenRef = useRef(setIsOpen);
  setIsOpenRef.current = setIsOpen;
  const { onOpenChange } = useCollapseScrollPreservation(containerRef, setIsOpenRef);

  if (isHiddenTool) {
    return (
      <ChainOfThoughtStep
        icon={timelineItemIcon(item.kind)}
        label={
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="shrink-0 font-medium">{item.label}</span>
            {item.path ? (
              <PathInlineButton path={item.path} title={item.path} />
            ) : description ? (
              <span className="min-w-0 truncate text-muted-foreground">{description}</span>
            ) : null}
          </div>
        }
        status={isPartial ? 'active' : 'complete'}
      />
    );
  }

  return (
    <ChainOfThoughtStep
      icon={timelineItemIcon(item.kind)}
      label={
        <Collapsible ref={containerRef} className="group" open={isOpen} onOpenChange={onOpenChange}>
          <CollapsibleTrigger asChild>
            <div className="flex min-w-0 cursor-pointer items-center gap-1.5 text-xs">
              <span className="shrink-0 font-medium">{item.label}</span>
              {thinkingSnippet ? (
                <span className="min-w-0 truncate text-muted-foreground group-data-[state=open]:hidden">{thinkingSnippet}</span>
              ) : description ? (
                <span className="min-w-0 truncate text-muted-foreground">{description}</span>
              ) : null}
              <ChevronDown className="size-3 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1">
            <div className="space-y-2 pt-2 text-xs">
              {(item.kind === 'bash' ? item.traces.slice(-1) : item.traces).map((trace, index) => (
                <TimelineTraceDetail
                  key={`${trace.id}-${trace.phase}-${index}`}
                  index={item.traces.length > 1 ? index + 1 : undefined}
                  part={item.parts[index] ?? item.parts[0]}
                  trace={trace}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      }
      status={isPartial ? 'active' : 'complete'}
    />
  );
}

function TimelineTraceDetail({
  trace,
  part,
  index,
}: {
  trace: ToolTrace;
  part: ChatMessagePart;
  index?: number;
}): ReactNode {
  const output = trace.output ?? (trace.phase === 'output' || trace.phase === 'update' || trace.phase === 'status'
    ? fallbackTraceText(part)
    : undefined);

  if (trace.kind === 'bash') {
    const text = trace.error ?? output;
    if (!text) return null;
    return (
      <div className="max-h-48 overflow-y-auto rounded-md bg-zinc-100 p-3 text-xs">
        <pre className="whitespace-pre-wrap font-mono text-zinc-800">{String(text).replace(/\n{2,}/g, '\n')}</pre>
      </div>
    );
  }

  if (trace.label === '思考') {
    if (!output) return null;
    return <pre className="whitespace-pre-wrap wrap-break-word font-sans text-xs">{String(output)}</pre>;
  }

  if (trace.kind === 'status') {
    if (!output) return null;
    return <div className="whitespace-pre-wrap wrap-break-word text-xs text-foreground/80">{String(output)}</div>;
  }

  const input = trace.input ?? (trace.phase === 'input' ? fallbackTraceText(part) : undefined);

  return (
    <div className="space-y-2 py-1 leading-relaxed">
      {index && <div className="text-[11px] text-muted-foreground">#{index}</div>}
      {trace.path && <PathOpenButton path={trace.path} title={trace.path} />}
      {trace.description && !['read', 'edit', 'write'].includes(trace.kind) && (
        <div className="break-words text-muted-foreground">{trace.description}</div>
      )}
      {input !== undefined && (
        <TraceValueBlock
          label="输入"
          language="json"
          value={input}
        />
      )}
      {(output !== undefined || trace.phase === 'output') && (
        <TraceValueBlock
          emptyText="暂无输出"
          label={trace.error ? '错误' : trace.label === '思考' ? '内容' : trace.phase === 'update' ? '更新' : '输出'}
          language="markdown"
          value={trace.error ?? output}
          error={Boolean(trace.error)}
        />
      )}
    </div>
  );
}

function TraceValueBlock({
  emptyText,
  error,
  label,
  language,
  value,
}: {
  emptyText?: string;
  error?: boolean;
  label: string;
  language: 'bash' | 'json' | 'markdown';
  value: unknown;
}): ReactNode {
  const text = valueToCode(value);
  if (!text.trim()) {
    if (!emptyText) return null;
    return (
      <div className="space-y-1">
        <div className="font-medium text-[11px] text-muted-foreground">{label}</div>
        <div className="px-2.5 py-2 text-muted-foreground">{emptyText}</div>
      </div>
    );
  }

  return (
    <div className="space-y-1 overflow-hidden">
      <div className="font-medium text-[11px] text-muted-foreground">{label}</div>
      <div className={cn('overflow-x-auto text-foreground', error && 'text-destructive')}>
        <CodeBlock code={text} language={language} />
      </div>
    </div>
  );
}

function PathInlineButton({ path, title }: { path: string; title?: string }): ReactNode {
  const trimmed = path.trim();
  if (!trimmed) return null;

  return (
    <button
      type="button"
      className="min-w-0 truncate rounded-sm px-0.5 font-mono text-[11px] text-foreground/80 underline-offset-2 transition-colors hover:text-foreground hover:underline"
      title={trimmed}
      onClick={(event) => {
        event.stopPropagation();
        void openFileWithDefaultApp(trimmed).catch((error) => {
          console.warn('Failed to open path:', error);
        });
      }}
    >
      {title || trimmed}
    </button>
  );
}

function getThinkingSnippet(output: unknown): string | undefined {
  if (typeof output !== 'string') return undefined;
  const text = output.trim();
  if (!text) return undefined;
  const firstLine = text.split('\n')[0] ?? text;
  return firstLine.length > 40 ? firstLine.slice(0, 40) + '...' : firstLine;
}

function timelineItemIcon(kind: TimelineItem['kind']): LucideIcon | undefined {
  if (kind === 'thinking') return undefined;
  if (kind === 'bash') return SquareTerminal;
  if (kind === 'read') return FileText;
  if (kind === 'edit') return PenLine;
  if (kind === 'write') return FilePenLine;
  if (kind === 'mcp') return Plug;
  if (kind === 'status') return Clock;
  if (kind === 'plan') return Sparkles;
  return Wrench;
}

function fallbackTraceText(part: ChatMessagePart): string | undefined {
  return part.text.trim() ? part.text : undefined;
}

function valueToCode(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function PathOpenButton({ path, title }: { path: string; title?: string }): ReactNode {
  const trimmed = path.trim();
  if (!trimmed) return null;

  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center gap-2 rounded-md bg-background/70 px-2.5 py-2 text-left font-mono text-xs text-foreground transition-colors hover:bg-background"
      title={trimmed}
      onClick={() => {
        void openFileWithDefaultApp(trimmed).catch((error) => {
          console.warn('Failed to open path:', error);
        });
      }}
    >
      <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{title || trimmed}</span>
    </button>
  );
}

function QuestionOverlay({
  compact,
  onInputBlur,
  onInputFocus,
  pendingQuestions,
  runtime,
}: {
  compact?: boolean;
  onInputBlur?: () => void;
  onInputFocus?: () => void;
  pendingQuestions: PendingToolQuestionPart[];
  runtime: ChatRuntime;
}): ReactNode {
  const current = pendingQuestions[0];
  if (!current) return null;

  const title = current.data.title || (current.data.kind === 'permission' ? `确认 ${current.data.toolName}` : '需要你的选择');
  return (
    <div className={cn('rounded-lg border border-border/80 bg-muted/20 px-2.5 py-2 shadow-sm', compact && 'px-2 py-1.5')}>
      <div className="mb-1.5 flex items-center gap-2">
        <Badge variant="secondary" className="shrink-0 rounded-full text-[10px] px-1.5 py-0">
          1/{pendingQuestions.length}
        </Badge>
        <CircleQuestionMark className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="truncate text-xs font-medium">{title}</div>
      </div>
      <ToolQuestionForm
        compact={compact}
        data={current.data}
        key={current.partId}
        onInputBlur={onInputBlur}
        onInputFocus={onInputFocus}
        onSkip={() => {
          void runtime.answerToolQuestion(current.partId, current.data.id, buildSkipQuestionResponse(current.data));
        }}
        partId={current.partId}
        runtime={runtime}
        submitLabel="提交"
      />
    </div>
  );
}

function ToolQuestionForm({
  compact,
  data,
  onInputBlur,
  onInputFocus,
  onSkip,
  partId,
  runtime,
  submitLabel = '回答',
}: {
  compact?: boolean;
  data: ToolQuestionPartData;
  onInputBlur?: () => void;
  onInputFocus?: () => void;
  onSkip?: () => void;
  partId: string;
  runtime: ChatRuntime;
  submitLabel?: string;
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
    <div className="space-y-1.5">
      {data.questions.map((question, index) => {
        const key = question.question;
        const selected = answers[key] ?? [];
        const custom = customAnswers[key] ?? '';
        const preview = activePreviews[key] || selectedPreview(question, answers, activePreviews);

        return (
          <div className={cn('space-y-1.5 rounded-md bg-muted/30 px-2 py-1.5', compact && 'px-1.5 py-1')} key={`${question.question}-${index}`}>
            <div className="grid gap-1">
              {question.options.map((option) => {
                const isSelected = selected.includes(option.label);
                return (
                  <Button
                    key={option.label}
                    type="button"
                    variant={isSelected ? 'secondary' : 'outline'}
                    className="h-auto min-h-8 justify-start whitespace-normal rounded-md px-2 py-1 text-left"
                    disabled={disabled}
                    onClick={() => toggleOption(question, option)}
                    onFocus={() => option.preview && setActivePreviews((current) => ({ ...current, [key]: option.preview ?? '' }))}
                    onMouseEnter={() => option.preview && setActivePreviews((current) => ({ ...current, [key]: option.preview ?? '' }))}
                  >
                    <span className={cn(
                      'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                      isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                    )}>
                      {isSelected && <Check className="size-2.5" />}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-xs font-medium leading-snug">{option.label}</span>
                    </span>
                  </Button>
                );
              })}
            </div>
            {preview && (
              <div className="rounded-md bg-background/80 px-2 py-1 text-xs leading-relaxed">
                <MessageResponse isAnimating={false}>{preview}</MessageResponse>
              </div>
            )}
            <div className="space-y-0.5">
              <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <CircleQuestionMark className="size-3" />
                <span>自定义回答</span>
              </div>
              <Textarea
                value={custom}
                disabled={disabled}
                placeholder={question.multiSelect ? '可补充一个自定义选项' : '选择其他答案时填写'}
                className="min-h-7 resize-none rounded-md text-xs"
                onChange={(event) => updateCustomAnswer(question, event.currentTarget.value)}
                onBlur={onInputBlur}
                onFocus={onInputFocus}
              />
            </div>
          </div>
        );
      })}
      {data.error && (
        <div className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{data.error}</div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {data.status === 'submitting' ? '正在回传...' : '选择会继续当前回复'}
        </span>
        <div className="flex shrink-0 items-center justify-end gap-1.5">
          {onSkip && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={onSkip}
              className="h-7 text-xs"
            >
              跳过
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit || disabled}
            onClick={submitAnswer}
            className="h-7 text-xs"
          >
            <SendHorizontal data-icon="inline-start" />
            {submitLabel}
          </Button>
        </div>
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
          <div className="font-medium text-foreground">{formatQuestionAnswer(answer)}</div>
        </div>
      ))}
    </div>
  );
}

function buildSkipQuestionResponse(data: ToolQuestionPartData): ToolQuestionAnswerPayload {
  const response: ToolQuestionAnswerPayload = { answers: {}, annotations: {} };
  for (const question of data.questions) {
    response.answers[question.question] = [SKIP_ANSWER_LABEL];
    response.annotations![question.question] = { notes: '用户跳过了这个问题。' };
  }
  return response;
}

function formatQuestionAnswer(answer: string[]): string {
  if (answer.length === 1 && answer[0] === SKIP_ANSWER_LABEL) return '已跳过';
  return answer.join(', ');
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

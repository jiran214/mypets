# AI 消息归一化

三个 provider（Pi、Claude、Codex）各自使用不同协议，通过 Node runner 归一化为统一的 `AiChatEvent`，再由 `ChatRuntime.handleEvent()` 处理。

## 架构

```
Provider 原生事件
      ↓
  Node Runner (run-*.mjs)
      ↓ 调用 emit/emitPart/emitToolQuestion
  AiChatEvent (stdout JSON line)
      ↓ Rust 解析 → Tauri event
  ChatRuntime.handleEvent()
      ↓ appendPart() 增量合并
  ChatMessage.parts[]
      ↓ React 渲染
  ChatPartView 按 kind 分发
```

## 统一事件类型 (AiChatEvent)

| type | 用途 | 关键字段 |
|------|------|---------|
| `status` | 请求生命周期 | `status: 'started'` |
| `session` | provider 会话标识 | `providerState` |
| `delta` | 增量文本 | `text` |
| `part` | 结构化片段 | `part: { kind, text, title }` |
| `question` | 工具问答 | `question: ToolQuestionRequest` |
| `done` | 完成 | `providerState?` |
| `cancelled` | 取消 | — |
| `error` | 错误 | `error` |

## Part kind 映射

| kind | Claude | Pi | Codex |
|------|--------|-----|-------|
| `text` | stream_event text_delta | message_update text_delta | item/agentMessage/delta |
| `thinking` | thinking_delta | thinking_delta | item/reasoning/textDelta |
| `tool` | tool_use (默认) | toolcall_end / tool_execution | commandExecution / fileChange |
| `mcp` | tool_use (mcp__*) | tool_execution (含 mcp) | mcpToolCall |
| `skill` | tool_use (含 skill) | tool_execution (skill:*) | — |
| `plan` | — | — | item/plan/delta |
| `status` | SDK status | queue / compaction / retry | warning / review mode |

## 工具分类逻辑

```javascript
// Claude — 按 tool_use.name 前缀
name.startsWith('mcp__')  → 'mcp'
name.includes('skill')    → 'skill'
其他                       → 'tool'

// Pi — 按 toolName 关键词
name.startsWith('skill:') → 'skill'
name.includes('mcp')      → 'mcp'
其他                       → 'tool'

// Codex — 按 item.type 映射
mcpToolCall      → 'mcp'
commandExecution → 'tool'
fileChange       → 'tool'
```

## Question 归一化

三种 provider 的用户交互请求统一为 `ToolQuestionRequest`：

```
{
  id, requestId, toolName, toolUseId,
  kind: 'permission' | 'ask-user-question',
  title?, description?,
  questions: [{ question, header, options: [{ label, description, preview? }], multiSelect }]
}
```

| provider | 触发场景 | kind |
|----------|---------|------|
| Claude | AskUserQuestion 工具调用 | ask-user-question |
| Claude | 权限确认 (canUseTool) | permission |
| Pi | extension_ui_request (confirm) | permission |
| Pi | extension_ui_request (select/input) | ask-user-question |
| Codex | commandExecution/fileChange/permissions | permission |
| Codex | tool/requestUserInput | ask-user-question |

## 增量合并

`ChatRuntime.appendPart()` 对 `text` kind 做增量追加，其他 kind 直接新增：

```typescript
if (kind === 'text' && lastPart.kind === 'text') {
  lastPart.text += part.text;  // 追加
} else {
  message.parts.push(newPart);  // 新增
}
```

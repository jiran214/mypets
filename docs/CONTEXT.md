# Wimi Pet 领域词汇表

## 核心概念

### 会话 (Session)
一次 AI 交互的完整生命周期，包含元数据和消息历史。在代码中由两部分组成：
- `AiSessionSummary` — 持久化的元数据（标题、时间、provider 信息），存储在 `.wimipet/sessions/<id>.meta.json`
- `Conversation` — 消息内容（messages 数组），存储在 localStorage

这两个不是独立概念，而是同一个 Session 实体的元数据视角和内容视角。

### Provider 会话标识 (ProviderSessionHandle)
Pi provider 内部用于恢复会话的不透明标识符，包含在 `ProviderState` 中：
- `piSessionId` / `piSessionFile` — Pi CLI 的会话标识

注意：当前这些标识**只写不读**——从 provider 获取后保存到 localStorage，但发送新消息时不会传回 provider 来恢复会话。Provider 可能自行恢复上下文，但应用层未主动使用这些值。

### 会话数据存储
- **localStorage** — 前端唯一的消息历史来源（`StoredConversation`），丢失后无法从 provider 文件恢复
- **文件系统** — `.wimipet/sessions/<id>.meta.json` 存会话元数据索引
- **Provider 自行存储** — Pi 用 `~/.pi/agent/sessions/*.jsonl`，但前端不读取这些文件

### 工作空间 (Workspace / PetWorkspace)
一个注册到应用中的桌宠文件夹。文件夹路径是其唯一标识。每个工作空间包含：
- `pet.json` — 桌宠清单
- `.wimipet/` — 应用数据（设置、会话、任务）
- `.pi/` — Pi provider 配置

### 桌宠 (Pet / PetMeta)
桌宠的身份定义，来自 `pet.json`。字段：`id`、`description`、`spritesheetPath`、可选 `kind`。

名称相关：
- **原始名称 (originalName)** — 创作者在 `pet.json` 中定义的名称，不可被用户修改
- **显示名称 (displayName)** — 用户看到的名称，存储在 `AiSettings.displayName`，优先级高于原始名称。删除 `.wimipet/` 后回退到原始名称

### 自动任务 (AutoTask)
定时执行的 AI 提示词，有独立的生命周期（创建→启用→运行→完成/失败）。运行时生成 Session。

### 技能 (Skill)
从 SKILL.md 文件发现的提示词扩展，有三种作用域：workspace、builtin、global。

### 人格 (Persona)
桌宠的 AI 系统提示词，定义其性格特征。存储在 `AiSettings.petPersona`。

### 工作空间设置 (AiSettings)
存储在 `.wimipet/settings.json`，虽然代码中是一个类型，但领域上包含三类配置：
- **AI 配置** — `providerId`、`pi`、`petPersona`
- **窗口属性** — `petAlwaysOnTop`、`petGravityEnabled`、`petScale`、`petResizeEnabled`
- **显示名称** — `displayName`（覆盖 `pet.json` 中的原始名称）

### Provider（两个层级，注意区分）
- **AI 后端 (ProviderId)** — Wimi Pet 使用 Pi 作为 AI 后端。代码中用 `ProviderId` 类型（值为 `'pi'`），领域概念是"AI 后端"
- **LLM 提供商 (PiSettings.provider)** — Pi CLI 内部对接的语言模型服务，是 Pi 工具自己的配置项，与应用层的 ProviderId 无关

## UI 表现属性

| 术语 | 含义 |
|---|---|
| 精灵表 (Spritesheet) | 桌宠的动画纹理图集，8列×9行网格 |
| 动画状态 (AnimationState) | 9 种精灵动画模式之一 |
| 置顶 (AlwaysOnTop) | 桌宠窗口保持在其他窗口之上 |
| 重力 (Gravity) | 桌宠窗口的重力行为 |

## 术语消歧

### `kind` 字段（多处复用，含义不同）
代码中 5 个不同概念共用 `kind` 字段名，各自有独立的类型定义：
- **桌宠种类 (PetMeta.kind)** — 可选 string，桌宠的类型/变体
- **附件类型 (ChatAttachment.kind)** — `'file' | 'text'`
- **消息片段类型 (ChatPartKind)** — 10 种值（text、thinking、tool、mcp 等）
- **调度策略 (AutoTaskScheduleKind)** — `'daily' | 'weekly' | 'interval'`
- **问题类型 (ToolQuestionKind)** — `'ask-user-question' | 'permission'`

## 运行时架构

三段式运行时：WebView (TS) → Rust (Tauri) → Node (Pi Agent)

| 运行时 | 职责 | 对应上下文 |
|---|---|---|
| WebView (TS) | UI 渲染、用户交互、状态展示 | #1 桌宠渲染、#4 对话 UI、#5 工具问答 UI |
| Rust (Tauri) | 文件系统、进程管理、事件路由 | #2 工作空间、#3 配置持久化、#8 进程管理 |
| Node | AI 后端调度、协议适配 | #4 对话执行、#6 定时任务执行、#7 技能加载 |

Rust 是中间层：前端 `invoke()` → Rust 构造 payload → Node stdin；Node stdout → Rust 解析 → Tauri event → 前端。

## 有界上下文

| # | 上下文 | 核心概念 | 边界 |
|---|---|---|---|
| 1 | 桌宠身份与渲染 | PetMeta、AnimationState、Spritesheet、PetPosition | 桌宠"是什么"和"怎么画" |
| 2 | 工作空间管理 | PetWorkspace、WorkspaceRegistry | 桌宠文件夹的注册、启用、窗口创建 |
| 3 | AI 后端配置 | AiSettings、ProviderSettings、ProviderId | 怎么连接 AI 后端 |
| 4 | AI 对话 | Conversation、ChatMessage、ChatRuntime、ProviderState | 一次对话的完整生命周期。一个工作空间一个 ChatRuntime，主窗口聊天面板和宠物窗口气泡共享同一实例 |
| 5 | 工具问答 | ToolQuestion、ToolQuestionAnswer | AI 请求用户输入的双向协议（#4 的子协议） |
| 6 | 定时任务 | AutoTask、AutoTaskSchedule | 定时 AI 提示词的调度和执行 |
| 7 | 技能发现 | SkillInfo、SKILL.md | 扫描和加载 prompt 扩展 |
| 8 | 进程管理 | AI 进程 spawn、PID 跟踪、取消 | 基础设施层，非领域概念 |

## 待澄清

（暂无）

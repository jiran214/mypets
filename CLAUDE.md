# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

mypets 是一个 Tauri 2 桌面宠物应用——浮动、透明、置顶的精灵动画角色，支持多桌宠同时显示，内置 Claude AI 聊天功能。前端用 TypeScript + Vite + React + Canvas 2D 渲染，后端用 Rust 处理文件系统和 AI 调度。

## 常用命令

```bash
npm install              # 安装依赖
npm run tauri dev        # 完整开发模式：Vite 前端 + Rust 编译 + 启动窗口
npm run tauri build      # 生产构建，打包为原生可执行文件
npm run dev              # 仅前端，Vite 开发服务器 (端口 1420)
npm run build            # TypeScript 类型检查 + Vite 构建到 dist/
```

无测试框架、无 lint 工具、无 CI/CD 配置。

## 架构要点

### 三段式运行时：WebView (TS) → Tauri (Rust) → Node (Claude Agent SDK)

应用有三个运行时，数据流为：

```
前端 TS ──invoke()──▸ Rust (Tauri commands) ──spawn node──▸ src-node/claude-runner.mjs
   ◂──event()──────── ◂──emit("ai-chat-event")──────────── ◂──stdout JSON lines──┘
```

- **前端 TypeScript** — Canvas 渲染 + DOM 着陆页 + React 聊天 UI
- **Rust (src-tauri/)** — 文件系统访问、AI 状态管理、启动 Node 子进程
- **Node (src-node/claude-runner.mjs)** — 通过 `@anthropic-ai/claude-agent-sdk` 的 `query()` 与 Claude 交互，stdout 输出 JSON 行事件

### Tauri IPC 命令

前端通过 `invoke()` 调用 Rust 命令（注册在 [lib.rs](src-tauri/src/lib.rs)）：

**AI 命令（src-tauri/src/ai.rs）：**
- `load_ai_state` — 加载工作空间的 AI 设置和路径
- `list_ai_sessions` — 列出对话会话元数据文件
- `save_ai_settings` — 保存 AI 设置到 `.mypets-ai/settings.json`
- `list_skills` — 列出可用的 skill 文件（全局 + 工作空间级别）
- `save_dropped_chat_file` — 保存拖入聊天的文件到工作空间
- `send_ai_chat_message` — 启动 Claude 子进程，通过 Tauri event 系统流式返回结果
- `cancel_ai_chat_message` — 取消正在进行的 AI 请求（向子进程发送 SIGINT）
- `answer_ai_tool_question` — 回答 Claude 的工具调用问题（权限确认或多选问答）

**宠物命令（src-tauri/src/pet.rs）：**
- `load_pet` — 读取并校验 pet 文件夹中的 `pet.json`
- `load_spritesheet` — 读取图片文件并返回 base64 data URL
- `delete_pet_workspace` — 将宠物文件夹移入回收站（`trash` crate）
- `open_workspace_in_file_manager` — 在系统文件管理器中打开工作空间
- `update_pet_display_name` — 更新宠物显示名称

所有文件系统访问在 Rust 侧完成，前端只接收元数据和 base64 图片，这是刻意的安全边界。

### AI 聊天流水线

发送消息的完整路径：

1. 前端 `ChatRuntime.send()` → `invoke('send_ai_chat_message', ...)`
2. Rust 构造 JSON payload，`Command::new("node")` 启动 [claude-runner.mjs](src-node/claude-runner.mjs)
3. Node 进程通过 stdin 接收 payload，调用 `query({ prompt, options })` 流式查询 Claude
4. Node 将每个 stream event 写为 JSON line 到 stdout
5. Rust 读取 stdout，通过 `app.emit("ai-chat-event", event)` 转发到前端
6. 前端 `listenToAiChatEvents()` 监听事件，`ChatRuntime` 更新状态并通知 UI

事件类型定义在 [ai-types.ts](src/ai-types.ts)：`status`、`session`、`part`、`delta`、`question`、`done`、`cancelled`、`error`。

- `question` 事件用于 Claude 请求用户输入（权限确认或多选问答），前端通过 `answerAiToolQuestion()` 回应
- `cancelled` 事件在用户中断请求后触发

AI 设置存储在每个工作空间的 `.mypets-ai/settings.json`，会话元数据在 `.mypets-ai/sessions/`，日志在 `.mypets-ai/logs/ai.log`。

### 前端渲染

- **Canvas 2D 精灵动画**：单个 `<canvas>` 元素 (192x208 逻辑像素)，`SpriteRenderer` 使用 `requestAnimationFrame`，每帧独立时长，支持 DPR 缩放，自动裁剪透明边缘
- **React 管理界面**：着陆页（manager-app.tsx）使用 React + Tailwind + shadcn/ui，包含侧边栏桌宠列表、聊天面板、设置面板
- **React 聊天 UI**：聊天组件（chat-ui.tsx）使用 React，有两个挂载点：着陆页嵌入式面板和宠物模式气泡
- 9 种动画状态定义在 [animation-data.ts](src/animation-data.ts)：idle、running-right、running-left、waving、jumping、failed、waiting、running、review
- 精灵表为 8 列 x 9 行网格布局，每格 192x208 像素
- `InteractionManager` 使用优先级槽管理动画状态（hover < drag），拖拽方向自动切换 running-left/right

### 双态 UI：主窗口 / 宠物窗口

- 启动时显示主窗口（React 管理界面），侧边栏列出已导入的桌宠，右侧为聊天面板或设置面板
- 每个启用的桌宠创建独立的宠物窗口（透明/置顶/跳过任务栏），通过 `pet-windows.ts` 管理
- 宠物窗口通过 URL 参数 `?view=pet&folder=...` 区分，每个窗口有独立的 Canvas 精灵和聊天气泡
- 桌宠工作空间通过 `localStorage` 持久化（key: `mypets-workspaces-v1`），支持多工作空间，每个可独立启用/禁用
- 宠物窗口标签格式：`pet-{folderHash}`，通过 FNV-1a 哈希文件夹路径生成

### 聊天 UI

- 两个聊天挂载点：主窗口嵌入式面板（`ChatPanel`，全功能）和宠物模式气泡（compact 模式）
- 主窗口使用 React 组件（`chat-ui.tsx`），宠物模式气泡使用原生 DOM 挂载
- 左键单击宠物 canvas 切换气泡开关，气泡窗口尺寸自动调整并跟随宠物位置
- `ChatRuntime` 是纯状态机（无框架），通过 `subscribe/notify` 模式驱动 React 和原生 UI 更新
- AI 聊天组件（`components/ai-elements/`）提供流式消息渲染、代码高亮、工具调用展示、权限确认问答等
- 支持文件附件：拖拽文件到聊天框，通过 `saveDroppedChatFile` 保存到工作空间后作为附件发送

### 宠物文件夹约定

每个宠物是一个本地文件夹，包含：
- `pet.json` — 清单文件，字段：`id`、`displayName`、`description`、`spritesheetPath`（相对路径）、可选 `kind`
- 精灵表图片文件

### 窗口管理

- 主窗口关闭时隐藏到托盘（不退出），通过 `on_window_event` 拦截 `CloseRequested`
- 系统托盘菜单：打开主窗口、退出应用
- 宠物窗口创建：`pet-windows.ts` 通过 `WebviewWindow` API 创建，初始位置优先恢复上次保存的位置
- 宠物位置持久化：通过 `pet-position.ts` 保存到 `localStorage`，窗口移动时 120ms 防抖写入
- 左键拖拽：通过 `appWindow.setPosition()` 移动窗口（含 DPR 缩放补偿）
- 右键菜单：通过 Tauri API 构建原生 OS 菜单（切换动画、设置、退出）
- 宠物模式下可拖拽右下角 resize handle 缩放（0.6x–3x）

## TypeScript 配置

`tsconfig.json` 启用了 `strict`、`noUnusedLocals`、`noUnusedParameters`，确保没有未使用的变量或参数。

路径别名：`@/*` 映射到 `./src/*`（在 `tsconfig.json` 和 `vite.config.ts` 中配置）。

## shadcn/ui 配置

`components.json` 定义了 shadcn/ui 的配置：使用 `radix-nova` 风格，Tailwind CSS 变量模式，lucide 图标库。组件安装到 `@/components/ui`，工具函数在 `@/lib/utils`。

AI 聊天专用组件在 `src/components/ai-elements/`：流式对话、消息渲染、代码块、工具调用展示、推理过程、附件、权限确认问答、提示输入框等。

## 关键依赖

- **NPM:** `@tauri-apps/api` ^2、`@tauri-apps/plugin-dialog` ^2、`@anthropic-ai/claude-agent-sdk` ^0.3、`typescript` ~5.6、`vite` ^6、`react` 19、`tailwindcss` ^4、`shadcn` ^4、`streamdown`（流式 Markdown 渲染）、`motion`（动画）、`shiki`（代码高亮）、`ai`（Vercel AI SDK，用于部分类型定义）
- **Cargo:** `tauri` 2 (带 `tray-icon`、`protocol-asset`)、`tauri-plugin-dialog` 2、`serde` + `serde_json` 1、`base64` 0.22、`trash` 5

## 安全模型

Tauri v2 capabilities 定义在 `src-tauri/capabilities/default.json`，应用于 `main` 和 `pet-*` 窗口，仅授予必要的窗口操作、事件监听和文件对话框权限。所有文件系统访问在 Rust 侧完成，前端只接收元数据和 base64 图片。

AI 设置和会话存储在每个工作空间的 `.mypets-ai/` 目录下，Claude 配置在 `.claude/` 目录下。

## 约定

- 文件命名：kebab-case
- UI 文字：中文（zh-CN）
- 提交信息：中文，简短描述
- 只做关键测试

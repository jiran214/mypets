# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

mypets 是一个 Tauri 2 桌面宠物应用——浮动、透明、置顶的精灵动画角色，内置 Claude AI 聊天功能。前端用 TypeScript + Vite + Canvas 2D 渲染，后端用 Rust 处理文件系统和 AI 调度。

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

- **前端 TypeScript** — Canvas 渲染 + DOM 着陆页 + 聊天 UI
- **Rust (src-tauri/)** — 文件系统访问、AI 状态管理、启动 Node 子进程
- **Node (src-node/claude-runner.mjs)** — 通过 `@anthropic-ai/claude-agent-sdk` 的 `query()` 与 Claude 交互，stdout 输出 JSON 行事件

### Tauri IPC 命令

前端通过 `invoke()` 调用 5 个 Rust 命令（注册在 [lib.rs](src-tauri/src/lib.rs)）：
- `load_pet` — 读取并校验 pet 文件夹中的 `pet.json`
- `load_spritesheet` — 读取图片文件并返回 base64 data URL
- `load_ai_state` — 加载工作空间的 AI 设置和路径
- `save_ai_settings` — 保存 AI 设置到 `.mypets-ai/settings.json`
- `send_ai_chat_message` — 启动 Claude 子进程，通过 Tauri event 系统流式返回结果

所有文件系统访问在 Rust 侧完成，前端只接收元数据和 base64 图片，这是刻意的安全边界。

### AI 聊天流水线

发送消息的完整路径：

1. 前端 `ChatRuntime.send()` → `invoke('send_ai_chat_message', ...)`
2. Rust 构造 JSON payload，`Command::new("node")` 启动 [claude-runner.mjs](src-node/claude-runner.mjs)
3. Node 进程通过 stdin 接收 payload，调用 `query({ prompt, options })` 流式查询 Claude
4. Node 将每个 stream event 写为 JSON line 到 stdout
5. Rust 读取 stdout，通过 `app.emit("ai-chat-event", event)` 转发到前端
6. 前端 `listenToAiChatEvents()` 监听事件，`ChatRuntime` 更新状态并通知 UI

事件类型定义在 [ai-types.ts](src/ai-types.ts)：`status`、`session`、`part`、`delta`、`done`、`error`。

AI 设置存储在每个工作空间的 `.mypets-ai/settings.json`，会话元数据在 `.mypets-ai/sessions/`，日志在 `.mypets-ai/logs/ai.log`。

### 前端：纯 Canvas 2D，无 UI 框架

- 单个 `<canvas>` 元素 (192x208 逻辑像素) 渲染精灵动画
- `SpriteRenderer` 使用 `requestAnimationFrame`，每帧独立时长，支持 DPR 缩放，自动裁剪透明边缘
- 9 种动画状态定义在 [animation-data.ts](src/animation-data.ts)：idle、running-right、running-left、waving、jumping、failed、waiting、running、review
- 精灵表为 8 列 x 9 行网格布局，每格 192x208 像素
- `InteractionManager` 使用优先级槽管理动画状态（hover < drag），拖拽方向自动切换 running-left/right

### 双态 UI：着陆页 / 宠物模式

- 启动时显示 DOM 着陆页（渐变背景），用户选择宠物文件夹并预览
- 点击"开始"后切换到宠物模式：窗口变为透明/置顶/跳过任务栏，Canvas 精灵接管
- 右键菜单可返回着陆页（"设置"选项）
- 选中的宠物文件夹通过 `localStorage` 持久化（key: `mypets-workspaces-v1`），支持多工作空间

### 聊天 UI

- 两个聊天挂载点：着陆页 tab 面板（全功能）和宠物模式气泡（compact 模式）
- 左键单击宠物 canvas 切换气泡开关，气泡窗口尺寸自动调整并跟随宠物位置
- `ChatRuntime` 是纯状态机（无框架），通过 `subscribe/notify` 模式驱动 UI 更新

### 宠物文件夹约定

每个宠物是一个本地文件夹，包含：
- `pet.json` — 清单文件，字段：`id`、`displayName`、`description`、`spritesheetPath`（相对路径）、可选 `kind`
- 精灵表图片文件

### 窗口管理

- 左键拖拽：通过 `appWindow.setPosition()` 移动窗口（含 DPR 缩放补偿）
- 右键菜单：通过 Tauri API 构建原生 OS 菜单（切换动画、设置、退出）
- 宠物模式下可拖拽右下角 resize handle 缩放（0.6x–3x）

## TypeScript 配置

`tsconfig.json` 启用了 `strict`、`noUnusedLocals`、`noUnusedParameters`，确保没有未使用的变量或参数。

## 关键依赖

- **NPM:** `@tauri-apps/api` ^2、`@tauri-apps/plugin-dialog` ^2、`@anthropic-ai/claude-agent-sdk` ^0.3、`typescript` ~5.6、`vite` ^6
- **Cargo:** `tauri` 2 (带 `protocol-asset`)、`tauri-plugin-dialog` 2、`serde` + `serde_json` 1、`base64` 0.22

## 安全模型

Tauri v2 capabilities 定义在 `src-tauri/capabilities/default.json`，仅授予必要的窗口操作和文件对话框权限。Asset protocol scope 为 `["**"]`（允许所有本地路径）。

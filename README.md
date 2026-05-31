# Wimi Pet

<p align="center">
  <img src="logo.png" alt="Wimi Pet Logo" width="200" />
</p>

[English](./README_EN.md)

**让 AI 住进你的桌面** — 会干活、能记忆、懂你的桌面Agent助手

<p align="center">
  <img src="/assets/image.png" alt="着陆页" width="45%" />
  &nbsp;&nbsp;
  <img src="/assets/image-1.png" alt="桌面宠物" width="45%" />
</p>

## 功能特性

### 多桌宠并行
同时运行多个桌宠，每个桌宠拥有独立的窗口、动画、技能和 AI 记忆，可以同时陪伴你工作。

### AI Agent 桌宠
每个桌宠都是一个独立的 AI Agent，基于Pi Agent构建，支持流式输出、工具调用、文件附件拖拽发送。桌宠不仅是动画，更是你的智能伙伴——能理解上下文、调用工具、执行复杂任务。

### 持久记忆系统
类似 Claude Memory 的记忆功能，每个桌宠拥有独立的记忆存储。记住你的偏好、对话历史和工作习惯，跨会话保持上下文连贯，越用越懂你。

### 9 种生动动画
idle（待机）、running（奔跑）、waving（挥手）、jumping（跳跃）、failed（失败）、waiting（等待）等 9 种动画状态，通过拖拽、悬停等交互触发生动反应。

### 内置生产力工具
- **番茄钟** — 专注计时，追踪每日完成情况
- **待办列表** — 任务管理，支持截止日期
- **倒计时** — 重要事件倒计时提醒

### 适配 Codex 桌宠格式
完全兼容 [Codex Pets](https://codex-pets.net/) 资源站的桌宠格式，直接导入使用。

> **注意：** 目前仅支持 Windows 平台，macOS/Linux 支持计划中。

## 技术栈

- **前端:** TypeScript + React + Vite + Tailwind CSS + shadcn/ui
- **渲染:** Canvas 2D 精灵动画
- **后端:** Rust (Tauri 2)
- **AI:** Pi Agent SDK (Node.js runner)

## 开发

```bash
npm install
npm run tauri dev       # 完整开发模式（前端 + Rust + 窗口）
npm run dev             # 仅前端（localhost:1420）
```

## 构建

```bash
npm run tauri build
```

## 宠物文件夹结构

每个宠物文件夹即为一个独立的**工作空间**，包含桌宠资源和运行时数据：

```
my-pet/                    # 工作空间根目录
├── SOUL.md                # 桌宠人设
├── pet.json               # 桌宠清单文件
├── spritesheet.png        # 精灵表（8列 x 9行，每格 192x208px）codex格式
└── .wimipet/              # 工作空间运行时数据
    ├── settings.json      # AI 设置（模型、人格、技能配置）
    ├── sessions/          # AI 对话会话元数据
    └── logs/              # AI 运行日志
```

**工作空间说明：**
- 每个工作空间可独立启用/禁用，支持多桌宠并行
- `.wimipet/` 目录存储该工作空间的 AI 配置、会话历史和日志
- AI 设置和会话数据与桌宠绑定，切换桌宠时自动切换上下文

**导入桌宠：**
将桌宠文件夹放入应用工作目录，或通过应用界面导入。支持 [Codex Pets](https://codex-pets.net/) 格式的桌宠资源。

## 内置技能

应用内置以下技能，位于当前项目的 `skills/` 目录：

|技能|说明|
|---|---|
|**pomodoro**|番茄钟计时器，支持开始、暂停、恢复、停止，追踪每日完成情况|
|**todolist**|待办列表管理，支持添加、完成、更新、删除任务|
|**countdown**|倒计时工具，重要事件提醒|

**安装自定义技能：**

将技能文件夹（包含 `SKILL.md`）复制到以下任一位置：

|位置|路径|说明|
|---|---|---|
|全局|`C:\Users\<用户名>\.wimipet\skills\`|所有桌宠可用|
|局部|`<桌宠工作空间>/.wimipet/skills/`|仅当前桌宠可用|

## License

[GPL-3.0](LICENSE)

<div align="center">

<picture>
  <img src="./assets/wimi-logo-transparent.svg" alt="Wimi Pet Logo" width="160" />
</picture>

# Wimi Pet

**让 AI 住进你的桌面。**  
一个可陪伴、可记忆、可调用工具的本地 AI 桌宠 Agent。

<p>
  <a href="./README_EN.md">English</a>
  ·
  <a href="#快速开始">快速开始</a>
  ·
  <a href="#宠物工作空间">宠物工作空间</a>
  ·
  <a href="#内置技能">内置技能</a>
</p>

<p>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square" />
  <img alt="License" src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square" />
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square" />
  <img alt="React" src="https://img.shields.io/badge/React-TypeScript-61DAFB?style=flat-square" />
  <img alt="AI" src="https://img.shields.io/badge/AI-Pi%20Agent-8B5CF6?style=flat-square" />
</p>

</div>

---

## 预览

<p align="center">
  <img src="./assets/image.png" alt="Wimi Pet 着陆页" width="48%" />
  <img src="./assets/image-1.png" alt="Wimi Pet 桌面宠物" width="48%" />
</p>

## 功能特性

| 功能 | 说明 |
|---|---|
| 🐾 **多桌宠并行** | 同时运行多个桌宠，每个桌宠拥有独立窗口、动画、技能和记忆。 |
| 🤖 **AI Agent 桌宠** | 基于 Pi Agent 构建，支持流式输出、工具调用、文件附件拖拽发送。 |
| 🧠 **持久记忆系统** | 每个桌宠拥有独立记忆，记住偏好、对话历史和工作习惯。 |
| ✨ **9 种动画状态** | 支持 idle、running、waving、jumping、failed、waiting 等状态。 |
| 🍅 **生产力工具** | 内置番茄钟、待办列表、倒计时，适合轻量日常陪伴。 |
| ⏰ **定时任务** | 支持每日、每周或固定间隔自动执行 AI 任务，解放双手。 |
| 📦 **Codex Pets 兼容** | 支持直接导入 [Codex Pets](https://codex-pets.net/) 格式资源。 |

> 目前主要支持 **Windows**。macOS / Linux 支持计划中。

## 技术栈

| 模块 | 技术 |
|---|---|
| 前端 | TypeScript · React · Vite · Tailwind CSS · shadcn/ui |
| 桌面端 | Tauri 2 · Rust |
| 渲染 | Canvas 2D 精灵动画 |
| AI | Pi Agent SDK · Node.js Runner |
| 扩展 | Skills · 工作空间配置 · 本地运行时数据 |

## 快速开始

```bash
npm install
npm run tauri dev
```

仅启动前端：

```bash
npm run dev
```

构建应用：

```bash
npm run tauri build
```

## 工作空间

每个宠物文件夹都是一个独立工作空间，包含桌宠资源、AI 配置和运行时数据。

```text
my-pet/
├── SOUL.md                # 桌宠人设
├── pet.json               # 桌宠清单文件
├── spritesheet.png        # 精灵表：8 列 x 9 行，每格 192x208px
└── .wimipet/
    ├── settings.json      # AI 设置：模型、技能配置
    ├── memory/            # 记忆
    ├── sessions/          # 对话会话元数据
    └── logs/              # AI 运行日志
```

### 工作空间特点

- 每个桌宠可独立启用 / 禁用
- 每个桌宠拥有独立 AI 配置和会话数据
- 切换桌宠时自动切换上下文
- 支持通过应用界面导入桌宠文件夹

## 内置技能

  <a href="./skills">目录链接</a>
| 技能 | 说明 |
|---|---|
| `pomodoro` | 番茄钟计时器，支持开始、暂停、恢复、停止，并追踪每日完成情况。 |
| `todolist` | 待办列表管理，支持添加、完成、更新、删除任务。 |
| `countdown` | 倒计时工具，用于重要事件提醒。 |

## 自定义技能

将包含 `SKILL.md` 的技能文件夹复制到以下任一位置：

| 类型 | 路径 | 作用范围 |
|---|---|---|
| 全局技能 | `C:\Users\<用户名>\.wimipet\skills\` | 所有桌宠可用 |
| 局部技能 | `<桌宠工作空间>/.wimipet/skills/` | 仅当前桌宠可用 |

## License

[GPL-3.0](LICENSE)

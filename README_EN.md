# Wimi Pet

[中文](./README.md)

**AI lives on your desktop** — a desktop agent assistant that works, remembers, and understands you.

<p align="center">
  <img src="/assets/image.png" alt="Landing page" width="45%" />
  &nbsp;&nbsp;
  <img src="/assets/image-1.png" alt="Desktop pet" width="45%" />
</p>

## Features

### Multi-Pet Parallel
Run multiple pets simultaneously, each with its own window, animations, skills, and AI memory — keeping you company while you work.

### AI Agent Pet
Each pet is an independent AI Agent built on Pi Agent SDK. Supports streaming output, tool calls, and file attachment drag-and-drop. Pets are more than animations — they're intelligent companions that understand context, invoke tools, and handle complex tasks.

### Persistent Memory System
Similar to Claude Memory, each pet has its own independent memory store. It remembers your preferences, conversation history, and work habits, maintaining context across sessions. The more you use it, the better it understands you.

### 9 Lively Animations
9 animation states including idle, running, waving, jumping, failed, waiting, and more. Triggered by interactions like dragging and hovering for lively reactions.

### Built-in Productivity Tools
- **Pomodoro Timer** — Focus timer with daily completion tracking
- **Todo List** — Task management with due date support
- **Countdown** — Important event countdown reminders

### Compatible with Codex Pet Format
Fully compatible with [Codex Pets](https://codex-pets.net/) resources. Import directly and start using.

> **Note:** Currently Windows only. macOS/Linux support is planned.

## Tech Stack

- **Frontend:** TypeScript + React + Vite + Tailwind CSS + shadcn/ui
- **Rendering:** Canvas 2D sprite animation
- **Backend:** Rust (Tauri 2)
- **AI:** Pi Agent SDK (Node.js runner)

## Development

```bash
npm install
npm run tauri dev       # Full dev mode (frontend + Rust + window)
npm run dev             # Frontend only (localhost:1420)
```

## Build

```bash
npm run tauri build
```

## Pet Folder Structure

Each pet folder is an independent **workspace**, containing pet resources and runtime data:

```
my-pet/                    # Workspace root
├── SOUL.md                # Pet persona
├── pet.json               # Pet manifest
├── spritesheet.png        # Spritesheet (8 columns x 9 rows, 192x208px per frame)
└── .wimipet/              # Workspace runtime data
    ├── settings.json      # AI settings (model, persona, skill config)
    ├── sessions/          # AI session metadata
    └── logs/              # AI runtime logs
```

**Workspace details:**
- Each workspace can be independently enabled/disabled, supporting multi-pet parallel usage
- The `.wimipet/` directory stores AI config, session history, and logs for that workspace
- AI settings and session data are tied to the pet — context switches automatically when switching pets

**Importing pets:**
Place a pet folder into the app workspace, or import via the app UI. Supports [Codex Pets](https://codex-pets.net/) format resources.

## Built-in Skills

The app includes the following skills, located in the project's `skills/` directory:

| Skill | Description |
| --- | --- |
| **pomodoro** | Pomodoro timer — start, pause, resume, stop; tracks daily completions |
| **todolist** | Todo list management — add, complete, update, delete tasks |
| **countdown** | Countdown tool — important event reminders |

**Installing custom skills:**

Copy a skill folder (containing `SKILL.md`) to either of the following locations:

| Location | Path | Description |
| --- | --- | --- |
| Global | `C:\Users\<username>\.wimipet\skills\` | Available to all pets |
| Local | `<pet workspace>/.wimipet/skills/` | Available to the current pet only |

## Animation States

idle, running-right, running-left, waving, jumping, failed, waiting, running, review

## License

[GPL-3.0](LICENSE)

# Wimi Pet

[中文](./README.md)

A Tauri 2 desktop pet application — multi-pet support, AI chat, and built-in tools.

<p align="center">
  <img src="/assets/image.png" alt="Landing page" width="45%" />
  &nbsp;&nbsp;
  <img src="/assets/image-1.png" alt="Desktop pet" width="45%" />
</p>

## Features

- **Multi-pet** — Run multiple pets simultaneously, each in its own window
- **AI Chat** — Powered by Pi Agent SDK, streaming output, tool calls, file attachments
- **Built-in Tools** — Pomodoro timer, todo list, countdown
- **Sprite Animation** — Canvas 2D rendering, 9 animation states, drag interaction
- **System Tray** — Minimize to tray when closing the main window, runs in background

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

```
my-pet/
├── pet.json           # { id, displayName, description, spritesheetPath }
└── spritesheet.png    # 8 columns x 9 rows, 192x208px per frame
```

## Animation States

idle, running-right, running-left, waving, jumping, failed, waiting, running, review

## License

MIT

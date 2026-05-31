# Wimi Pet

[English](./README_EN.md)

Tauri 2 桌宠应用 — 支持多桌宠、AI 聊天、内置工具。

<p align="center">
  <img src="/assets/image.png" alt="着陆页" width="45%" />
  &nbsp;&nbsp;
  <img src="/assets/image-1.png" alt="桌面宠物" width="45%" />
</p>

## 功能特性

- **多桌宠** — 同时运行多个桌宠，独立窗口
- **AI 聊天** — 基于 Pi Agent SDK，支持流式输出、工具调用、文件附件
- **内置工具** — 番茄钟、待办列表、倒计时
- **精灵动画** — Canvas 2D 渲染，9 种动画状态，支持拖拽交互
- **系统托盘** — 主窗口关闭时最小化到托盘，后台运行

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

```
my-pet/
├── pet.json           # { id, displayName, description, spritesheetPath }
└── spritesheet.png    # 8列 x 9行，每格 192x208px
```

## 动画状态

idle, running-right, running-left, waving, jumping, failed, waiting, running, review

## License

[GPL-3.0](LICENSE)

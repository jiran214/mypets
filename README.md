# Wimi Pet

[English](./README_EN.md)

Tauri 2 桌宠应用 — 内置 AI 聊天。

<p align="center">
  <img src="/assets/image.png" alt="着陆页" width="45%" />
  &nbsp;&nbsp;
  <img src="/assets/image-1.png" alt="桌面宠物" width="45%" />
</p>

## 技术栈

- **前端:** TypeScript + Vite + Canvas 2D
- **后端:** Rust (Tauri 2)

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

## TODO

- AI 功能集成
- 多动作支持

## License

MIT

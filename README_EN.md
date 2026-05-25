# Wimi Pet

[中文](./README.md)

A Tauri 2 desktop pet application — supports codex pet.

<p align="center">
  <img src="/assets/image.png" alt="Landing page" width="45%" />
  &nbsp;&nbsp;
  <img src="/assets/image-1.png" alt="Desktop pet" width="45%" />
</p>

## Tech Stack

- **Frontend:** TypeScript + Vite + Canvas 2D
- **Backend:** Rust (Tauri 2)

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

## TODO

- AI feature integration
- Multi-action support

## License

MIT

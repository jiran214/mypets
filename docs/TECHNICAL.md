# mypets - Technical Documentation

## Overview

**mypets** is a desktop pet application built with Tauri 2. A floating, transparent, always-on-top sprite-animated character lives on the user's desktop. Users can drag the pet around, switch animation states via right-click menu, and load different pet definitions from local folders.

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | TypeScript + Vite | TS 5.6 / Vite 6 |
| Rendering | HTML5 Canvas 2D | Vanilla (no framework) |
| Desktop Shell | Tauri | v2 |
| Backend | Rust | Edition 2021 |
| Serialization | serde + serde_json | 1.x |

## Project Structure

```
mypets/
├── index.html                  # Entry: single <canvas> element (192x208)
├── package.json
├── vite.config.ts              # Port 1420, ignores src-tauri/
├── tsconfig.json               # ES2021, strict mode
├── docs                        # md instrction docs
├── src/                        # Frontend (TypeScript)
│   ├── main.ts                 # Entry: init canvas, load pet, start renderer
│   ├── types.ts                # PetMeta, AnimationState, AnimationDef interfaces
│   ├── animation-data.ts       # Spritesheet grid constants + 9 animation definitions
│   ├── renderer.ts             # SpriteRenderer class (requestAnimationFrame loop)
│   ├── pet-loader.ts           # pickPetFolder() dialog + loadPet() Tauri invoke
│   ├── drag.ts                 # Left-click triggers Tauri window drag
│   ├── context-menu.ts         # Right-click native menu (animation switch, load pet, quit)
│   └── style.css               # Transparent background, no margins
└── src-tauri/                  # Backend (Rust)
    ├── Cargo.toml
    ├── tauri.conf.json         # Window config + security settings
    ├── capabilities/
    │   └── default.json        # Permissions: drag, close, set-size, dialog:open
    └── src/
        ├── main.rs             # Calls mypets_lib::run()
        ├── lib.rs              # Tauri builder: registers plugin + command
        └── pet.rs              # load_pet command: reads pet.json, resolves spritesheet path
```

## Build & Run

```bash
npm run tauri dev       # Dev mode (Vite + Rust compile + launch window)
npm run tauri build     # Production build (bundled native executable)
npm run dev             # Frontend only (Vite dev server, port 1420)
npm run build           # Type check + Vite build to dist/
```

## Architecture

### Frontend

- **No UI framework** -- pure Canvas 2D rendering via `requestAnimationFrame`.
- `SpriteRenderer` handles DPR-aware scaling and per-frame variable-duration animation.
- 9 animation states defined in `animation-data.ts`: idle, running-left, running-right, waving, jumping, failed, waiting, running/working, review.
- `pet-loader.ts` uses `@tauri-apps/plugin-dialog` for native folder picker, then calls Rust `load_pet` command via `invoke()`.
- `drag.ts` calls `appWindow.startDragging()` on left mousedown for window repositioning.
- `context-menu.ts` builds a native OS menu via `@tauri-apps/api/menu`.

### Backend (Rust)

- Single Tauri command: `load_pet(folder_path) -> PetMeta`.
- Reads `pet.json` from the selected folder, deserializes to `PetMeta`, resolves the spritesheet absolute path, validates the file exists.
- Frontend uses Tauri's `convertFileSrc()` with `asset:` protocol to load images from arbitrary local paths.

### Pet Folder Convention

Each pet is a folder containing:
- `pet.json` -- manifest with `id`, `displayName`, `description`, `spritesheetPath` (relative), optional `kind`.
- Spritesheet image -- a grid of animation frames.

### Window Configuration

Configured in `tauri.conf.json`:
- `transparent: true`, `decorations: false`, `alwaysOnTop: true`
- `resizable: false`, `skipTaskbar: true`
- Window size: 250x260 (will-change-to dynamic based on spritesheet)

### Security

Tauri v2 capabilities model in `capabilities/default.json`:
- `core:window:allow-start-dragging`, `core:window:allow-close`, `core:window:allow-set-size`
- `dialog:allow-open`
- Asset protocol scope: `["**"]` (all local paths)

## Key Dependencies

**NPM:** `@tauri-apps/api` ^2, `@tauri-apps/plugin-dialog` ^2, `typescript` ~5.6, `vite` ^6, `@tauri-apps/cli` ^2

**Cargo:** `tauri` 2 (with `protocol-asset`), `tauri-plugin-dialog` 2, `serde` 1, `serde_json` 1, `tauri-build` 2

## Design Decisions

1. **Canvas over DOM** -- a single animated sprite needs no virtual DOM overhead.
2. **Per-frame durations** -- each animation frame has its own millisecond duration for natural motion.
3. **Rust-side file I/O** -- `load_pet` keeps filesystem access on the backend; frontend only receives resolved metadata.
4. **Native menus** -- uses OS-native context menus via Tauri API, not HTML popups.
5. **Asset protocol** -- enables loading images from any local path selected by the user.

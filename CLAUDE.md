# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

mypets 是一个 Tauri 2 桌面宠物应用——浮动、透明、置顶的精灵动画角色。前端用 TypeScript + Vite + Canvas 2D 渲染，后端用 Rust 处理文件系统访问。

## 常用命令

```bash
npm run tauri dev       # 完整开发模式：Vite 前端 + Rust 编译 + 启动窗口
npm run tauri build     # 生产构建，打包为原生可执行文件
npm run dev             # 仅前端，Vite 开发服务器 (端口 1420)
npm run build           # TypeScript 类型检查 + Vite 构建到 dist/
```

无测试框架、无 lint 工具、无 CI/CD 配置。

## 架构要点

### 双进程通信 (Tauri IPC)

前端 TypeScript 在 webview 中运行，Rust 后端作为原生进程。通过 `invoke()` 通信，前端仅调用两个 Rust 命令：
- `load_pet` — 读取并校验 pet 文件夹中的 `pet.json`
- `load_spritesheet` — 读取图片文件并返回 base64 data URL

所有文件系统访问在 Rust 侧完成，前端只接收元数据和 base64 图片，这是刻意的安全边界。

### 前端：纯 Canvas 2D，无 UI 框架

- 单个 `<canvas>` 元素 (192x208 逻辑像素) 渲染精灵动画
- `SpriteRenderer` 使用 `requestAnimationFrame`，每帧独立时长，支持 DPR 缩放
- 9 种动画状态定义在 `animation-data.ts`：idle、running-right、running-left、waving、jumping、failed、waiting、running、review
- 精灵表为 8 列 x 9 行网格布局，每格 192x208 像素

### 双态 UI：着陆页 / 宠物模式

- 启动时显示 DOM 着陆页（渐变背景），用户选择宠物文件夹并预览
- 点击"开始"后切换到宠物模式：窗口变为透明/置顶/跳过任务栏，Canvas 精灵接管
- 右键菜单可返回着陆页（"设置"选项）
- 选中的宠物文件夹通过 `localStorage` 持久化，下次启动自动加载

### 宠物文件夹约定

每个宠物是一个本地文件夹，包含：
- `pet.json` — 清单文件，字段：`id`、`displayName`、`description`、`spritesheetPath`（相对路径）、可选 `kind`
- 精灵表图片文件

### 窗口管理

- 左键拖拽：通过 `appWindow.startDragging()` 移动窗口
- 右键菜单：通过 Tauri API 构建原生 OS 菜单（切换动画、设置、退出）

## TypeScript 配置

`tsconfig.json` 启用了 `strict`、`noUnusedLocals`、`noUnusedParameters`，确保没有未使用的变量或参数。

## 关键依赖

- **NPM:** `@tauri-apps/api` ^2、`@tauri-apps/plugin-dialog` ^2、`typescript` ~5.6、`vite` ^6
- **Cargo:** `tauri` 2 (带 `protocol-asset`)、`tauri-plugin-dialog` 2、`serde` + `serde_json` 1、`base64` 0.22

## 安全模型

Tauri v2 capabilities 定义在 `src-tauri/capabilities/default.json`，仅授予必要的窗口操作和文件对话框权限。Asset protocol scope 为 `["**"]`（允许所有本地路径）。

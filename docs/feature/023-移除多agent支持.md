# 移除 Claude 和 Codex Provider，只保留 Pi

## Context

项目当前支持三种 AI provider（Pi、Claude、Codex），但 Pi 是默认且最成熟的 provider，拥有最多的配置项、独立的 auth 系统、最丰富的 skill 目录。移除 Claude 和 Codex 可以：
- 删除 ~763 行 Node 代码（run-claude 191 + run-codex 572）
- 简化 Rust/TS 的 settings 结构体和同步负担
- 减少设置 UI 的复杂度
- 聚焦 Pi 体验的深度定制

## 修改范围

### 阶段 1：删除 Node.js Provider Runner 文件

**删除文件：**
- `src-node/run-claude.mjs` (191 行)
- `src-node/run-codex.mjs` (572 行)

**修改 `src-node/runner.mjs`：**
- 删除 `import { runClaude, findClaudeExecutable } from './run-claude.mjs'`
- 删除 `import { runCodex, findCodexExecutable } from './run-codex.mjs'`
- 简化 `parseProviderId()` — 移除 codex/claude 分支，只保留 pi
- 简化 `main()` 中的 dispatch — 移除 codex/claude 分支，直接调用 `runPi(input)`
- 移除未使用的 `findClaudeExecutable` / `findCodexExecutable` 引用

### 阶段 2：Rust 后端清理

**`src-tauri/src/ai/ai_models.rs`：**
- 删除 `ClaudeSettings` struct (lines 37-52)
- 删除 `CodexSettings` struct (lines 54-69)
- 从 `AiSettings` 中移除 `claude: ClaudeSettings` 和 `codex: CodexSettings` 字段
- 删除 `ClaudeSettings::default()` 和 `CodexSettings::default()` 实现
- 删除 `default_codex_approval_policy` 和 `default_codex_reasoning_effort` 函数
- 删除 `default_permission_mode` 和 `default_thinking_intensity` 函数（仅 Claude 使用）
- 从 `AiPaths` 中移除 `claude_dir` 字段
- 从 `AiPaths::default()` 中移除 `claude_dir`

**`src-tauri/src/ai/ai_payload.rs`：**
- 从 `build_chat_payload()` 中移除 `"claude"` 和 `"codex"` JSON 块 (lines 78-93)

**`src-tauri/src/ai/ai_storage.rs`：**
- 从 `StoragePaths` 中移除 `claude_dir` 字段
- 从 `storage_paths()` 中移除 `claude_dir` 计算
- 从 `public_paths()` 中移除 `claude_dir` 映射
- 从 `ensure_storage()` 中移除 `.claude/` 目录创建（lines 90-106）

**`src-tauri/src/ai/ai_runner.rs`：**
- 从 `RunnerConfig` 中移除 `claude_dir` 字段
- 移除 `.env("CLAUDE_CONFIG_DIR", ...)` 设置
- 将 error messages 中的 "Claude helper" 改为更通用的描述（如 "AI runner"）

**`src-tauri/src/ai/ai_commands.rs`：**
- 从 `send_ai_chat_message` 中移除 `claude_dir` 传递
- 将 error messages 中的 "Claude helper" 改为 "AI runner"

**`src-tauri/src/ai/ai_skills.rs`：**
- 删除 `codex_home_dir()` 函数
- 简化 `provider_skill_dir_name()` — 移除 codex 分支，_ 分支改为返回 ".pi"（或直接硬编码）
- 简化 `collect_all_skills()` — 移除 codex 特殊逻辑和 claude 分支，只保留 pi 的 skill 目录扫描

**`src-tauri/src/ai/ai_process.rs`：**
- 将 error message 中的 "Claude helpers" 改为 "AI processes" 或类似

**`src-tauri/Cargo.toml`：**
- 无变更（没有 Claude/Codex 特定依赖）

### 阶段 3：前端 TypeScript 清理

**`src/ai/ai-types.ts`：**
- 将 `ProviderId` 简化为 `export type ProviderId = 'pi'`
- 删除 `ClaudeSettings` 接口
- 删除 `CodexSettings` 接口
- 删除 `CodexApprovalPolicy` 和 `CodexReasoningEffort` 类型
- 从 `AiSettings` 中移除 `claude` 和 `codex` 字段
- 从 `ProviderState` 中移除 `claudeSessionId` 和 `codexThreadId`

**`src/ai/chat-runtime.ts`：**
- 简化 `cleanProviderState()` — 移除 claude/codex 分支，只处理 pi
- 简化 `providerLabel()` — 移除 codex/claude 分支，只返回 'Pi'
- 简化 `defaultProviderId()` — 移除 claude fallback，直接返回 'pi'
- 简化 `isConversation()` — 只检查 'pi'
- 将所有 `?? 'claude'` fallback 改为 `?? 'pi'`

**`src/ai/chat-ui.tsx`：**
- 从 `THINKING_LEVELS` 中移除 `claude` 和 `codex` 条目
- 简化 `ThinkingSelector` — 移除 claude/codex 的 settings 读写分支

### 阶段 4：设置 UI 清理

**`src/components/settings/agent-settings.tsx`：**
- 从 `PROVIDER_OPTIONS` 中移除 claude 和 codex 选项
- 删除 Claude 设置面板 (lines 379-480)
- 删除 Codex 设置面板 (lines 481-583)
- 删除 `CODEX_APPROVAL_OPTIONS` 和 `CODEX_REASONING_OPTIONS` 常量
- 删除 `PermissionMode`、`ThinkingIntensity` 相关类型引用

**`src/components/settings/skill-settings.tsx`：**
- 简化 `disabledSkills` 获取逻辑 — 直接使用 `settingsDraft.pi.disabledSkills`
- 简化 `toggleSkill` — 直接写入 `settingsDraft.pi.disabledSkills`
- 移除 Codex 特定的 info banner
- 移除 `claude.useUserSettings` 检查

### 阶段 5：npm 依赖清理

**`package.json`：**
- 移除 `@anthropic-ai/claude-agent-sdk` 依赖

## 不修改的内容

- `provider_id` 字段保留 — 虽然现在只有 pi，但这是架构基础设施，保留不影响功能
- `.pi/` 目录创建逻辑保留 — Pi 自己的目录
- `runner.mjs` 中的共享工具函数保留 — Pi runner 仍然使用它们
- `CLAUDE_CONFIG_DIR` env var — 移除（因为不再需要 Claude Code 配置目录）

## 验证

1. `npm run build` — TypeScript 编译无错误
2. `npm run tauri dev` — 应用正常启动
3. 设置页面只显示 Pi 选项，无 Claude/Codex
4. 发送 AI 消息正常工作（Pi provider）
5. Skill 列表正常加载

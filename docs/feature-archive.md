# Wimi Pet 功能开发归档

> 合并自 `docs/feature/001-023` 及需求池，按时间顺序排列。

---

## 001-AI集成

新增 AI Chatbot + 多 Tab 设置页（皮肤/设置/聊天），点击桌宠弹出跟随式聊天气泡，接入 Claude Agent SDK，存储参考 Claudian 方案。

---

## 002-多桌宠管理

着陆页改为多桌宠管理界面，支持文件夹导入为工作空间。三个 Tab：皮肤（预览+上传）、设置（Claude CLI 路径、权限模式、环境变量）、聊天（多格式渲染）。气泡窗口位于桌宠正上方。信息存储改为当前工作空间。UI 风格偏卡通。

---

## 003-多桌宠显示

多桌宠并发支持，独立控制。左侧列表与右侧内容联动，未选择时显示占位提示。增加删除按钮（带确认）。丢失状态处理。桌宠项右侧添加启用/禁用滑块，支持同时显示多只，AI 聊天独立。

---

## 004-桌宠展示优化

桌宠列表显示头像。皮肤 Tab 只显示桌宠动态形象（居中 idle）。设置中 Claude CLI 路径旁提示下载地址。桌宠桌面位置持久化。

---

## 005-AI生成优化

聊天窗层级优化：不同图标/颜色区分思考/工具/聊天，默认折叠长内容，弱化边框。输入区压缩。整体风格统一为"软萌"。右上角三个 icon 按钮（历史/新对话/关闭）。退出桌宠时同步隐藏状态。

---

## 006-输入框改造

（占位，无实质内容）

---

## 007-React改造

WebView 用 React 改造，引入 Streamdown + Vercel AI Elements 重构 AI 对话 UI。

---

## 008-UI改造

使用 shadcn + vercel/ai-elements 彻底重构 UI。左右结构：左侧可折叠桌宠列表，右侧上方聊天/设置 icon tab。设置 Tab 左右结构：通用、皮肤、Agent 配置。桌宠弹窗样式同聊天 Tab。

---

## 009-skill支持

设置中增加"技能"配置项，扫描全局和工作空间目录的 skill，每项显示技能名、描述、开启/关闭滑块。

---

## 010-智能拖入

桌宠和 AI 对话窗口识别拖入的文本和文件，在附件区域显示作为 AI 聊天上下文。附件项宽度设最大值。

---

## 011-增强动画效果

开启桌宠时播放 Waving→idle。AI 异常时播放 Failed→idle。用户输入时持续 Waiting。AI 生成时持续 Running。

---

## 012-设置优化

所有设置自动保存，删除保存按钮。窗体美化增大居中。通用设置：增加桌宠名修改、人设默认文本、置顶开关、重力开关、在资源管理器打开。皮肤设置：大小滑动条、自由调节开关。右键菜单美化，动作合为二级选项，"设置"改为"主界面"。

---

## 013-特殊工具渲染

实现 AskUserQuestion Tool 的回复功能。流程：Claude 调用 → Agent SDK 拦截 → 推给前端 → 渲染问题 UI → 用户选择/输入 → 回传。

---

## 014-AI聊天功能优化

聊天窗口显示桌宠名称。右键菜单主界面跳转。拖动图标改用文件/文本 icon。去掉"正在组织回复"渲染。支持打断按钮。修复气泡边框问题。

---

## 015-整体优化

修复：着陆页内容延迟显示、对话历史列表异常（颜色/滚动/溢出）、agent 设置下拉位置异常和 UI 抖动。支持 Codex Agent。修复 skill 开启/关闭无效。

---

## 016-定时任务

设置中增加"自动任务"，支持每天/每周/每间隔。任务执行后生成对话记录（标题：自动任务-任务名），在聊天历史可见。

---

## 017-Pi agent集成

集成 Pi agent，配置项尽量全面。删除不重要设置（会话目录、Steering/Follow-up 队列）。Pi Provider 下拉菜单 + 自定义 + 联动 API Key 输入框。模型为必填。异常时错误输出显示在 AI 对话中。

---

## 018-代码优化总结

7 阶段优化：安全加固（路径校验）、进程管理（超时/SIGKILL）、内存性能（防抖/LRU/BufWriter）、提取 TS 共享函数、Rust 代码去重（宏/合并结构体）、大文件拆分（manager-app -58%、ai.rs -26%、claude-runner -69%）、类型安全清理。

---

## 019-架构深化重构

5 项纯重构：① Provider Runner 代码重复 → 共享 runner-utils.mjs ② 工具问答 JSON-in-String → 结构化 questionData 字段 ③ send_ai_chat_message 巨型函数 → 5 个模块（models/payload/runner/commands/storage） ④ 上帝组件 → 提取 auto-task-scheduler/file-drop-handler/bubble-layout ⑤ Settings 类型统一 → ai-constants.ts + CLAUDE.md checklist。src/ 目录重组为 ai/ + pet/ + 根目录入口。

---

## 020-皮肤设置展示所有动作

皮肤预览窗口增加所有动作预览。左右结构：左侧预览动画，右侧多宫格动作列表。点击右侧动作切换左侧预览。

---

## 021-小工具开发

实现 Todolist、番茄钟、倒数日三个小工具。架构同 AI Runner：前端 → Rust → Node tools-runner.mjs。支持 CLI 和 stdin 两种模式。聊天面板增加工具切换按钮。数据存储在 `.wimipet/tools/`。

---

## 022-AI对话简化信息

渲染层聚合连续非 text part 为 ChainOfThought，text part 作为总结文本。路径可点击打开文件/目录。问答/权限替换输入框区域，支持多问题排队。ChainOfThought 生成时展开，完成后折叠。

---

## 023-移除多agent支持

移除 Claude 和 Codex Provider，只保留 Pi。删除 run-claude.mjs/run-codex.mjs，简化 Rust 结构体和前端类型，移除 @anthropic-ai/claude-agent-sdk 依赖。

---

## 其它已完成
enabledSkills→disabledSkills / 定时任务 / 项目空间文件规范 / 桌宠名配置 / 技能三级分类 / pi agent集成 / 资源丢失处理 / Codex技能全局配置 / 进程通信架构 / 代码review优化 / UI抖动修复 / 皮肤动作预览

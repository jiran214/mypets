# 小工具命令行使用指南

小工具通过 `wimipet tools` 子命令调用，提供番茄钟、待办清单、倒计时功能。数据存储在工作空间的 `.wimipet/tools/` 目录下。

## 命令行调用

```bash
wimipet tools [--workspace <path>] <command> <action> [--key value ...]
```

- `--workspace` — 桌宠工作空间路径，不指定则使用当前目录
- 输出格式化 JSON 到 stdout，错误信息输出到 stderr
- 成功返回 exit code 0，失败返回 1

## 番茄钟 (pomodoro)

### status — 查看当前状态

```bash
wimipet tools pomodoro status
```

返回当前番茄钟状态、今日已完成列表、剩余时间等。

### start — 开始一个番茄钟

```bash
wimipet tools pomodoro start --duration 25 --label "写代码"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--duration` | 否 | 时长（分钟），1–180，默认 25 |
| `--label` | 否 | 标签文字 |

如果已有进行中的番茄钟会报错。

### pause — 暂停

```bash
wimipet tools pomodoro pause
```

### resume — 恢复

```bash
wimipet tools pomodoro resume
```

### stop — 停止（未完成）

```bash
wimipet tools pomodoro stop
```

将当前番茄钟标记为 `stopped` 并归入今日历史。

### history — 查看今日历史

```bash
wimipet tools pomodoro history
```

---

## 待办清单 (todolist)

### list — 列出待办

```bash
wimipet tools todolist list
wimipet tools todolist list --status pending
wimipet tools todolist list --status done
```

| 参数 | 说明 |
|------|------|
| `--status` | `pending`（未完成）、`done`（已完成）、`all`（默认） |

排序规则：未完成在前，有截止日期的优先按日期排序，同日期按创建时间倒序。

### add — 添加待办

```bash
wimipet tools todolist add --text "买菜"
wimipet tools todolist add --text "交报告" --dueDate 2026-06-01
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--text` | 是 | 待办内容 |
| `--dueDate` | 否 | 截止日期，格式 `YYYY-MM-DD` |

### complete — 标记完成

```bash
wimipet tools todolist complete --id todo-xxxx
```

### uncomplete — 取消完成

```bash
wimipet tools todolist uncomplete --id todo-xxxx
```

### update — 修改待办

```bash
wimipet tools todolist update --id todo-xxxx --text "新内容"
wimipet tools todolist update --id todo-xxxx --dueDate 2026-06-15
```

### delete — 删除待办

```bash
wimipet tools todolist delete --id todo-xxxx
```

---

## 倒计时 (countdown)

### list — 列出所有倒计时事件

```bash
wimipet tools countdown list
```

返回按剩余天数升序排列的事件列表，每个事件包含 `daysRemaining` 和 `nextDate`。

### add — 添加倒计时

```bash
wimipet tools countdown add --name "生日" --date 2026-08-15
wimipet tools countdown add --name "春节" --date 2027-01-29 --repeat yearly
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--name` | 是 | 事件名称 |
| `--date` | 是 | 目标日期，格式 `YYYY-MM-DD` |
| `--repeat` | 否 | 重复方式，目前仅支持 `yearly` |

### update — 修改倒计时

```bash
wimipet tools countdown update --id cd-xxxx --name "新名称"
wimipet tools countdown update --id cd-xxxx --date 2026-12-31
```

### delete — 删除倒计时

```bash
wimipet tools countdown delete --id cd-xxxx
```

---

## Skill 中调用示例

在 SKILL.md 中可以通过 shell 命令调用小工具：

```bash
# 查看番茄钟状态
wimipet tools --workspace /path/to/pet pomodoro status

# 添加待办
wimipet tools --workspace /path/to/pet todolist add --text "写周报"

# 查看待办列表
wimipet tools --workspace /path/to/pet todolist list --status pending

# 添加倒计时
wimipet tools --workspace /path/to/pet countdown add --name "项目截止" --date 2026-07-01
```

## 实现结构

```
src-tauri/src/tools/
├── tools_cli.rs        — CLI 入口（参数解析 + 分发）
├── tools_commands.rs   — Tauri command（应用内调用）
├── tools_storage.rs    — 工具函数（JSON 读写、ID 生成、日期）
├── tools_pomodoro.rs   — 番茄钟逻辑
├── tools_todolist.rs   — 待办清单逻辑
├── tools_countdown.rs  — 倒计时逻辑
└── tools_models.rs     — 数据结构说明
```

CLI 和 Tauri command 共用同一套 handler 函数，行为完全一致。

# 小工具命令行使用指南

`tools-runner.mjs` 是一个独立的 Node CLI，提供番茄钟、待办清单、倒计时三个小工具。数据存储在 `.wimipet/tools/` 目录下。

## 两种调用模式

### 1. CLI 模式（命令行参数）

```bash
node src-node/tools-runner.mjs <command> <action> [--key value ...]
```

输出格式化 JSON 到 stdout。

### 2. Stdin 模式（JSON 管道）

```bash
echo '{"command":"pomodoro","action":"status"}' | node src-node/tools-runner.mjs
```

从 stdin 读取一行 JSON，输出 `{type:"done", requestId, data}` 或 `{type:"error", error}` 的 JSON 行。

---

## 番茄钟 (pomodoro)

### status — 查看当前状态

```bash
node src-node/tools-runner.mjs pomodoro status
```

返回当前番茄钟状态、今日已完成列表、剩余时间等。

### start — 开始一个番茄钟

```bash
node src-node/tools-runner.mjs pomodoro start --duration 25 --label "写代码"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--duration` | 否 | 时长（分钟），1–180，默认 25 |
| `--label` | 否 | 标签文字 |

如果已有进行中的番茄钟会报错。

### pause — 暂停

```bash
node src-node/tools-runner.mjs pomodoro pause
```

### resume — 恢复

```bash
node src-node/tools-runner.mjs pomodoro resume
```

### stop — 停止（未完成）

```bash
node src-node/tools-runner.mjs pomodoro stop
```

将当前番茄钟标记为 `stopped` 并归入今日历史。

### history — 查看今日历史

```bash
node src-node/tools-runner.mjs pomodoro history
```

---

## 待办清单 (todolist)

### list — 列出待办

```bash
node src-node/tools-runner.mjs todolist list
node src-node/tools-runner.mjs todolist list --status pending
node src-node/tools-runner.mjs todolist list --status done
```

| 参数 | 说明 |
|------|------|
| `--status` | `pending`（未完成）、`done`（已完成）、`all`（默认） |

排序规则：未完成在前，有截止日期的优先按日期排序，同日期按创建时间倒序。

### add — 添加待办

```bash
node src-node/tools-runner.mjs todolist add --text "买菜"
node src-node/tools-runner.mjs todolist add --text "交报告" --dueDate 2026-06-01
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--text` | 是 | 待办内容 |
| `--dueDate` | 否 | 截止日期，格式 `YYYY-MM-DD` |

### complete — 标记完成

```bash
node src-node/tools-runner.mjs todolist complete --id todo-xxxx
```

### uncomplete — 取消完成

```bash
node src-node/tools-runner.mjs todolist uncomplete --id todo-xxxx
```

### update — 修改待办

```bash
node src-node/tools-runner.mjs todolist update --id todo-xxxx --text "新内容"
node src-node/tools-runner.mjs todolist update --id todo-xxxx --dueDate 2026-06-15
```

### delete — 删除待办

```bash
node src-node/tools-runner.mjs todolist delete --id todo-xxxx
```

---

## 倒计时 (countdown)

### list — 列出所有倒计时事件

```bash
node src-node/tools-runner.mjs countdown list
```

返回按剩余天数升序排列的事件列表，每个事件包含 `daysRemaining` 和 `nextDate`。

### add — 添加倒计时

```bash
node src-node/tools-runner.mjs countdown add --name "生日" --date 2026-08-15
node src-node/tools-runner.mjs countdown add --name "春节" --date 2027-01-29 --repeat yearly
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--name` | 是 | 事件名称 |
| `--date` | 是 | 目标日期，格式 `YYYY-MM-DD` |
| `--repeat` | 否 | 重复方式，目前仅支持 `yearly` |

### update — 修改倒计时

```bash
node src-node/tools-runner.mjs countdown update --id cd-xxxx --name "新名称"
node src-node/tools-runner.mjs countdown update --id cd-xxxx --date 2026-12-31
```

### delete — 删除倒计时

```bash
node src-node/tools-runner.mjs countdown delete --id cd-xxxx
```

---

## 环境变量

| 变量 | 说明 |
|------|------|
| `TOOLS_DATA_DIR` | 自定义数据存储目录，默认为 `$(pwd)/.wimipet/tools` |

示例：

```bash
TOOLS_DATA_DIR=/tmp/my-tools node src-node/tools-runner.mjs pomodoro status
```

## Stdin 模式示例

```bash
# 单次调用
echo '{"command":"todolist","action":"add","params":{"text":"测试"}}' | node src-node/tools-runner.mjs

# 带 requestId
echo '{"requestId":"req-1","command":"pomodoro","action":"start","params":{"duration":15}}' | node src-node/tools-runner.mjs
```

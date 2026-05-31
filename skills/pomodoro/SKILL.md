---
name: pomodoro
description: Manage pomodoro timers - start, pause, resume, stop, and track daily progress. Use when user wants to focus with a timer, track work sessions, or check pomodoro status.
---

# Pomodoro Timer

## Quick Start

```bash
# Start a 25-minute pomodoro
wimipet tools pomodoro start

# Check status
wimipet tools pomodoro status
```

## Actions

### status
Get current pomodoro state and today's completed count.

```bash
wimipet tools pomodoro status
```

### start
Start a new pomodoro session.

```bash
# Default 25 minutes
wimipet tools pomodoro start

# Custom duration (1-180 minutes)
wimipet tools pomodoro start --duration 30

# With a label
wimipet tools pomodoro start --label "写报告"
wimipet tools pomodoro start --duration 45 --label "代码审查"
```

**Parameters:**
- `--duration <minutes>` — 1-180, default 25
- `--label <text>` — optional description

### pause
Pause the running pomodoro.

```bash
wimipet tools pomodoro pause
```

### resume
Resume a paused pomodoro.

```bash
wimipet tools pomodoro resume
```

### stop
Stop the current pomodoro (marks as stopped, not completed).

```bash
wimipet tools pomodoro stop
```

### history
View today's completed pomodoros.

```bash
wimipet tools pomodoro history
```

## Response Format

```json
{
  "current": {
    "id": "pomo-xxx",
    "label": "写报告",
    "durationMinutes": 25,
    "startedAt": 1234567890,
    "status": "running",
    "elapsedSeconds": 300,
    "remainingSeconds": 1200
  },
  "todayCompleted": [...],
  "todayCompletedCount": 3,
  "todayDate": "2026-05-29"
}
```

## Notes

- Only one pomodoro can be active at a time
- Pomodoros auto-complete when time runs out
- History resets daily

---
name: todolist
description: Manage todo items - add, list, complete, update, and delete tasks. Use when user wants to track tasks, manage a to-do list, or organize work items.
---

# Todo List

## Quick Start

```bash
# Add a task
wimipet tools todolist add --text "买 groceries"

# List pending tasks
wimipet tools todolist list --status pending
```

## Actions

### list
List todos with optional status filter.

```bash
# All todos
wimipet tools todolist list

# Only pending
wimipet tools todolist list --status pending

# Only completed
wimipet tools todolist list --status done
```

**Parameters:**
- `--status <all|pending|done>` — default: all

### add
Create a new todo item.

```bash
# Simple task
wimipet tools todolist add --text "写周报"

# With due date
wimipet tools todolist add --text "提交代码" --dueDate 2026-05-30
```

**Parameters:**
- `--text <text>` — required, task description
- `--dueDate <YYYY-MM-DD>` — optional due date

### complete
Mark a todo as completed.

```bash
wimipet tools todolist complete --id todo-xxx
```

**Parameters:**
- `--id <id>` — required, todo ID

### uncomplete
Mark a completed todo as pending.

```bash
wimipet tools todolist uncomplete --id todo-xxx
```

### update
Modify an existing todo.

```bash
# Update text
wimipet tools todolist update --id todo-xxx --text "新内容"

# Update due date
wimipet tools todolist update --id todo-xxx --dueDate 2026-06-01

# Clear due date
wimipet tools todolist update --id todo-xxx --dueDate ""

# Update both
wimipet tools todolist update --id todo-xxx --text "新内容" --dueDate 2026-06-01
```

### delete
Remove a todo permanently.

```bash
wimipet tools todolist delete --id todo-xxx
```

## Response Format

```json
{
  "todos": [
    {
      "id": "todo-xxx",
      "text": "写周报",
      "completed": false,
      "createdAt": 1234567890,
      "completedAt": null,
      "dueDate": "2026-05-30"
    }
  ],
  "status": "pending"
}
```

## Sorting

Todos are sorted by:
1. Incomplete before completed
2. Earlier due dates first
3. Newer items first (when due dates match)

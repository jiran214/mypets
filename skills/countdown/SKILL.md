---
name: countdown
description: Track countdown to important dates and events. Use when user wants to count days until an event, track deadlines, or manage date-based reminders.
---

# Countdown Events

## Quick Start

```bash
# Add an event
wimipet tools countdown add --name "生日" --date 2026-06-15

# List all events
wimipet tools countdown list
```

## Actions

### list
Show all countdown events sorted by days remaining.

```bash
wimipet tools countdown list
```

### add
Create a new countdown event.

```bash
# One-time event
wimipet tools countdown add --name "项目截止" --date 2026-06-30

# Yearly recurring event
wimipet tools countdown add --name "生日" --date 2026-06-15 --repeat yearly
```

**Parameters:**
- `--name <text>` — required, event name
- `--date <YYYY-MM-DD>` — required, target date
- `--repeat <yearly>` — optional, repeat annually

### update
Modify an existing event.

```bash
# Update name
wimipet tools countdown update --id cd-xxx --name "新名称"

# Update date
wimipet tools countdown update --id cd-xxx --date 2026-07-01

# Add yearly repeat
wimipet tools countdown update --id cd-xxx --repeat yearly

# Remove repeat
wimipet tools countdown update --id cd-xxx --repeat ""
```

### delete
Remove an event permanently.

```bash
wimipet tools countdown delete --id cd-xxx
```

## Response Format

```json
{
  "events": [
    {
      "id": "cd-xxx",
      "name": "生日",
      "date": "2026-06-15",
      "repeat": "yearly",
      "createdAt": 1234567890,
      "nextDate": "2026-06-15",
      "daysRemaining": 17
    }
  ]
}
```

## Features

- **Auto-calculation**: `daysRemaining` updates automatically each day
- **Yearly repeat**: For recurring events, calculates next occurrence based on today
- **Sorting**: Events sorted by days remaining (closest first)

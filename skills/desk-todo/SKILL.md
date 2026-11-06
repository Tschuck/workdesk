---
name: desk-todo
description: Keep the Todos of this WorkDesk: list, add, resolve, reopen. Use when the user says "add a todo", "tick off X", "what's left here".
---

- `node "$WORKDESK_CLI" todo list` (ids, titles, resolved)
- `todo add "<title>"`, `todo done <id>`, `todo reopen <id>`

When you finish a piece of work the user asked for, offer to tick its Todo; when you notice follow-up work, offer to add a Todo rather than doing it unasked.

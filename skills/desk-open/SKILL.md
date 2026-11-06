---
name: desk-open
description: Open, find or start a WorkDesk. Use when the user says "open the desk for X", "which desks do I have", or wants a new desk for a piece of work.
---

Run in a WorkDesk terminal (the app sets `$WORKDESK_CLI`):

- `node "$WORKDESK_CLI" desk list` shows every desk with its stage, presence, branches and Todos.
- `node "$WORKDESK_CLI" desk open <id|name>` brings it to the front; a planned desk is started.
- `node "$WORKDESK_CLI" desk start "<title>" [--todo <id>]` makes a Plain WorkDesk.

Match the user's words against the `name`s from `desk list`. If two fit, ask which. Say what you opened, in one line.

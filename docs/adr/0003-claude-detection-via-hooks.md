---
title: "ADR 0003 — Claude state detected through Claude Code hooks, matched by working directory"
---

# ADR 0003 — Claude state detected through Claude Code hooks, matched by working directory

## Status
Accepted — 2026-10-27.

## Context
Signals such as "Claude needs input" and "Claude finished" must be raised no matter where Claude runs (tool Terminal, VS Code, another terminal app). Scraping Terminal output would only work for sessions the tool started and would break on output changes.

## Decision
The tool installs Claude Code hooks (`Notification`, `Stop`, `UserPromptSubmit`, `SessionStart`) that run `workdesk hook <event>`. This small CLI talks to the running app over a unix socket and exits silently if the app is not running, so a broken tool never blocks Claude. The event is matched to a WorkDesk by its working directory lying under the WorkDesk's folder.
- Hooks are installed after user consent into every registered Claude config directory.
- Only sessions started by the tool are restorable; others still raise Signals.
- v1 supports Claude Code only, behind an agent-adapter interface for other agents.

## Consequences
- Editing the user's Claude settings is invasive; consent and clean uninstall are required.
- Matching by cwd fails if Claude runs outside the WorkDesk folder; those sessions raise no Signals.
- Signals clear themselves when a later hook shows they no longer apply (e.g. `UserPromptSubmit`).

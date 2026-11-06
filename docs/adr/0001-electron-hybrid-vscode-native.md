---
title: "ADR 0001 — Electron hybrid: embedded Terminals and Browsers, native VS Code"
---

# ADR 0001 — Electron hybrid: embedded Terminals and Browsers, native VS Code

## Status
Accepted — 2026-10-27.

## Context
A WorkDesk bundles Terminals, Browser pages and an Editor for one piece of work, and several WorkDesks run side by side. Switching between them has to be instant, in particular showing and hiding the Editor. Fully native apps are costly to build; a fully embedded editor (Monaco, code-server) would lose the user's real VS Code setup, extensions and Claude Code integration.

## Decision
WorkDesk is an Electron app (macOS only in v1).
- **Terminals** are xterm.js with node-pty, each WorkDesk backed by its own tmux session (one tmux window per Terminal Pane), so they survive parking and app restarts.
- **Browsers** are `<webview>` Panes sharing one persistent session partition, so logins to GitHub, Notion etc. are made once.
- **The Editor** stays the native VS Code, opened on the WorkDesk's `.code-workspace` and shown or hidden through a window-control interface (`showEditor/hideEditor/closeEditor`) so other platforms can be added later.
- Claude sessions started by the tool are restored with `claude --resume <id>`.

## Consequences
- The Editor Tab cannot be split or embedded in a Pane; it is a native window that is only shown or hidden.
- Window control depends on macOS APIs (Accessibility / AppleScript); this is the main portability risk and is isolated behind the interface.
- One VS Code window per WorkDesk, opened on a multi-root `.code-workspace` with a folder per Branch; the tool adds and removes folders as Branches come and go, and clicking a Branch in the sidebar focuses its folder. This keeps show/hide to a single window at the cost of VS Code showing all repos in Source Control.
- Requires `tmux`, `git` and `code` on the user's machine; first run checks for them.
- Cookies are shared across all WorkDesks; two accounts on one site at once are not supported (an opt-in isolated Browser Pane could be added later).

## Update (2026-10-28)
The Editor is no longer a Tab laid over the Tab area. It is the user's own VS Code window, opened and raised by a button in the tab bar, and never moved or resized (people size it for reviewing). Opening one WorkDesk's editor minimises the windows of the other WorkDesks (macOS can only hide a whole app, not one window, so minimising is the closest to "out of the way"). The Consequences above about the Editor Tab are superseded; Tabs now hold only what lives inside the app.

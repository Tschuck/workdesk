---
title: "ADR 0005 — A File pane with a light editor, next to the native VS Code"
---

# ADR 0005 — A File pane with a light editor, next to the native VS Code

## Status
Accepted — 2026-10-30.

## Context
ADR 0001 kept the Editor as the user's native VS Code window and rejected an embedded editor, because a replacement would lose their VS Code setup, extensions and Claude Code integration. In daily use the window is clumsy for small jobs: a VS Code window has to be opened and raised to look at one file, change a line, keep a scratch note or search a Branch, and it cannot sit in a tab or beside a Terminal. macOS cannot embed another app's window, and VS Code's web build (`code serve-web`) is a heavy second workbench with its own extensions and settings.

## Decision
A third kind of Pane, the **File**, shows one file in an embedded Monaco editor, with a file tree and a search (`git grep`, regex and glob) on its left. It complements the native Editor and does not replace it: *VS Code ↗* in the pane opens the same file and line in the WorkDesk's VS Code window.
- Files come from the Branch folders (tracked and untracked, not ignored) and from a per-WorkDesk **scratch** folder (`<WorkDesk>/scratch/`, deleted with the WorkDesk). Only paths inside those folders can be read or written.
- Monaco's language services run in workers but know nothing of the project, so TypeScript reports syntax errors only. ESLint, project-wide types and extensions stay in VS Code.
- Monaco is loaded when the first File pane opens, not at start.

## Consequences
- Layouts can hold `kind: 'file'` panes; older versions of the app would not know them.
- The renderer grows by Monaco (a few MB, loaded lazily) and its workers.
- Two ways to edit a file exist; the File pane is for looking, small changes and scratch text, VS Code for real work. Unsaved changes live only in the pane (files of a Branch are written on ⌘S; scratch files as you type).
- Keys the pane shares with the app (⌘ and ⇧⌘ with arrows, ⌘B, ⌘S, ⇧⌘F) are taken before Monaco uses them.

---
title: "ADR 0002 — A separate, generic code base"
---

# ADR 0002 — A separate, generic code base

## Status
Accepted — 2026-10-27. Revised: the license is PolyForm Shield (source-available), see `LICENSE`.

## Context
WorkDesk grew out of a private prototype (PR/Notion to Todo, review state, worktree slots). That setup contained hardcoded defaults, paths and a fixed Notion board. WorkDesk is meant to be used by others.

## Decision
WorkDesk is its own repository with its own data and no code or data shared with the prototype.
- No built-in defaults for anybody's employer, no hardcoded paths or boards. The root folder, Projects and Sources are configured by the user.
- Sources (GitHub Pull Requests, Notion, later Jira/Linear) sit behind an interface; non-secret configuration lives in the Status Repo, tokens only in the macOS Keychain.
- Todos, notes and knowledge live in the `workdesk-status` git repository inside the root folder, auto-committed locally and pushed only if the user configures a remote.
- Ideas of the prototype are re-implemented, not imported.

## Consequences
- Some logic exists twice (PR/Notion fetching, worktree creation) and can drift.
- Everything configurable costs setup effort (e.g. Notion property mapping) that a hardcoded tool would not have.

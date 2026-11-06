---
title: "Getting started"
description: "Requirements, install and the first-time setup."
---

# Getting started

## What you need

| | |
|---|---|
| macOS | Apple Silicon build; Intel needs the `arch` in `electron-builder.yml` changed |
| `git`, `tmux`, VS Code with the `code` command on the PATH | needed at runtime; the app checks for them on start |
| Node.js 22 and [pnpm](https://pnpm.io) 11 | to run it from source or build it |
| `gh` (optional) | GitHub login without a token (`gh auth login`) |

## Install

There is no installer yet. Run it from source or build the app yourself:

```bash
git clone <your copy of the repository> workdesk
cd workdesk
pnpm install       # also rebuilds node-pty for Electron
pnpm dev           # starts the app with hot reload
```

To get a normal app, `pnpm package` builds an unsigned `.dmg` into `dist/` (`pnpm package:dir` just the `.app`). The app is **unsigned**, so on first start right-click it and choose *Open*.

Want to look around first? Start it with `WORKDESK_SEED=1 pnpm dev`: it adds in-memory demo WorkDesks and Todos (Signals, Stages, a stack) and writes nothing.

## First start

1. **Allow the editor control.** Showing and hiding the VS Code window uses AppleScript through System Events. macOS asks once; allow it under *System Settings → Privacy & Security → Accessibility*.
2. **Open the Dashboard.** It has a **first-start checklist** that links to each step below, so you can do them in any order and skip what you do not use.
3. **Add a Project.** *Settings → Projects → +*: clone a repository (kept as a bare clone in `.projects/`) or point to a clone you already have. Add its setup commands (for example `pnpm install`) if it has any: they run in a terminal each time a branch is checked out.
4. **Connect GitHub.** Run `gh auth login`, or store a personal access token under *Settings → GitHub*. It needs to read pull requests and checks.
5. **Install the Claude hooks** (if you use Claude Code). *Settings → Claude*: register your Claude config folder (for example `~/.claude`) and press *Install hooks*. This is what turns "Claude finished" and "Claude needs input" into Signals. *Uninstall hooks* removes exactly what was added.
6. **Give your data a backup.** Todos, notes and WorkDesks are a git repo (the Status Repo). On the Dashboard, set a remote of your own (an empty repository you created) to keep a copy and share it between machines.
7. **Optional: Notion.** Connect your own Notion integration to see your sprint tickets. See [Services](/features/services).

## Your first WorkDesk

Add a Todo, press **Add to today**, then **Start** it: you have a desk with a terminal, browser and branches. [Set up and start working](/use-cases/setup) walks through it.

## Where things go

By default everything lives under `~/workdesk` (change it with `WORKDESK_ROOT`): one folder per WorkDesk, a bare clone per Project, and the `workdesk-status` git repo with your Todos and notes. See [Data and storage](/features/data-and-storage).

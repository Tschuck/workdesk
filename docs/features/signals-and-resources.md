---
title: "Signals, parking and resources"
description: "What needs you, parking, clearing, quitting and saving memory."
sidebar_position: 14
---

# Signals, parking and resources

## Signals

A **Signal** says that a WorkDesk needs you: Claude needs input or has finished, a re-review was requested, new review comments arrived, checks finished, a Todo is due, a pull request is ready to merge. Claude's Signals come from Claude Code hooks, so they work wherever Claude runs. See [Claude](./claude.md).

- A WorkDesk with an open Signal shows a red number. Opening it jumps to the tab of its oldest Signal.
- A Signal clears once its pane has been visible and focused for about two seconds. *Mark as read* in the right-click menu clears the number; *Mark as unread* gives it a red 1 until you open it.
- **Order:** a running WorkDesk keeps its place in your own order, and the red number says it needs you. A parked one with a Signal goes on top of its section, oldest first. The Dashboard's *Needs you* lists them oldest first.
- Signals are only raised while the app runs.

## Park

**Park** shuts down a WorkDesk's terminals, dev servers and editor window to free resources. Tabs, notes, branches, Todos and Claude sessions are kept and come back on *Reactivate*. A parked WorkDesk is still watched: the background round reads its pull requests, so an approval or new comment raises a Signal and a notification.

- **When a WorkDesk starts waiting,** WorkDesk can ask whether to park it or leave it active. *Settings → Behavior* sets *Ask me*, *Park it* (asks anyway when a program such as a dev server or Claude runs in it) or *Keep it active*. The dialog's *Remember my choice* sets it too. A waiting WorkDesk that still runs shows a hint with a Park button.
- **Park all and Reactivate all** are in each section of the left panel. They act on the WorkDesks listed there, only in the Profile in view, and the same commands in ⌘P and the *WorkDesk* menu follow the same rule. *Park all* asks first: the dialog lists what runs in each WorkDesk (terminals and programs such as Claude or a dev server) and warns about Claude sessions that cannot be resumed (those without a session id, which needs the Claude hooks).
- **Before restarting the machine:** park the sections, restart, then *Reactivate all*. Each Claude pane resumes its session (`claude --resume`) when it is shown again, in the folder it ran in.
- If Claude cannot resume or ends, the pane becomes a shell that shows why, instead of going black.

## Clear

**Clear** ends a WorkDesk for good and never happens by itself. A WorkDesk that can be cleared is listed under *Can be cleared*. The dialog first runs a **pre-flight check**: uncommitted, untracked and unpushed work, branches without a remote, and `.env` files not in the store.

What happens to each part:

| Part | What happens |
|---|---|
| **Notes** (the *notes* folder, any file type) | A link into the Status Repo (`desks/<desk>/notes`), written there from the start and committed by the auto-commit. Clearing **moves** the folder to `archive/<date>-<desk>/notes`. Nothing is copied or lost. |
| **Scratch** (`<WorkDesk folder>/scratch/`) | Not in the Status Repo and **goes with the WorkDesk**. Move files you want to keep into *notes* or *knowledge* first (drag, or right-click → *Move to knowledge…*). |
| **Knowledge** and **global scratch** | Belong to the Status Repo and are never touched. |
| **Branch folders** | Removed after the pre-flight check. **Branches are kept**, except those you tick. |
| **Todos** | Stay. |
| **Claude session ids, final Stage, the WorkDesk's note** | Archived. |

Every branch of the WorkDesk is listed after a pruning fetch, so one deleted on GitHub after its merge shows as gone. When that fetch fails (for example a locked SSH agent), GitHub is asked through the app's login. Per branch you can tick *delete on the remote (origin)* (only where it is still there) and *delete here (the clone)*, which stays disabled until the remote one is ticked when the branch is on the remote. Each carries a note when its commits would be lost.

Large or many PDFs in notes make the Status Repo grow, and its history keeps them even after you delete them. If an earlier clear stopped half way (its archive folder exists already), the notes are merged into it without overwriting anything.

## Quit

Quitting the app does **not** stop your terminals: they live in tmux, so Claude can finish what it is doing while WorkDesk is closed, and you pick up where you left off. When terminals are running, quitting asks and tells you what is running:

- **Quit, Keep Running:** the terminals stay in the background (`tmux -L workdesk ls` shows them).
- **Quit and Stop Terminals:** ends every shell and everything running in it. `⌥⌘Q` always does this without asking.
- *Remember my choice* stops the question. *Settings → Behavior → When quitting* (or the *WorkDesk* menu → *When Quitting*) changes it.

Claude Signals are not raised while the app is closed, and the hidden Claude usage session is stopped on quit.

## Performance and saving memory

The **Performance** page (the entry at the bottom of the left panel) shows memory and CPU of the app itself, of each WorkDesk's terminals (and what runs in them, such as `claude`), of VS Code, the hidden usage session and the tmux server, with a total and a **Park** button per WorkDesk. It is read from `ps` and tmux every few seconds while the page is open; CPU is measured between two samples, in percent of one core. The app is split into its main process, window, GPU and the page of each browser tab (with the highest CPU seen, to catch spikes), each WorkDesk into its terminals and the process tree in each, and VS Code into its windows by title.

- **Hibernate:** a loaded page costs about 70 to 80 MB, even a blank one. A browser tab out of sight for 30 minutes is **hibernated**: its pages are unloaded and the tab is dimmed, exactly what *Hibernate* in the tab's menu does. It loads again, scrolled to where you were, only when you press *Wake up*. *Settings → Browser → General → Hibernate unused pages* sets the delay or switches it off, and keeps a list of hosts that are never unloaded (`meet.google.com` also covers its subdomains). Pinned tabs and tabs whose page plays sound are left alone, and terminals are never touched. Hovering a tab shows what its pages use, or what unloading them freed.
- **Lazy tabs:** tabs without a terminal (pages, files) are not built until first shown, so a WorkDesk with many of them costs little until you look at them.
- **Planned WorkDesks** run nothing.
- **Measure:** `pnpm perf` starts the built app with a throw-away data folder and 1, 5 and 15 WorkDesks and compares startup, memory and typing latency in the editor with `scripts/perf-budget.json` (`node scripts/perf-measure.mjs --desks 3 --hibernate` also checks hibernation, and takes about two minutes).

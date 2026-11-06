---
title: "Terminals"
description: "Terminal panes, tmux, links and what survives a restart."
sidebar_position: 8
---

# Terminals

Terminals are real terminals (xterm.js) backed by **tmux**, so shells survive closing the app. WorkDesk uses its own tmux server (`tmux -L workdesk`), apart from yours; `tmux -L workdesk ls` lists the sessions. Split them horizontally and vertically like any pane.

- **The folder above each terminal** shows where its shell is right now (it follows every `cd`) and, in a git folder, the branch. Your shell prompt can stay short. WorkDesk reads the folder from tmux every three seconds while the window is in use.
- **Grouped by branch:** in a list of tabs grouped by branch, a tab whose terminals `cd` into another branch's folder moves to that branch's group. A tab you put under a branch by hand (*List under …*) stays there until you choose *List in its own branch again*. If its panes are in different branches it stays under *other*.
- **Copying:** select with the mouse as usual (tmux handles it and the text goes to the system clipboard), or hold **Option** and drag to select in the terminal itself, then `⌘C`. `⌘C` without a selection is left alone, and `Ctrl+C` is still the interrupt.
- **Links:** what Claude and your tools print opens with ⌘-click and copies with ⌥⌘-click, also when tmux wrapped a link over two rows.
- **When the program ends** (the shell exits, or the `claude` it started with quits), the pane stays as it is with a note. Close it with × or `⌘W`.
- **Closing a tab that is running something other than a shell prompt** (Claude, a dev server) asks first, like quitting does.
- **A terminal icon** before a tab's name tells it has a terminal; a tab that is one web page shows the page's icon.

## Cost

Terminals on screen draw with the GPU (WebGL). Hidden ones (another tab or WorkDesk) draw nothing: they keep the shell running and are repainted from tmux when shown, so many WorkDesks with busy sessions cost little CPU.

## Search the terminals

*Search all WorkDesks…* in ⌘P has a **Terminals** mode: the visible text and the last 3000 lines of every tmux pane.

## What survives

Closing the app does not stop terminals. Parking a WorkDesk ends its terminals; Claude panes come back with `claude --resume`. See [Signals, parking and resources](./signals-and-resources.md).

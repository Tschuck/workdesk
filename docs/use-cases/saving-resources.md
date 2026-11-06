---
title: "Save resources"
description: "Park, hibernate and measure."
sidebar_position: 10
---

# Save resources

**Goal:** run many desks without a machine that crawls.

## See what costs what

The **Performance** entry at the bottom of the left panel shows memory and CPU. Its page splits the app, each WorkDesk's terminals (and what runs in them, such as `claude`), VS Code, the hidden usage session and the tmux server, with a total and a **Park** button per desk.

## Park what waits

**Park** shuts down a desk's terminals, dev servers and editor window; tabs, notes, branches and Claude sessions are kept. A parked desk is still watched, so an approval or an answer still reaches you.

- A desk that moves to **Waiting** can be parked for you: *Settings → Behavior* sets *Ask me*, *Park it* or *Keep it active*.
- A running waiting desk shows a hint with a Park button.
- Each section of the left panel has *Park all* for the desks listed there. Before a restart, the dialog shows what runs where and warns about Claude sessions that cannot be resumed.
- *Reactivate all* brings parked desks of a section back.

## Plan instead of start

A **planned** desk has nothing running and nothing checked out. Add to today as much as you like and start only what you work on.

## Hibernate pages

A browser tab out of sight for 30 minutes is unloaded and shows *Wake up*; *Settings → Browser → General → Hibernate unused pages* changes the delay and lists hosts to exclude. Terminals on screen draw with the GPU, hidden ones draw nothing.

## Quit without stopping

Quitting keeps your terminals alive in tmux, so Claude can finish while WorkDesk is closed. Choose *Quit and Stop Terminals* (`⌥⌘Q`) when you want everything gone.

## Related

[Signals and resources](/features/signals-and-resources)

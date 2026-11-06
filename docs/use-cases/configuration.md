---
title: "Configure the app"
description: "Theme, tabs, quitting, waiting policy and environment variables."
sidebar_position: 3
---

# Configure the app

**Goal:** make WorkDesk behave the way you work. Everything you set once is under *Settings*. Whatever you add (a Profile, Project, Status Repo, Claude Account, extension, repeating WorkDesk) is added with the **+** at the top of its page.

## Look and layout

- **Theme:** *Settings → Appearance*. Six themes (Gruvbox Dark, the default, Gruvbox Light, Nord, Dracula, Tokyo Night, Solarized Dark); a click switches the app and its terminals at once.
- **Tabs on top or as a list:** also in *Appearance → Tabs*. The browser page, the WorkDesks and the Files page each get their own choice: a row on top, or a list at the left or right.
- **Hide the left panel** with the button in its header or `⌘\`; a slim icon rail stays.
- **Shortcuts:** *Settings → Shortcuts* lists them and lets you hide pane buttons.

## Behaviour

- **When quitting:** *Settings → Behavior → When quitting*. Quitting does not stop your terminals (they live in tmux). Choose *Ask*, *Keep running* or *Stop terminals*. `⌥⌘Q` always stops everything without asking.
- **When a WorkDesk starts waiting:** *Settings → Behavior*. *Ask me*, *Park it* (it still asks when something like a dev server or Claude runs in it) or *Keep it active*.
- **Hibernate unused pages:** *Settings → Browser → General*. Sets after how long unseen browser tabs are unloaded, or switches it off, and lists hosts that are never hibernated.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `WORKDESK_ROOT` | `~/workdesk` | the WorkDesk root folder |
| `WORKDESK_SEED` | unset | `1` adds in-memory demo WorkDesks and Todos to look at the UI |
| `WORKDESK_NO_USAGE` | unset | `1` does not start the hidden Claude sessions that read usage |
| `WORKDESK_TMUX_SOCKET` | `workdesk` | name of the tmux server (`tmux -L <name>`) |
| `WORKDESK_SOCKET` | in the app's data folder | unix socket for Claude hook events |

## Backup

On the Dashboard, set a **remote** for the Status Repo: your Todos, notes and WorkDesks are auto-committed locally and pushed there. Tokens and the `.env` store are never pushed.

## Related

[Settings](/features/settings) · [Data and storage](/features/data-and-storage)

---
title: "Data and storage"
description: "Where things live, what is backed up and what stays on this machine."
sidebar_position: 18
---

# Data and storage

All state is plain files you own. Nothing goes to a service of ours: WorkDesk talks to GitHub, Notion and the other services you connect, and to nothing else.

## The Status Repo

Todos, WorkDesks, notes, the archive and most settings live in a git repo, the **Status Repo**. It is auto-committed locally (debounced, about every minute) and pushed if you configure a remote.

**Backup remote:** *Settings → Status Repos → Backup remote…* takes the URL of an empty git repository, checks that it can be reached, sets it as `origin` and pushes right away. An empty field removes the remote.

The sync never asks for a password. An SSH remote (a NAS, say) needs a key that works without one: `ssh-copy-id user@host`, then `ssh -o BatchMode=yes user@host true` must succeed, otherwise the sync fails with a message saying so.

Each Profile can have its own Status Repo. See [Profiles](./profiles.md).

## Folder layout

```
<workdesk-root>/                     # WORKDESK_ROOT
  workdesk-status/                   # its own git repo (the Status Repo)
    todos.json                       # your Todos (the order of the array is the order everywhere)
    notes/<todo>.md                  # markdown notes of a Todo
    desks/<desk>/                    # a WorkDesk's record and live notes
    archive/<date>-<desk>/           # cleared WorkDesks: notes, Claude session ids, final Stage
    sources/<source>/                # config.json, tracked.json, skipped.json
    projects.json  claude-dirs.json  # registered Projects and Claude config dirs
  .projects/<project>.git            # bare clone per Project
  .env/<project>/...                 # the central .env store (never in the Status Repo)
  <desk>/                            # one folder per WorkDesk
    <project>/                       # git worktree of the first branch
    <project>--2-<slug>/             # further branches get their own worktree
    CLAUDE.md                        # generated: what this WorkDesk is and how it is handled (your text below the block stays)
    notes -> ../workdesk-status/desks/<desk>/notes
    <desk>.code-workspace
    .workdesk/state.json             # Tabs, Panes, active Tab
    .workdesk/claude-sessions.json   # Claude sessions started in Panes (for resume)
```

## What is never in the Status Repo

| What | Where |
|---|---|
| Tokens and OAuth secrets | the macOS Keychain, items named `workdesk-profile-<profile id>-github-token`, `…-notion-oauth`, `…-provider-gitlab-token`, `…-provider-jira-token` |
| `.env` files | the central store, `.env/<project>/…` |
| Profiles | `profiles.json` in the app's user data folder (they name Status Repo folders of this machine) |
| Time tracking | `time-tracking.json` in the user data folder, 90 days |
| Browser session (logins), history, extensions, block lists | the user data folder (Electron's persistent partition `persist:workdesk-browser`) |
| The usage reading, window sizes, which panels are open | the user data folder |
| tmux sessions | WorkDesk's **own** tmux server, `tmux -L workdesk`, apart from yours; `tmux -L workdesk ls` lists them |

## Remote data

Everything read from GitHub and Notion (review requests, your pull requests, pull request state, tickets, branch pull requests) is **kept in the app for five minutes** and shared, so opening another page that shows the same list costs nothing. A reload icon next to a page title asks the network again.

One **background round every five minutes**, only while the window is visible and the machine unlocked, assigns the pull requests of your WorkDesks' branches to them, reads the state of the pull requests of started WorkDesks and follows their reviews. The *Sync branch PRs* icon in a WorkDesk's branches does the assignment at once, and the reload icon in the left panel's header runs the whole round. The design is in the decision record [Remote data cached and polled in main](../adr/0004-remote-data-cached-and-polled-in-main.md).

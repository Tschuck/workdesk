---
title: "Claude"
description: "Accounts, hooks, sessions, usage, skills and the Orchestrator."
sidebar_position: 17
---

# Claude

WorkDesk runs Claude Code in the terminals of a WorkDesk and turns what Claude does into Signals. See [Work with Claude](../use-cases/working-with-claude.md) for a walkthrough.

## Hooks

*Settings → Claude*: register your Claude config directory (for example `~/.claude`) and press *Install hooks*. This adds four hook entries (`Notification`, `Stop`, `UserPromptSubmit`, `SessionStart`) that call `workdesk hook <event>` (`cli/workdesk.mjs`) and exit silently if the app is not running. *Uninstall hooks* removes exactly those entries. Install them in the folder of **every** Account, or its sessions raise no Signals and do not show in the overview.

## Accounts

*Settings → Claude → Accounts* lists the Claude logins WorkDesk knows, as many as you like (*Work*, *Private*, …). Each has:

- a **name** and an optional **config folder** (`CLAUDE_CONFIG_DIR`; empty is the default login of Claude Code),
- its own login state with **Log in** / **Log out** buttons (nothing opens a login page by itself),
- its plan and usage limits (5-hour session and week, with reset times), and *Refresh*.

*Add Account* adds one, the name field renames it, *Remove* forgets it (the login itself is not touched; the last one cannot be removed), and *Make default* marks the one that WorkDesks without their own choice use (a thin yellow bar). Accounts are saved as `claude-accounts.json` in the Status folder, with no tokens in it. WorkDesk never reads or stores the login itself; it only asks `claude auth status`.

**The Account of a WorkDesk:** in a WorkDesk's settings (shown when there are two or more Accounts), *Claude Account* picks the login its terminals use. **New** terminals of that WorkDesk start with `CLAUDE_CONFIG_DIR` set to the Account's folder, so `claude` typed in them uses it. Open terminals keep their environment (open a new one, or `export` it by hand). *Default* follows the default Account; a removed Account falls back to the default. There is no per-tab choice yet. A Profile's Claude Account is used by its WorkDesks that have none of their own.

## Usage

The usage of every Account is always visible at the bottom of the left panel: one block per Account (its name, then the session and week bars; with a single Account no name). A system notification names the Account when its 5-hour or weekly limit turns red (90 %).

To read it, WorkDesk starts a hidden Claude Code session on its own tmux server, asks it for `/usage` and **ends it again**: one Account after the other (so at most one runs, for about ten seconds, named `_workdesk-usage-<id>`), **every 5 minutes** (1 to 60, under *Usage settings*). It also reads when you press reload and when the window gets focus again after longer than the interval. It reads **nothing** while the screen is locked or the Mac sleeps, or after the window has been out of focus for more than 30 minutes (one reading when you come back). It waits longer (2 to 15 minutes) when Claude says its usage endpoint is rate limited, and never starts a session for an Account that is not logged in. `WORKDESK_NO_USAGE=1` switches it off.

## Sessions

The Dashboard's **Claude sessions** panel lists every Claude running in a terminal of a WorkDesk that is in use (parked and planned ones run nothing), with its WorkDesk and tab, **Account**, **state** (*waiting for you*, *finished*, *working*, *idle*), the last message (the question it waits with, or its closing message) and the time since. Those that need you are on top, the longest waiting first. A click goes to that pane.

State and message come from the hooks while the app runs: after a restart a session shows as *idle* (or *waiting* / *finished* if a Signal is open) until it does something. A session is recognised by `claude` (or its version number) being the program in the pane.

Sessions started in a pane are restored with `claude --resume` after parking, in the folder the session ran in.

## Skills and the command line

The terminals of a WorkDesk have `$WORKDESK_CLI`, a small command that talks to the running app. `node "$WORKDESK_CLI" help` lists the `desk`, `branch`, `todo`, `pr`, `review` and `pane` commands (`pr add <url>` puts a pull request of yours into the WorkDesk; `desk-pr` does it after opening one). They act on the WorkDesk of the current folder, or `--desk <id|name>`.

The `skills/` folder has ready-made Claude Code skills on top of it: `desk-open`, `desk-close`, `desk-add-branch`, `desk-review`, `desk-review-preset`, `desk-todo`, `desk-status`, `desk-address-comments`, `desk-review-to-pr`, `desk-pr`, `desk-handoff` and `desk-scratch`. Install them from *Settings → Claude → Skills*, or copy them to `~/.claude/skills/`.

Every WorkDesk folder also has a generated `CLAUDE.md`. See [Branches](./branches.md).

## Orchestrator (experiment)

The **Orchestrator** page shows one Claude of its own as a terminal. It lives in its own tmux session (not a WorkDesk, so it survives the app) and runs in the app's data folder. Its handbook is a `CLAUDE.md` written again at every start: what WorkDesk is (the glossary of `CONTEXT.md`), every command of the `workdesk` command line, the `desk-*` skills, how to write a worker's prompt, and its rules.

- **It decides from `desk list`:** Stage, open Signals, whether a WorkDesk *can be cleared*, minutes worked today and yesterday, and the state of the Claude sessions in it.
- **It may park** a WorkDesk that is not worked in (no working or waiting Claude, no open Signal, little time today, not the one you are in) and says so.
- **It suggests clearing** (it shows what `desk clear` would lose) and clears only after your yes for that WorkDesk.
- **It never** merges, pushes, submits a review, comments on a pull request or deletes branches, and asks when something needs a decision.
- **Account:** a menu above the terminal picks the account it runs under; it takes effect on *Restart*.
- **Running sessions:** `workdesk pane read --desk <id> <pane|tab>` shows what a terminal shows, and `pane send --desk <id> <pane> <text…>` types into it, then Enter. It reads first, never sends into a session that is working, and sends into a session you started yourself only after you said so.
- **Workers:** `workdesk desk claude --desk <id> --name <tab> <prompt>` starts a Claude in a new terminal tab of that WorkDesk (in its first branch folder, under the WorkDesk's Account; a planned or parked WorkDesk is started first). The tab is added without changing the one you are looking at and shows as a normal tab and session, so you can take over any time.
- **The page** lists all Claude sessions running in WorkDesks (those the orchestrator started are marked *orchestrator*) and a **History** of what it started. A click shows that session right there, in a tab next to *Orchestrator* (its own terminal in the WorkDesk is not disturbed, and the orchestrator keeps running); *Open in WorkDesk* goes to it, × goes back.

---
title: "Work with Claude"
description: "Accounts, hooks, Signals, skills and the Orchestrator."
sidebar_position: 9
---

# Work with Claude

**Goal:** run Claude Code in several desks and always know which one wants you.

## 1. Install the hooks

*Settings → Claude*: register your Claude config folder (for example `~/.claude`) and press *Install hooks*. It adds four hook entries (`Notification`, `Stop`, `UserPromptSubmit`, `SessionStart`) that call `workdesk hook <event>`, and they exit silently when the app is not running. *Uninstall hooks* removes exactly those entries. Install them in the folder of every Claude Account you use.

## 2. Know which desk needs you

"Claude needs input" and "Claude finished" become **Signals**: a red number on the desk in the left panel. Opening a desk jumps to the tab of its oldest Signal; a Signal clears once its pane has been visible and focused for about two seconds. The Dashboard's **Claude sessions** panel lists every running session with its desk, Account, state (*waiting for you*, *finished*, *working*, *idle*) and last message.

## 3. Use several Accounts

*Settings → Claude → Accounts* lists as many logins as you like (*Work*, *Private*, …), each with its config folder, plan and usage limits. In a desk's settings, *Claude Account* picks the login its **new** terminals use. The usage of every Account is at the bottom of the left panel, and a notification names the Account when a limit turns red.

## 4. Resume after parking

Claude sessions started in a pane are restored with `claude --resume` after parking or restarting, in the folder they ran in. If Claude cannot resume, the pane becomes a shell that shows why.

## 5. Give Claude the desk

Every WorkDesk folder has a generated `CLAUDE.md` with its name, Stage, Todos and branches and the rules (worktree per branch, never delete branches, `.env` from the store). Your own text below the block is kept. Terminals have `$WORKDESK_CLI`, so Claude can run `desk`, `branch`, `todo` and `review` commands.

The `skills/` folder has ready-made skills on top of it (`desk-open`, `desk-close`, `desk-add-branch`, `desk-review`, `desk-todo`, `desk-status`, `desk-pr`, `desk-handoff`, `desk-scratch` and more). Install them from *Settings → Claude → Skills*.

## 6. The Orchestrator (experiment)

The **Orchestrator** page runs one Claude with a handbook of the app's commands. It sees every desk (Stage, Signals, whether it can be cleared, time worked, Claude states). It may park a desk nobody works in, and suggests clearing finished ones.

## Related

[Claude](/features/claude) · [Signals and resources](/features/signals-and-resources)

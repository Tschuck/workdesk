---
name: desk-status
description: Report where this WorkDesk stands: branches, changes, pushes, pull requests, Todos, what to do next. Use for "where was I", "status", "catch me up".
---

1. `node "$WORKDESK_CLI" desk current` for the stage, branches and Todos.
2. For each branch folder: `git status -sb`, `git log --oneline -5`, and the ahead/behind against its upstream.
3. If `gh` is available: `gh pr view --json number,state,reviewDecision,statusCheckRollup` per branch.
4. Answer in a few lines: what is done, what is open (uncommitted, unpushed, failing checks, unresolved Todos, review comments from `node "$WORKDESK_CLI" review state`), and the single next step.

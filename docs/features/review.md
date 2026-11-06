---
title: "Review mode and git"
description: "Diffs, line comments, staging, commits and type checks."
sidebar_position: 10
---

# Review mode and git

Review mode shows what changed in a WorkDesk's branches and keeps line comments you can hand to Claude.

## Open it

The review button among the new-tab buttons (or *Open Review* in ⌘P) adds a **Review** tab after the first tab. It is a tab like the others (drag it, `Ctrl+Tab` reaches it, × closes it). While it is on screen it replaces the tab content with a whole view, and another tab brings its content back while Review keeps its state. Whether it is open is remembered per WorkDesk.

## The view

- **Left:** the branch switcher, **Since base** (the files changed against a base branch, with comments) and **Working tree** (stage, commit, type problems).
- **Right:** the diff of the clicked file at full width, with its line comments. It is side by side; *Inline* makes it one column.
- **Progress:** *Previous* / *Next* step through the changed files. Each file has a *reviewed* tick, counted as `n/N reviewed`. *Reviewed ✓ & next* ticks the shown file and goes to the next one not ticked. Ticks are kept on this machine per WorkDesk, branch folder and base.
- **Open in editor** (in the diff) and *Open comments file* open the file in a File tab.

### Since base

Pick a base branch per branch folder (remembered per WorkDesk and folder), or, in the *Since* box under it, one of the newest commits of the branch (hash and title): the review then shows only what changed after that commit. The list shows the files changed since `git merge-base <base> HEAD` (A / M / D / R plus untracked, single-child folder chains collapsed). A click opens the diff of the merge-base version against the working tree.

### Diff editor

*Diff against HEAD* in the tree's right-click menu, the *Diff* button in the file bar, or a click on a file in Review mode opens Monaco's diff editor: HEAD on the left, the working tree on the right. The right side can be edited in place: `⌘S` saves, a ● in the title shows unsaved changes, and closing the diff or showing another file asks first.

## Line comments

Click the gutter in the diff (right side) or in the editor (the 💬 button in the file bar; on by itself for a file that has comments) to add a comment under that line. You can edit and delete it. Files with comments show `💬 n` in the tree and the review list.

Comments live where the *Local Review* VS Code extension keeps them: `.review/comments.json` at the root of the branch folder. `/.review/` is added to the repository's `info/exclude`. Both tools show the same comments, and Claude can read the JSON (`workdesk review state`, and `workdesk review note <text>` adds a comment on the review as a whole).

The **Comments** tab lists all of them (open one in the diff, edit, delete, *Clear all*) and has *Copy as markdown* (one `## [ ] path:line` heading per comment, after a `Base \`branch\`` line). Only the branches in the branch scope are listed.

Right-click a line in the editor or the diff → *Copy Relative Path* copies `path:line` of that line (*Copy Path* is the full path).

## Working tree

Per branch: the staged and unstaged files (`+` / `−` per file, *Stage all* / *Unstage all*), a commit message box and *Commit* (`⌘Enter`). A commit runs `git commit -m` with **your** git configuration, so signing and hooks work as in a terminal. If signing fails (a locked gpg-agent), git's own error is shown and nothing is committed. There is no push, amend or force operation.

## Type problems

*Check types* under *Working tree* runs the project's own `tsc --noEmit` (its `tsconfig.json` and installed TypeScript) and shows a red count on the files, folders and the branch's row, plus a list to click through. It runs on request only. ESLint is not run, since it needs the project's configuration and plugins.

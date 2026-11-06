---
title: "From approval to merge"
description: "Knowing when a pull request is ready, and combining WorkDesks."
sidebar_position: 6
---

# From approval to merge

**Goal:** see at a glance that something can be merged, without opening the desk.

## When a pull request is ready

A pull request of a WorkDesk shows where it stands, in order of what blocks it most: draft, changes requested, merge conflicts, checks failed, checks running, behind its base, needs a review, and finally **ready to merge**. The chips appear:

- on the desk's *Work items* (with `✓ n approved`), also while the desk is **parked**,
- on the *Details* tab and in the pull request's detail pane,
- as a **Ready to merge** card on the Dashboard.

A pull request you approved sends a macOS notification when its checks finish, so you can approve now and merge when CI is done. State is refreshed every two minutes; merged and closed pull requests are not asked about again. **Merging itself stays on GitHub**: *Open pull request* opens it in the desk's browser.

## When everything is merged

A WorkDesk whose pull requests are all merged or closed and whose Todos are resolved moves to **Can be cleared** (also on the Dashboard). Right-click → *Clear this WorkDesk…*.

## Combining WorkDesks

If two desks turned out to be one piece of work: right-click one → *Combine with another WorkDesk…*, tick the desks to take in. Their branch folders (with uncommitted work and review comments), pull requests, Todos, pages, notes and time move over; the others are cleared. Their terminals are closed and their tabs and Claude sessions are archived.

## Stacks

A branch added on top of another makes a **stack**: its pull request targets the previous branch. When a base moves, a bar names the branches that are behind it; rebasing and force-pushing them is left to you.

## Related

[Work items and sources](/features/work-items) · [Branches](/features/branches)

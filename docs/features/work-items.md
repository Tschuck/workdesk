---
title: "Work items and sources"
description: "Pull requests, tickets and Todos in one list, and GitHub and Notion as sources."
sidebar_position: 3
---

# Work items and sources

A **work item** is anything you could work on: a Todo, a pull request or a ticket. The Dashboard's *Start working* list mixes them, with an icon per kind.

| Icon | Kind | Which |
|---|---|---|
| ☐ | Todo | your own Todos that are in no WorkDesk |
| PR | Pull request | ones you are asked to review, and **your own that need work** (changes requested, checks failed, merge conflicts; the row says which). One whose branch a WorkDesk has checked out is not listed. |
| T | Ticket | tickets assigned to you in Notion |

Click a row for its details on the right:

- **Todo:** its notes.
- **Pull request:** status, reviews and checks, an **Open pull request** link and, in tabs, its branch (commits, comparison with the default branch) when the repository is one of your Projects, and your notes. *Start review* and *Add to WorkDesk…* (put it into a WorkDesk that exists) are here, not in the list.
- **Ticket:** an **Open ticket** link, status, assignee, text and your notes. *Start WorkDesk* and *Add to today* are here.

Links open in the Browser page. Search filters the list.

## Start work

- **Add to today** makes one *planned* WorkDesk per selected item: dimmed, nothing running or checked out. Planning asks GitHub nothing, so it is instant. **Start** opens it.
- **Start together…** makes one WorkDesk from everything selected.
- A WorkDesk's **Details** page lists its own Todos, pull requests and tickets with the same detail pane. When all are done (Todos resolved, pull requests merged or closed, tickets in a done status, no open pull request on its branches), it moves to *Can be cleared* and offers to clear it. Nothing is cleared by itself.

## GitHub

- **Pull Requests tab:** the open pull requests of your registered Projects' repositories (plus any you add by hand), grouped by project, with your review state (requested, re-review, approved, …). Each row shows whether a WorkDesk has it (*not started*, or the WorkDesk with its Stage). Filter by text, status and review state, hide dependency updates and drafts, skip what you do not care about. **Start review** opens the start dialog, **→ Today** makes a planned WorkDesk.
- **Connect** with `gh auth login` or a token under *Settings → GitHub*. See [Services](./services.md).

## Notion

The **Notion tab** shows the sprint board, connected with your own Notion integration (OAuth).

- It shows the open tickets of the active sprint that are yours or unassigned, grouped by status.
- Further tabs list tickets before the sprint, whoever they belong to: *Ready for refinement* and *Refined* are one status each (configurable in the board mapping), and *Backlog* is every ticket in no sprint and in none of those statuses or the closed ones. Tickets of other people and closed ones can be shown grayed out.
- You can **claim** an unassigned ticket.
- **The Notion ticket of a pull request:** when a WorkDesk with a pull request is started or opened and Notion is connected, WorkDesk asks Notion for its ticket and attaches it as a page. It follows what Notion links first (the tasks database's GitHub relation points to the pull request's page), and otherwise looks up the ticket key in the branch and title (`ACME-1205`) by the tasks database's auto-number. Nothing is shown when Notion is not connected or has no ticket. Asked once per pull request and start of the app.

## From approval to merge

A pull request of a WorkDesk shows where it stands, in the order of what blocks it most: draft, changes requested, merge conflicts, checks failed, checks running, behind its base, needs a review, and finally **ready to merge**. Chips show **your** approval and the number of approvals (`✓ 2 approved`).

- **Where you see it:** on the WorkDesk's Details and in the Work items list (also while it is parked), in the pull request's detail pane, and as a **Ready to merge** card on the Dashboard.
- **Notification:** when a pull request you approved finishes its checks, a macOS notification names it (a click opens it), so you can approve now and merge when CI is done.
- **Refresh:** every two minutes; merged and closed pull requests are not asked about again.
- **Merging itself stays on GitHub.**

## Reviews on your own pull requests

The pull requests that are yours are watched, also while the WorkDesk is parked or postponed. When somebody approves one, asks for changes or comments, the WorkDesk gets a Signal (*Review received*, *New review comments*) with a notification, and a postponed WorkDesk comes back. What was seen is kept with the work item, so you are told once, also across restarts. Comments of bots are not counted.

The Stage follows them too (unless you set it by hand, or the WorkDesk reviews pull requests): changes requested on any of them is *Implement*; a draft is *Implement* until you mark it ready; open with nobody asking for changes is *Waiting*.

## Pull requests you review

The author rarely clicks re-request. When every comment thread of yours is resolved or answered since your review (and a reply or new commits came), it counts as *Re-review* anyway. When your review is submitted and the WorkDesk turns to *Reviewed, waiting*, the Signals Claude raised before (finished, needs input) are cleared, so it moves to *Waiting* instead of staying in *Working* with a red number. A waiting WorkDesk that still runs shows a hint with a Park button.

## When a WorkDesk can be cleared

A WorkDesk whose pull requests (work items and reviewed ones) are all merged or closed and whose Todos are resolved is listed in *Can be cleared*, also on the Dashboard, running or parked. A pull request whose state is not known yet keeps a WorkDesk out. Right-click → *Clear this WorkDesk…*.

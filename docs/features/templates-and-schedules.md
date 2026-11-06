---
title: "Templates and repeating WorkDesks"
description: "Start recurring work from a template, by hand or on a schedule."
sidebar_position: 12
---

# Templates and repeating WorkDesks

## Templates

A template is a WorkDesk without the work: a Stage, a checklist and a first set of tabs and panes.

- **Built in:** ⌘P → *New WorkDesk from template: Review PR / Release / Bug triage*. Each has a preset checklist, a Stage and panes (terminal, browser, and for triage a file pane) in its first tab. They are defined in `src/main/domain/templates.ts`.
- **Your own:** right-click a WorkDesk → *Save as template…*. It keeps the Stage, the Todos that are still open (checklist order) and all tabs with their panes, including the pages and files they show (a checkbox keeps only the kinds of panes). A WorkDesk made from it gets those tabs instead of the default one.
- **Manage them** in *Settings → Templates*: the built-in ones can only be duplicated; yours can be renamed, changed (Stage, Todos one per line), reordered, duplicated or deleted (asks first). They are stored as `templates.json` in the Status Repo.

Deleting a template pauses the repeating WorkDesks that use it and says why. Choose another template for them and resume.

## Repeating WorkDesks

*Settings → Repeating WorkDesks* (or *Repeat a WorkDesk template…* in ⌘P) holds schedules: a template, a name, and every day / weekday / week at a time of day.

- A schedule is not a copy. When its time has come and no WorkDesk from it is open (planned, running or parked; a cleared one counts as gone), the 30-second check plans a new WorkDesk from the template in *Planned*, with nothing started, and shows a notification whose click opens it.
- Runs missed while the app was closed make one WorkDesk, not several, and the next run is the next occurrence.
- Schedules can be paused or deleted; the WorkDesks they made stay. They are stored as `schedules.json` in the Status Repo, so they are backed up with the rest.

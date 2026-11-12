# WorkDesk

A macOS desktop tool that gives every piece of work (one review, one feature) its own temporary place with its own terminals, browser pages, editor and Claude Code sessions, and tells you which one needs you next.

## Language

**WorkDesk**:
A temporary place of work for one work item or a batch of them, planned for today or started right away, and thrown away when they are finished. Has its own folder with the branches of the projects it touches and a notes folder, its own Tabs and Claude Code Sessions, and can be activated and deactivated.
_Avoid_: workspace, desk, session, task

A WorkDesk is one piece of work (one review, one feature, several related pull requests) and holds the one or more Todos of it, picked by hand (a Topic is only a filter for picking); a Todo is in at most one WorkDesk. Every WorkDesk is the same kind of thing: there is no type. What it is about is in what it holds: Todos, **work items** (pull requests and tickets), branch folders, pages. Todos can be added to or moved out of an open WorkDesk, and one WorkDesk can be **combined** with another (its branch folders, pull requests, Todos, pages and note go into the first, which is cleared). It is cleared only by an explicit button press followed by an approval dialog, never automatically (not even when its last Todo is resolved); resolving a Todo, early or last, leaves the branches in place.

**Reviewed pull request**:
A pull request of a WorkDesk that is somebody else's: you review it there. It is tracked on GitHub (reviewed by you, asked again, merged), and its checkout is a branch folder of the WorkDesk marked with the pull request. A WorkDesk can review any number of them; one of your own pull requests is only a work item.
_Avoid_: review desk, Review WorkDesk

**Stage**:
Where a WorkDesk's work stands, one of one set for every WorkDesk: _Implement_, _Testing_, _In review_, _Waiting_, _To review_, _Re-review_, _Reviewed, waiting_, _Done_. A WorkDesk with reviewed pull requests has its Stage worked out from all of them (the one that needs you most wins: re-review, then to review; all reviewed is _Reviewed, waiting_; all merged or closed is _Done_); otherwise it is set by hand. A hand-set Stage can always override. A WorkDesk is **waiting** when its Stage is a waiting one and nothing needs you.
_Avoid_: status, state, doing

**Account** (Claude Account):
One Claude login WorkDesk knows: a name and an optional config folder (`CLAUDE_CONFIG_DIR`; none = the default login of Claude Code). There can be any number; one is the default. A WorkDesk may choose one: its new terminals start with that Account's folder, so `claude` in them runs under it; without a choice it uses the default. Each Account has its own login state and its own usage (5-hour session and week), read by a hidden Claude session that exists only for the reading. Logic in `src/main/domain/claude-accounts.ts` and `usage-schedule.ts`.
_Avoid_: profile, user, login (as the noun for this)

**Claude overview**:
The Dashboard list of every Claude session that runs in a terminal of a WorkDesk in use, with its Account, state (waiting for you, finished, working, idle) and last activity; a click goes to its Tab. Logic in `src/main/domain/claude-overview.ts`.

**Signal**:
A single timestamped event in a WorkDesk that needs the user: Claude needs input, Claude finished, re-review requested, new review comments, CI finished, tests finished. Stays until acknowledged: opening the WorkDesk jumps to the Tab of its oldest open Signal, and a Signal tied to a Pane clears once that Pane has been visible and focused for about two seconds (others clear on opening the WorkDesk). It can also be marked read by hand, and clears itself when it no longer applies (e.g. Claude was answered elsewhere). Independent of the Stage.
_Avoid_: notification, alert, status

**WorkDesk order**:
The order of the sidebar: sections by what a WorkDesk is doing — **Working** (in use), **Waiting** (a waiting Stage and no open Signal), **Pull requests** (WorkDesks with pull requests of colleagues to review and none of your own, running or waiting alike), **Planned** and **Postponed** — and inside a section the user's manual priority order. Parked WorkDesks stay in the section they belong to. A running WorkDesk keeps its place whatever its Signals; a parked one with an open Signal goes on top of its section. A Signal brings a waiting or postponed WorkDesk back into **Working**.
_Avoid_: ranking, sorting

**WorkDesk presence**:
Whether a WorkDesk is on screen: **active** (shown; exactly one WorkDesk at a time), **inactive** (hidden but still running, so it can raise Signals), **parked** (explicitly shut down to free resources, restored on reactivation; a flag on the row, not a section) or **planned** (chosen for today but not started: nothing runs and nothing is checked out, it only shows its work items and what they are about; opening it starts it). Reactivating all parked WorkDesks never starts planned ones.
_Avoid_: state, mode, suspended

**Postponed**:
A WorkDesk put out of the way until a time the user picks (1, 2, 4 or 6 hours, or tomorrow 06:00): listed in its own **Postponed** section (with when it is back under its name), and back in its section by itself when the time has come, or at once on a new Signal. Independent of presence (a postponed WorkDesk can run or be parked) and of the Stage, which it keeps.
_Avoid_: snoozed, hidden

**Work item**:
One thing to work on, of one of three kinds: a **Todo** (free-form, written by the user, tracked in no other system), a **Pull request** (from GitHub, later maybe GitLab) or a **Ticket** (from Notion, later maybe Jira). Pull requests and tickets stay what they are and are never turned into Todos. A Pull request is either one to review or one of the user's own that needs work (changes requested, failing checks, conflicts). A git branch is not a work item: it is where the work happens, held by a WorkDesk as its Branch.
_Avoid_: task, issue, entry

**Today**:
The set of WorkDesks in the sidebar: planned ones and started ones. Adding a work item to today creates a planned WorkDesk for it, so there is no Today list and no Backlog. The user's own open Todos that no WorkDesk has are simply the **Todos**; Pull requests and tickets are never Todos, they are offered by the dashboard while they apply.
_Avoid_: Daily, queue, Backlog

**Page reference**:
A web page (pull request, ticket, CI run, any page) attached to a WorkDesk or to one of its Todos from a browser Pane's address bar, with the title and icon it had. Listed as **Pages** on the WorkDesk's Details page and on the Todo; a click opens it as a Browser Tab of the WorkDesk. Kept with the WorkDesk or Todo in the Status Repo. Not a work item and not a favorite. Also offered in a new tab's *This WorkDesk* list and in the command palette.
_Avoid_: bookmark (that is a favorite, global), link

**Desk checklist**:
The Todos of one WorkDesk in the order of its `todoIds`, shown at the top of its Details page; a Todo can be captured into it with a global shortcut. Not a new kind of item: it is just the WorkDesk's Todos.
_Avoid_: subtasks

**Reminder**:
A Todo's due time (and its snooze time) at which a **Signal** of type "Todo due" is raised in the Todo's WorkDesk (a Todo in no WorkDesk gets a system notification). Fires once per due or snooze time; snoozing moves the reminder, not the due time.
_Avoid_: alarm, notification (for the Signal)

**Desk template**:
A preset for a WorkDesk: a checklist of Todos, a Stage and the Panes of its first Tab (Review PR, Release, Bug triage).
_Avoid_: blueprint, preset (for the thing itself)

**User template**:
A Desk template the user saved from a WorkDesk (Stage, open Todos, Tabs with Panes) or duplicated from another; editable, in `templates.json` of the Status Repo. The three built-in templates are code and only duplicable.
_Avoid_: preset, blueprint

**Schedule** (repeating WorkDesk):
A rule {template, name, repeat, time of day, next run} that plans a WorkDesk from a template when it is due and none made by it is open. Not a copy of a WorkDesk. Missed runs make one WorkDesk. Kept in the Status Repo.
_Avoid_: recurring desk, cron

**Repeating Todo**:
A Todo with a due time and a repeat (daily, weekdays, weekly). Resolving it starts the next one, in the same WorkDesk; the resolved one stays as the record.
_Avoid_: recurring desk, schedule

**What next?**:
A panel on the Dashboard across all WorkDesks of what waits for the user: open Signals, open Todos (of WorkDesks and Today) and Postponed WorkDesks. Computed, nothing is stored.
_Avoid_: inbox, queue

**Desk note**:
A Markdown scratch note of a WorkDesk, kept as `notes/desk-<desk>.md` in the Status Repo.
_Avoid_: scratch file (that is a File in the WorkDesk's folder)

**Provider**:
An adapter behind `src/main/sources/provider.ts` that offers change requests (pull / merge requests, CI, review state) and/or tickets of one system (GitHub, GitLab, Jira). It returns the app's own shapes (`PrItem`, `PrTodoState`, `Candidate`). Chosen per repository from the git remote host, overridable per host or repository (`providers` config of the Status Repo); credentials in the Keychain. Providers not confirmed against a real account are marked *untested*.
_Avoid_: integration, plugin, connector

**Profile**:
One product or client the user works on: a name and colour, the Status Repo it writes to, its credentials (GitHub, Notion, GitLab, Jira in the Keychain, named by Profile), its default Claude Account and its Projects. Todos, WorkDesks, repeating WorkDesks and Projects carry a Profile tag (`profileId`); **no tag means Profile #1**, the undeletable *Default* Profile, so data from before Profiles loads unchanged. The **Profile in view** (or *All profiles*, offered with more than one) only filters what the sidebar, Dashboard, Work items, palette and searches show, and decides which Profile new things are made for; everything of every Profile stays loaded and keeps running (reminders, schedules, Signals, PR watch, time tracking). Configured in `profiles.json` of the app's user data (it names folders of this machine).
_Avoid_: workspace, account (that is a Claude Account), tenant

**Status Repo**:
A git repository named `workdesk-status` inside the WorkDesk root folder, holding the Todos, the notes of open and cleared WorkDesks, and free-form knowledge, so that the backlog and learnings can be pushed to a remote and never lost.
Several can be registered; each Profile names the one its new things go to, and a thing stays in the repo it was loaded from. The first one, `workdesk-status` in the WorkDesk root, also holds what all Profiles share (repeating WorkDesks, templates, Projects, favorites).
_Avoid_: data folder, vault

**Source**:
A system the tool reads work items from, e.g. GitHub Pull Requests or a Notion database. Each offers **Candidates**: Pull requests or tickets that are not in a WorkDesk yet, which the user plans for today, starts a WorkDesk from, or skips. Skipped ones stay hidden.
_Avoid_: integration, feed, provider

**Project**:
A git repository registered with the tool, from which a WorkDesk can check out a branch.
_Avoid_: repo, source

**Tab** (of a WorkDesk):
One named working surface inside a WorkDesk: a layout of one or more **Panes**, split vertically and horizontally, each holding a **Terminal**, a **Browser** or a **File** (kinds can be mixed within one Tab). A Tab can be **pinned**: it then comes right after the Details Tab, shows only its icon, cannot be closed until it is unpinned, and is listed under its WorkDesk in the left panel.
_Avoid_: window

**Scratch file**:
A File that is not part of any Branch: temporary text kept in the WorkDesk's own folder until the WorkDesk is cleared.
_Avoid_: draft, note, temp file

**Files page**:
The page of the left panel with Tabs of Files that belong to no WorkDesk: the Status Repo's knowledge and notes, and a scratch pad that is kept.
_Avoid_: global editor, notebook

**Editor**:
The WorkDesk's one native VS Code window, opened on a multi-root workspace with a folder per Branch. It is a window of its own, not a Tab or a Pane; a button opens and raises it.
_Avoid_: File, VS Code tab

**File**:
A kind of Pane that shows one file, from a Branch's folder or a scratch file, in a light editor, to look at something or change it quickly without opening the Editor.
_Avoid_: editor, note, viewer

**Symbol search** (Find usages, Rename symbol):
A text-based look at a name in a File pane: every whole-word match (case matters, `_` and `$` belong to a word, any script) in the files of the branch scope, found by `git grep` and cut exactly in `src/main/domain/symbols.ts`. It knows nothing about the language: two things of the same name are one symbol. *Find usages* lists the matches like the search, declarations (`definitionPattern`) first. *Rename* shows every match with a checkbox, by default without the ones in comments and strings (a guess that reads `//`, `#`, `--`, block comments and quotes the same way for every language) and writes only the ticked ones; files with unsaved changes are skipped, and it only touches the Branch folders of the scope.
_Avoid_: references, refactoring (those need a language server)

**Review** (of a Branch):
The Branch compared with a **base branch** the user picks (the diff since their merge base), with **review comments** on lines. Part of the File pane, next to its git changes (staged / unstaged files, commit). Comments are kept in `.review/comments.json` and `.review/comments.md` at the Branch folder's root, in the format of the user's *Local Review* VS Code extension, so both tools share them. Nothing is pushed.
_Avoid_: PR review (that is a Pull Request on GitHub), annotation

**Review preset**:
A named filter of which changed files a Review shows: path patterns to include and exclude. "Whole review" and "Without tests" come with the app; others are made for one WorkDesk (by the `desk-review-preset` skill from what the user wants to look at) and kept on this machine. It only narrows the list; the diff and the comments are untouched.
_Avoid_: filter, view

**Branch** (of a WorkDesk):
A git branch checked out in its own worktree inside the WorkDesk's folder, so nothing is ever switched. A WorkDesk may have several Branches per Project, each with its own Terminals, Claude Code Sessions and Pull Request. A Branch based on another Branch of the same WorkDesk forms a **Stack**: an ordered chain from base to tip, whose Pull Requests each target the previous Branch. Shown in the sidebar as a tree: WorkDesk, Project, Branches indented by their base.
_Avoid_: checkout, worktree (that is its folder), stack (for a single Branch)

**Time spent**:
Seconds per WorkDesk per day, counted passively: only for the WorkDesk on screen, while the user is not idle (5 minutes), also when another window (a terminal, Slack) is in front. Kept locally in the app's user data, not in the Status Repo. Not a Todo estimate or a timer; there is nothing to start or stop.
_Avoid_: timer, time sheet, worklog

**Workspace search**:
Looking for a file name, text (grep) or terminal output across all started WorkDesks at once; a hit belongs to a WorkDesk and opens there. Parked and planned WorkDesks are left out (nothing runs, nothing is checked out).
_Avoid_: global search

**Pane**:
One cell of a Tab's layout, holding a single Terminal, Browser or File. An unsplit Tab is one Pane. A Terminal in a Pane of the focused Tab counts as visible. A Terminal belongs to the Branch whose folder it is in **now** (it follows `cd`), which decides the Branch group of its Tab unless the Tab was placed under a Branch by hand.
_Avoid_: split, window


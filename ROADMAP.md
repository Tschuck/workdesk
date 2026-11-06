# Roadmap

Where WorkDesk is going: a task/todo-driven workspace handler with an editor and browser support.
Each item is meant to be a small, separately shippable change (tests for domain logic, README/CONTEXT updated).

## -1. Performance first (now)
Decision: stay on Electron (a Tauri switch would save ~150 MB, not worth it); polish the current architecture.
- [x] Measure first: startup time, memory per process (main, renderer, each browser pane), typing latency in Monaco, with 1, 5 and 15 desks open (`node scripts/perf-measure.mjs`; before: ~930 / 1600 / 2530 MB for the app with every desk visited, a blank page ~75 MB each, typing ~9 ms at any desk count, startup ~0.6 s)
- [x] Auto-hibernate: discard the webContents of hidden browser panes after a while (same as the Hibernate menu entry: it wakes only with the Wake up button; URL and scroll are restored), with a setting for the delay and an exclude list (Settings → Browser → General)
- [x] Hibernate the Monaco models, Shiki tokenisation and file watchers of desks that are not visible: skipped, the measurement shows no gain (typing latency does not grow with the number of desks, the renderer heap grows ~6 MB per desk, there are no file watchers, Shiki is shared); never-shown tabs are not built at all instead (next item)
- [x] Create panes lazily (nothing is built until its tab is first shown; tabs with a terminal are built at once so what runs in them keeps running)
- [x] Hibernated tabs shown dimmed in the tab list, with a memory figure per tab as a tooltip (per desk: the Performance page)
- [ ] Keep the heavy work (indexing, git status, grep) off the UI thread; add a sidecar only if the profile shows the need
- [x] A small performance check (script or test) so regressions in startup and memory are noticed (`pnpm perf` runs the built app against `scripts/perf-budget.json`; domain logic is unit-tested)

## 0. Verify what exists
- [ ] Walk through the UI built so far in the running app (sections, postpone, branch scope, grouping, themes, panes button, tab alias) and fix what is off
- [x] Postponed sidebar section starts folded (`OPEN_PANELS.postponed`)

## 1. Todos in a desk (the core of the "task-driven" idea)
- [x] Todo checklist in the desk header: add, tick, reorder, delete (uses `todoIds` / todo store)
- [x] Global shortcut to capture a todo for the current desk
- [x] "What next?" view: open todos, open Signals and due postponements across all desks
- [x] Due dates and reminders: a reminder raises a Signal at its time; snooze
- [x] Notes per desk: a Markdown scratch note that opens with the desk
- [x] Desk templates (Review PR, Release, Bug triage): preset panes, todos and stage (started from the command palette)
- [x] Recurring todos (daily, weekdays, weekly)
- [x] User-managed templates: save a WorkDesk as a template (Stage, open Todos, Tabs and Panes), Settings → Templates to edit, reorder, duplicate, delete
- [x] Recurring desks

## 2. Workspace-wide navigation
- [x] Global command palette (⌘P, not a second one): switch desk, run actions (park, postpone, group by branch), open any file of any desk
- [x] Cross-desk search: files, text and terminal output in any desk (*Search all WorkDesks…*)
- [x] Terminals follow `cd` (tmux `pane_current_path`), so they move between branch groups
- [x] Passive time tracking per desk per day (local, shown on Details and the Dashboard)

## 3. Editor
- [x] Git in the file pane: changed-file markers in the tree, diff view, stage and commit (no push, no force; commits use the user's git config, signing errors are shown)
- [x] Review mode in the file pane: base branch per Branch folder, files changed since the merge base, diff, line comments shared with the Local Review extension (`.review/comments.json` / `.md`)
- [~] Diagnostics: TypeScript problems on request (`tsc --noEmit`) with counts on files, folders and the Branch in the tree; ESLint and counts in the tabs skipped
- [x] Find usages and rename symbol (next to go to definition), text based: whole-word matches in the files of the branch scope (git grep), definitions first; rename with a preview and a tick per match, comments and strings skipped on a best-effort guess. No language server, so it cannot tell two things of the same name apart
- [ ] Maybe later: an opt-in TypeScript language service per desk, started on demand and stopped when idle, for real references and rename in TypeScript projects
- [x] Back / forward through cursor positions across files (Ctrl+- / Ctrl+Shift+-)
- [x] Restore editor state across restarts: cursor, scroll, unsaved buffers

## 4. Browser
- [x] Attach pages (PR, ticket, CI) to a desk or todo as references
- [x] Page title and favicon in the tab (tab and list existed; the list of panes under a tab now shows the icon too)
- [x] Copy URL as a Markdown link

## 5. Integrations for a wider audience (preparation, not deep testing)
Goal: open the app to people who use other tools than GitHub. The author does not use Jira etc., so these are
adapters that are built against the documented APIs, covered by unit tests with recorded fixtures, and marked
"untested against a real account" in the UI/README until someone confirms them.
- [~] Define one provider interface (tickets, pull/merge requests, CI checks, review state) and move the GitHub code behind it: interface and a GitHub adapter that delegates to GithubApi are done; the GitHub-only services (PrsService, SourcesService, DeskPrsService, PR watch) are not yet rewired to ask the registry
- [x] Provider registry and a per-repo / per-host provider setting (detected from the git remote host, overridable); a per-desk setting is not done
- [x] GitLab adapter: merge requests, pipelines, approvals (untested against a real account)
- [~] Jira adapter: ticket status, transitions, assigned tickets, key from a branch name (untested against a real account); attaching a ticket to a desk in the UI is not done
- [ ] Other candidates once the interface holds: Linear, Bitbucket, Azure DevOps: not done (host detection only; their review and merge states need their own mapping)
- [x] Credentials storage per provider (OS keychain) and a settings page (GitLab, Jira, Git hosts; test connection)
- [x] Contract tests every adapter has to pass, run against fixtures
- [x] A short "write an adapter" guide (docs/write-an-adapter.md)

## 6. Claude
- [x] Several Claude Accounts (name, config folder, login, usage each), a default Account, the Account of a WorkDesk for its new terminals (`CLAUDE_CONFIG_DIR`), usage of all in the sidebar, notifications naming the Account
- [x] The usage reader costs nothing between readings: hidden session only while reading, one at a time, every 5 minutes (setting), not while locked / asleep / unseen for 30 minutes
- [x] Claude overview on the Dashboard: running sessions of all WorkDesks in use with Account, state, last message and age; click jumps to the Tab
- [ ] The Account per Tab (only per WorkDesk so far); the last line of a session's terminal as the message; jump to the exact Pane (it opens the Tab)

## 6. Profiles (two products, N Profiles)
- [x] Profile domain: tags on Todos, WorkDesks, schedules and Projects, untagged = Profile #1, view filter, migration test
- [x] Credentials per Profile (Keychain keys named by Profile; the old single set copied into Default); source settings and skipped lists per Profile; background PR watch with each Profile's own login
- [x] A Status Repo per Profile (shared or separate), every registered repo loaded and live; point to a folder or clone a remote
- [x] Selector under the WORKDESK title, *All profiles*, Signal badge; Settings → Profiles
- [ ] The browser (history, favorites, sessions), the `.env` store and the Claude hook folders are still shared by all Profiles
- [ ] A marker of the Profile on each row in the sidebar while *All profiles* is shown
- [ ] Move existing Todos and WorkDesks between Profiles (and between Status Repos) by hand
- [ ] A per-Profile default provider; the pull request pages of a Profile other than the one in view (a PR detail is read with the login of the Profile in view)
- [ ] Sync of `profiles.json` (names and colours) between machines

## Suggested order
1. Section -1 (performance), then section 0, so the base is trusted
2. Todos in a desk + "What next?" view
3. Global command palette
4. Git status and diff in the file pane
5. The rest by need; integrations (section 5) when the interface is worth opening up

## After one kind of WorkDesk
- Own pull requests as part of the Stage: approved and waiting for the merge or the checks is waiting, changes requested needs you (today only the pull requests you review feed the Stage).
- A pull request's Notion ticket on its row in Start working, before the WorkDesk exists.
- Combine: undo, and combining a planned WorkDesk's items without its (missing) folders is covered, but a WorkDesk that runs a program in a moved folder only has it closed, not asked about.

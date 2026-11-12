# To test by hand

Everything below passed the type check, the unit tests and the build, but was **not looked at in the running app**.
Tick what works, note what does not. Newest work first.

## Sidebar
- [ ] First section is called **Working (N)** and N is the number of desks in it
- [ ] Sections Waiting / Planned / Postponed: counts, folding, a Signal brings a desk back into Working
- [ ] **Postponed starts folded** on a fresh settings file
- [ ] Postpone dialog (1, 2, 4, 6 hours, tomorrow 06:00, own number); "Bring back now"
- [ ] Only parked and planned desks are dimmed; waiting and postponed are not
- [ ] Rows under Planned still repeat "Planned" in their label (left as is; remove?)

## Browser
- [ ] **Settings → Browser → History**: list by day, search, click opens the page, × forgets it, count in the hint
- [ ] **Favorites: sort the groups by drag**: dropping on the upper line (above a group) and on the lower line both sort; the drop line is drawn inside the group, no jump in layout when the drag starts
- [ ] Favorites: right-click a group → Move up / Move down

## Desk tabs and panes
- [ ] Group tabs by branch (per WorkDesk, default off): manual placement ("List under <branch>"), sorting inside a group, no second heading after a manual move
- [ ] Group header: chevron on the right, a click on the row folds and sets the scope
- [ ] Panes button: panes under every tab / only the active one; a click on the active tab folds its panes
- [ ] Tab alias: double click to set, "Set tab alias…" in the context menu

## Branch scope
- [ ] Scope switcher in the file side, in the finder (⌘P / ⌘D / ⇧⌘F)
- [ ] Follow focus: switching the pane follows its branch; clicking in the file side does not jump back
- [ ] Reveal the open file in the tree; resizable file side
- [ ] Glob field in the file finder; text matches grouped by file

## Editor colours
- [ ] Code theme choice (Settings), imported VS Code themes; colours close to VS Code
- [ ] Font: "Match VS Code font"
- [ ] A warning when a file is past the size limit and Monaco's own tokenizer takes over
- [ ] No grammar-failed warning (CSP `wasm-unsafe-eval`)

## Todos in a desk (merged from feat/desk-todos)
- [ ] Checklist on the Details page: add, tick, drag to reorder, delete
- [ ] Desk note (Markdown) on the Details page
- [ ] Capture shortcut ⌥⌘T (registers? clashes?) and the capture dialog
- [ ] **What next?** panel on the Dashboard (replaces *Needs you*; Signals with Open / Mark read) and the count on the Dashboard entry; no separate sidebar button
- [ ] Due date and snooze; a `todo-due` Signal appears on the desk at the time; system notification without a desk
- [ ] Delete on a checklist row asks first (Delete / Keep)
- [ ] Work items panel no longer lists the desk's Todos (only PRs and tickets); clicking a checklist title opens the Todo's details
- [ ] Clearing a desk archives its note (`desk-note.md` in the archive folder)
- [ ] Clear WorkDesk → Confirm closes the dialog at once; the app stays usable and the WorkDesk shows a spinner and "Deleting…" in the left panel, cannot be opened (click, ⌘1…⌘9, right-click) and is gone when done; if the clear fails the error shows and the WorkDesk is back to normal
- [ ] Clear WorkDesk lists every Branch of the WorkDesk (after a fetch --prune: one that was deleted on GitHub says "not on the remote any more"); per Branch two unticked boxes: delete here (the clone), with a note when its commits are on no remote branch, and, only while it is still on the remote, delete on the remote (origin), which delete here needs ticked first (unticking the remote one unticks it); ticked ones are deleted after the folders are removed, unticked ones stay
- [ ] Clear WorkDesk: while the remote is asked about the Branches a spinner shows and "Clear WorkDesk" is disabled (Cancel works); when the fetch fails (no SSH login) GitHub is asked through the login of the app whether each Branch is still there, and only when that fails too a hint says the remote could not be asked and may be out of date; ticking delete on the remote for a branch that is already gone is no error
- [ ] Clear a WorkDesk whose first clear stopped half way (its folder in `archive/<date>-<desk>` exists already): no ENOTEMPTY, the notes are merged into it, nothing is overwritten (a clashing file gets `-2`)
- [ ] Fetches and pushes to the remote run one at a time and a refused SSH login is tried again (3 times), so the Clear dialog no longer says the remote could not be asked at random
- [ ] ⌥⌘T listed in the Shortcuts panel; works with the window closed (reopens it); a reminder notification without a desk opens What next? on click
- [ ] Templates: palette "New WorkDesk from template: …" (Review PR, Release, Bug triage) gives stage, todos and panes (split looks right?)
- [ ] Repeating todos: ↻ in the due editor (daily, weekdays, weekly); ticking one starts the next at the same time of day; ticking late catches up; no duplicate on a second tick
- [ ] Palette entries "Go to What next?" and "Capture a Todo…"

## Repeating WorkDesks (branch feat/desk-todos)
- [ ] Settings → Repeating WorkDesks: add a schedule (template, name, repeat, time); it lists the next run; Pause/Resume and Delete work (deleting keeps the WorkDesks it made)
- [ ] Palette entry "Repeat a WorkDesk template…" opens that settings page
- [ ] With a schedule due (edit `nextAt` in `schedules.json` of the Status Repo into the past, restart): within ~30 s one planned WorkDesk appears in Planned, with its template's checklist and (after opening) panes; a notification shows, a click opens it
- [ ] While that WorkDesk is open (planned, running or parked) no second one is made; clear it and the next check plans a new one
- [ ] Quit for several runs, start again: only one WorkDesk, next run is in the future
- [ ] `schedules.json` appears in the Status Repo and is auto-committed

## User templates (branch feat/desk-todos)
- [ ] Right-click a desk → "Save as template…": dialog with name and the "only kinds of Panes" checkbox; Save adds it
- [ ] Settings → Templates lists the 3 built-ins (no edit/delete, Duplicate works) and yours
- [ ] Rename (leave the field), change Stage, edit Todos (one per line), reorder with the arrows, duplicate, delete (asks first)
- [ ] Palette "New WorkDesk from template: …" lists yours; a new WorkDesk gets the saved Stage, Todos and Tabs (pages open on the saved URLs, file panes on their paths; with the checkbox: empty panes of the same kinds)
- [ ] Repeating WorkDesks form lists yours; delete a template used by a schedule: the schedule shows "paused: Its template was deleted…", choose another template, Resume works
- [ ] `templates.json` appears in the Status Repo

## Performance (branch perf, not merged yet)
- [ ] Hidden browser panes hibernate after the delay exactly like the Hibernate menu entry (Wake up screen) and load again, on the same URL, only when Wake up is pressed
- [ ] Hibernated tabs are dimmed, tooltip shows memory
- [ ] Numbers from the measurement in the agent's report match what you see

## Settings navigation
- [ ] Groups (WorkDesk / Work / Browser) are separated by a line and a small caps name; entries are lighter, the active one has a filled row with a bar
- [ ] Less padding on the left of the Settings page; the navigation lines up with the "Settings" title

## Left panel look
- [ ] Dashboard / Work Items / Files / Browser text starts at the same left edge as the WORKDESK title; hover and active backgrounds still look right
- [ ] Section names (Working, Waiting, Planned, Postponed) a bit brighter; one line between the top entries (Dashboard … Browser) and the sections
- [ ] Active entry has a thin yellow bar on the left (like the Settings navigation, which is no longer rounded)
- [ ] Desk rows (⌘1…) line up with the title; the + Add / Park all buttons too

## Quit setting
- [ ] Settings → **Behavior** → When quitting (Ask / Keep terminals running / Stop terminals) matches the WorkDesk menu → When Quitting; changing one updates the other
- [ ] The quit question's checkbox text points to Settings → Behavior; ticking it changes the setting there
## Browser references (branch feat/browser-refs)
- [ ] Address bar of a browser pane in a WorkDesk has a "⋯" button: Copy URL as Markdown link, Attach to <WorkDesk>, Attach to a Todo…
- [ ] "Attach to <WorkDesk>" on a PR page: a "✓" and a note appear; Details page shows a Pages (1) panel with icon, title and host; attaching the same page again (also with a #fragment) adds no second row and the entry is disabled
- [ ] "Attach to a Todo…" lists the open Todos of the WorkDesk; after attaching, the Todo's details (in the desk and on the Todos page) show the page under Pages
- [ ] Click a page in Pages (Details): opens as a browser tab of the WorkDesk (or shows the tab that has it); × detaches it
- [ ] Todo opened from the Todos page whose WorkDesk runs: a click on its page switches to the WorkDesk and the tab is there; parked WorkDesk: opens in the Browser page instead
- [ ] Restart the app: references of the WorkDesk and the Todo are still there; `desk.json` / `todos.json` in the Status Repo hold `refs`
- [ ] about:blank and the new tab page: Copy and Attach entries are disabled
- [ ] On the Browser page (outside a WorkDesk) the menu only has Copy URL as Markdown link
- [ ] Pasted into a Markdown note the copied link renders as [title](url); a title with [brackets] and an address with ( ) still work
- [ ] ⌘P in a WorkDesk with a browser pane: "Copy URL as Markdown link", "Attach this page to <WorkDesk>", "Attach this page to a Todo…" show for the pane you used last; with two browser panes or WorkDesks they are not duplicated, and they are gone when no browser pane is on screen
- [ ] List of panes under a tab (tabs as a list, tab with 2+ panes): a browser pane shows its page icon (globe if none) and its title, the host when it has no title
## Workspace navigation (branch feat/navigation)
- [ ] ⌘P inside a running WorkDesk: "Park this WorkDesk", "Postpone this WorkDesk…" (opens the time dialog), and with two or more branches "Group the tabs by branch" (toggles the list; the entry text flips)
- [ ] ⌘P on a parked WorkDesk: "Reactivate this WorkDesk"; on a postponed one: "Bring this WorkDesk back from postponed"
- [ ] ⌘P, type `main.ts` (a file that exists in two WorkDesks): files of this WorkDesk first, then the other's with its WorkDesk name on the right; Enter switches there and opens the file in a File pane (with `main.ts:12` at that line)
- [ ] Same from the Dashboard (no WorkDesk on screen): files of all started WorkDesks are listed; parked ones are not
- [ ] ⌘P → "Search all WorkDesks…": Files mode finds a file by part of its name in any WorkDesk; Tab switches modes; Esc closes
- [ ] Text mode finds a string in another WorkDesk's branch folder; `.*` (regex) and `Aa` (case) change the result; Enter opens the file at the line in that WorkDesk
- [ ] Terminals mode: print `echo needle-123` in a terminal of another WorkDesk (also scroll it out of sight); the search finds it with the tab name; Enter goes to that WorkDesk and that tab
- [ ] Rows in the dialog have square corners with the yellow bar on the selected one; the active mode button too
- [ ] Terminals follow cd: WorkDesk with two branches, tabs grouped by branch; in a terminal of branch A run `cd ../<branch B folder>`: within ~3 s its tab moves to B's group (and `cd` back moves it back)
- [ ] A tab put under a branch by hand ("List under …") does not move when its terminal cds elsewhere; "List in its own branch again" lets it follow again
- [ ] A tab with two terminals in different branches stays under "other"; after both are in the same branch it moves there
- [ ] Time on pages and idle notice: open a pull request that a WorkDesk reviews on the *Browser* page (also `/files`): its WorkDesk's time grows, another page's does not; leave the app alone for 5 minutes with a WorkDesk on screen: one silent notification "Time tracking paused" with the WorkDesk's name, not a second one until you were back; with the window in the background or the Dashboard shown there is none
- [ ] Orchestrator page (below Time): opens a terminal with Claude that lists the WorkDesks; leave the page and come back: the same Claude is still there; pick another Claude Account, *Restart*: the new Claude runs under that account (check with `/status`); the left list shows the Claude sessions of the WorkDesks and a click opens the WorkDesk; ask it to start a worker in a WorkDesk: a new Terminal Tab with Claude appears there (the Tab you looked at stays), the session shows in the left list marked *orchestrator*, and the History lists it (a click opens the Tab); with a Claude that you started by hand and that waits for an answer: ask the orchestrator what it waits for (it reads the Pane), then tell it to answer *yes*: the text appears in that terminal and is sent
- [ ] Refresh button next to *Browser* (side panel and icon rail): the icon turns, hovering it lists the loading steps with their seconds (and "Nothing is loading" when idle), a new review comment or merged pull request shows without waiting five minutes
- [ ] Dashboard *Needs you*: a Signal (yellow), a ready-to-merge pull request (green), a desk that can be cleared (purple) and an overdue Todo (orange) each show as one coloured row under the numbers; a click opens the WorkDesk; *Mark read* removes a Signal; with nothing open it says so; *What next?* no longer repeats Signals or desks to clear
- [ ] Time in VS Code: open a WorkDesk's `.code-workspace` in VS Code, show another WorkDesk (or the Dashboard) in the app, work in VS Code for 2 minutes: the VS Code WorkDesk's time grows, the shown one's does not; switch back to the app and the shown one counts again
- [ ] Time spent: work ~2 minutes in a WorkDesk (any window in front); Details shows "Time today" (hover shows the rules) and the Dashboard shows "Time today" with that WorkDesk (after a minute)
- [ ] No time is added while on the Dashboard or another page, or after 5 minutes without input
- [ ] Quit and start again: the times are still there (`time-tracking.json` in the app's user data folder)

## Settings: Browser entries
- [ ] The Browser group of the Settings navigation lists General, Search engines, Favorites, History, Sessions, Security and Extensions; no tab strip inside the pages any more
- [ ] Every entry opens its page (Favorites page still uses the full width); the first group is called WorkDesk
- [ ] "Attach to a Todo…" opens a picker: Todos of this WorkDesk first, then loose Todos of Today, then other loose ones; typing filters, arrows + Enter attach, a Todo that has the page already shows a ✓ and cannot be picked
- [ ] Right-click on a page in a WorkDesk: Back/Forward (greyed when no history), Reload, Copy URL as Markdown link, Attach to <WorkDesk>, Attach to a Todo…, Inspect; outside a WorkDesk (Browser page) no Attach entries
- [ ] Right-click on a link: Open link in new tab (a tab of the WorkDesk / the Browser page), Copy link address; on selected text: Copy; in a text field: Cut/Paste
- [ ] Mouse back/forward buttons still work in a page; Chrome extension popups/windows still work; a right click on the address bar is unchanged
- [ ] The Attach entries of the page menu do the same as the "⋯" menu ("✓ Attached to ..." note appears on the "⋯" button)
- [ ] Attached pages appear in the empty new-tab page under "This WorkDesk" and as "Open page …" in ⌘P; picking one opens it as a tab


## History clean-up
- [ ] History page: "Clear day" (appears on hover at the day heading) forgets just that day; with a search typed it still clears the whole day (the confirm says so)
- [ ] "Clear all history" asks and empties the list and the count
- [ ] "Forget pages older than …": pick 7 days, older pages disappear at once and again after a restart; "never" keeps everything
## Editor: git, review, history, restore (branch feat/editor-git)
Unit tests cover the parsing, the git/review services against real temporary repos and the history/state logic; nothing below was looked at in the running app.
- [ ] File pane on a Branch folder: files changed in the working tree show `M` / `A` / `D` / `U` in the tree, the folders above get a dot, the Branch row shows the count; after ⌘S or a stage/commit the markers update; the Files page (no Branch) shows no Changes / Review tabs
- [ ] **Changes** tab: staged / unstaged lists, `+` / `−` per file (appear on hover), Stage all / Unstage all, a click opens the diff
- [ ] Commit: message + Commit (and ⌘Enter) makes a commit with your config; with the gpg-agent locked the git error is shown in red and nothing is committed; no push button anywhere
- [ ] Diff: tree right-click → "Diff against HEAD", the **Diff** button in the file bar, a click in Changes; HEAD left, working tree right; Inline toggle; the right side can be edited, ⌘S saves it (● in the title until then; Close diff or another file asks first); Open in editor goes to the editor at the cursor line; a new (untracked) file diffs against empty, a deleted file shows its old content on the left
- [ ] Right-click a line in a file or in the diff → Copy Relative Path pastes `path/to/file.ts:42` (the clicked line); Copy Path is the full path without a line
- [ ] **Review** tab: base preselected (origin/HEAD, else main/master); change the base, it is remembered per WorkDesk and Branch folder (restart); list shows A/M/D/R/U, collapsed folder chains, merge base hash; a click opens the merge-base diff; a renamed file diffs against its old name
- [ ] Sessions of one domain: in *Settings → Browser → Sessions* make two sessions (Private, Work) that both name `claude.ai`; open `https://claude.ai` (a new tab, a favorite, a link): a question "Which one should open it?" appears and nothing loads before you pick; the pick is used, the label next to the address says "Private" / "Work"; log in as a different account in each; restart the app: each tab opens in its own session without asking; click the label (▾) → a small list of the sessions of this domain, the current one ticked; one click on the other opens the page in it; a page in a session that does not name the domain (e.g. moved there by hand) lists itself ticked plus the sessions that do; the yellow "moved to another session" bar shows only when a link really sent the page elsewhere without a question; a domain in only one session never asks; "Continue with Google" on `claude.ai` in the *Private* session stays in *Private* (no yellow bar, the login continues and uses Private's own Google login), also with `*.google.com` in a third session; typing `github.com` in the address bar of that page still opens the GitHub session; the label shows the site name for a site's own session and *Shared* in the shared one
- [ ] Sign-in pop-up: *Continue with Google* on a site that uses Google's pop-up (claude.ai) opens a small window on `accounts.google.com`, not a navigation of the pane; choosing the account closes it and signs the page in (it no longer waits on `gsi/transform`); the pop-up uses the session of the page; an ordinary `target=_blank` link still opens in the same pane
- [ ] Delete a folder: right-click a folder of *scratch*, *notes* or *knowledge* → *Delete folder…* asks, then moves it with everything in it to the Trash; a file of it that is open closes; no such entry for a Branch folder or for a root
- [ ] Folders: right-click a root or folder of *scratch*, *notes* or *knowledge* → *New folder…* (name `payments` or `payments/specs`; Enter) makes it, it shows in the tree although it is empty and opens; a Branch folder has no such entry; a name with `..` or one that exists says so. Right-click a file of *scratch* or *notes* → *Move to knowledge…*: the dialog suggests the folders of knowledge, a typed new folder is made, the file is gone from where it was and open in the knowledge tree; the file is in the Status Repo's next auto-commit
- [ ] A PDF file (`.pdf`) opens in the file pane, drawn by pdf.js, instead of "This file is not text": pages scroll, text can be selected, links work, zoom −/+/fit, "page n / N"; ⌘F (or a click in the find box) searches the text: hits are highlighted, "n of m", Enter / ⇧Enter or ↑ ↓ go to the next / previous hit, Esc clears; a scanned PDF (no text) finds nothing; a PDF over 100 MB says it is too large
- [ ] Review presets: the "Preset" menu above the Previous / Next buttons has "Whole review" and "Without tests" (tests, specs, snapshots, `test/` folders drop out; "n of m changed files hidden" shows); the choice is remembered per WorkDesk; in a WorkDesk terminal `node "$WORKDESK_CLI" review preset add "API" --include 'src/api/**'` makes a preset that shows up in the menu within a moment, `review state --preset API` lists only its files, `review preset remove API` (or "delete" in the menu) removes it; the `desk-review-preset` skill makes one from a wish
- [ ] Comments: hover the gutter in the diff's right side or in the editor (💬 button) → "+" → type → Save (⌘Enter); edit, delete; `💬 n` shows in the tree and in the review list; the box has square corners and a yellow bar
- [ ] File pane: right-click a line in a file of a Branch folder → *Add Review Comment* opens the comment box on that line (also when comments were hidden; on a line with a comment it edits that one); not in the menu for files outside a Branch folder or while a diff is shown
- [ ] Interop: `.review/comments.json` appears at the Branch root (there is no comments.md any more), `.review/` is not in `git status` (listed in the repo's `info/exclude`); a comment made in the VS Code extension shows here and vice versa; Clear all asks first (Comments tab)
- [ ] Comment lines do not follow edits made in the editor before saving (known limit: they are anchored to the line numbers of the saved file)
- [ ] Branch scope: with several Branches in a WorkDesk, Changes and Review list only the scoped ones; each has its own base and comments
- [ ] **Check types** in Changes: red counts on files / folders / the Branch row, list of problems, a click opens the file at the line; a folder without tsconfig or without `node_modules/.bin/tsc` says so
- [ ] Ctrl+- / Ctrl+Shift+- (and ◀ ▶) go back / forward through cursor places across files and panes of the WorkDesk; no clash with ⌘- (zoom); a click on a search hit, a jump to a line, ⌘D/⌘P opens add a place
- [ ] Restart with a file open: cursor and scroll are back; with unsaved changes the text is back and the title has the dot; if the file changed on disk in between, the unsaved text is dropped
- [ ] Shortcuts panel lists the new "File panes" group

## Providers: GitLab, Jira, git hosts (branch feat/providers; untested against real accounts)
- [ ] Settings → Work lists *GitLab (untested)*, *Jira (untested)* and *Git hosts*; the first two show the yellow-bar "untested" notice
- [ ] GitLab: enter the address (empty = gitlab.com) and a token (scope read_api), Save, *Test connection* says "Connected as <your username>"; a wrong token says the token was refused; the token is not shown again (the placeholder says it is in the Keychain); *Remove token* removes it (Keychain Access: `workdesk-provider-gitlab-token`)
- [ ] GitLab self-hosted: the address of your instance works; merge requests, pipelines and approvals of a real project are read right (only the contract tests use them today, no page does yet)
- [ ] Jira: site URL, email, API token; *Test connection* says "Connected as <your name>"; Save without URL or email says what is missing
- [ ] Git hosts: paste `git@github.com:a/b.git` → GitHub from the host name; a `gitlab.…` remote → GitLab; an unknown host → unknown; force GitLab for the host or for one repository → the line changes ("set for the host" / "set for this repository"); *Automatic* takes the setting away; it survives a restart (`sources/providers/config.json` in the Status Repo has no token)
- [ ] The scope buttons have square corners and the active one a thin yellow bar on the left

## Find usages and Rename symbol, text based (branch feat/usages-rename)
Unit tests cover the matching (word borders, unicode, comments / strings guess, applying by line and column), the files service against a real temporary repo and the row/tick logic; the dialogs were not looked at in the running app.
- [ ] Links in a terminal (what Claude prints): hovering a `https://…` link underlines it and shows *⌘-click opens the link in a Tab, ⌥⌘-click copies it* above the terminal; ⌘-click opens it as a browser Tab of the WorkDesk (not in the system browser), ⌥⌘-click copies it (*Link copied*; paste it elsewhere). A link that is cut at the end of a row and goes on alone in the next row is one link (check with a narrow pane). Plain click and drag still select with tmux
- [ ] `⌥⇧F7` in a File pane with the cursor on a name opens *Find usages* with that name; with a name selected it uses the selection; with a selection of several words it opens empty. Right-click in the editor shows *Find Usages (text based)* and *Rename Symbol (text based)* with their keys; ⌘P → *Find usages of the name at the cursor…* / *Rename the symbol at the cursor…* work (from the file pane, and from a terminal beside it)
- [ ] `⌥⇧F7` / `⌥⇧F6` do not clash with anything on your keyboard (F-keys need `fn` unless "Use F1, F2 etc. as standard function keys" is on); the Shortcuts panel lists both under File panes
- [ ] Usages: whole words only (`foo` does not find `foobar`, `_foo`, `foo1`), case matters, a name with `$` or an umlaut works; results are grouped by file with a count, line numbers and the match marked; **Definitions** are first (a `class X` before an `X=1`), and not repeated below; ↑/↓ and Enter / click open the file at the line (in the same file: the cursor just moves, unsaved changes are not asked about)
- [ ] The scope switcher (several branches) and the globs field change what is found; notes and scratch files are found too in Usages; the "stopped at its limit" note shows on a very common name
- [ ] Rename: the new name field refuses `a-b`, `9x`, empty and the old name (button disabled, a note says why); Enter in the field applies
- [ ] Rename preview: every match has a checkbox, files have one with a half state and `ticked/total`; matches in comments and strings are unticked and tagged *comment/string* while *Skip matches inside strings and comments* is on; unticking that box ticks them, ticking it unticks them again; the button counts the ticked matches
- [ ] Rename applies only the ticked matches (try a `//` line, a `"foo"` string, a property of the same name): look at the diff (Changes tab) to confirm nothing else changed; counts in the report match; the files are not committed; a different new-name length does not shift later matches in the same line
- [ ] Open buffers: the file open in the pane you renamed from, and in another pane / tab, show the new text after Apply with the cursor kept and no dot (no unsaved state); undo in the pane does not bring the old name back
- [ ] A file with unsaved changes in some pane: the preview marks it *unsaved changes: skipped*, it is not written, and the report lists it; after saving it and searching again it is renamed
- [ ] Never outside the scope: with two branches and the scope on one, nothing in the other branch, in notes or in scratch changes; Rename shows only files of the Branch folders
- [ ] A file that changes on disk between the search and Apply (edit it in a terminal) is left alone for the places that changed ("left alone" in the report)
- [ ] The tags and the file / match rows have square corners; the selected usage row has the thin yellow bar on its left

## Claude Accounts, usage reader and Claude overview (branch feat/claude-accounts)
Unit tests cover the migration, the account editing rules, the schedule (lock, idle, focus), the ephemeral and serialized usage reader against a fake tmux, the activity from hooks, the overview rows and the environment of new tmux windows; none of it was looked at in the running app, and nothing was run against a real second Claude login.
- [ ] Migration: with a `claude-usage.json` from the old version (watching a `CLAUDE_CONFIG_DIR`), the first start shows one Account in *Settings → Claude → Accounts* with that folder, named after it, marked *default*; the usage is shown as before; `claude-usage.json` is still there, `claude-accounts.json` exists next to it
- [ ] Add an Account *Work* with another config folder: it shows *Not logged in* with a **Log in** button; nothing opens a browser until you press it; after the login its email, plan and bars appear; the sidebar shows a block per Account with its name (no name with one Account)
- [ ] Rename (Enter or leaving the field), change the folder, *Make default*, *Remove*: each sticks after a restart; the last Account cannot be removed; a duplicate name is refused with a message; the default Account has square corners and a thin yellow bar on its left
- [ ] WorkDesk settings (needs two Accounts): *Claude Account* lists *default (name)* and each Account; pick *Work*, open a **new** terminal in that WorkDesk and run `echo $CLAUDE_CONFIG_DIR` → the folder; `claude auth status` there shows that login; a terminal opened before keeps the old value; *default* follows a changed default Account; removing the chosen Account falls back to the default
- [ ] A system notification "Claude (Work): 5-hour limit almost used" appears once when that Account's session crosses 90 % (hard to force: temporarily lower the threshold in `limitLevel` or use an account near the limit)
- [ ] Usage reader: while the app idles, `tmux -L workdesk ls` shows no `_workdesk-usage-*` session most of the time; one appears for a few seconds every 5 minutes (one at a time with several Accounts), and is gone after the reading, also when a reading fails (try with a wrong folder)
- [ ] The interval (*Usage settings → Read every*) takes 1 to 60 and applies without a restart; the reload button in the sidebar reads all Accounts at once (a rate-limit wait is respected); returning to the window after more than the interval reads once
- [ ] Lock the screen (or sleep the Mac): no session starts while locked; after unlocking one reading happens at once. Leave the window in the background for over 30 minutes: no readings; focusing it reads at once
- [ ] Performance page: *Claude usage reader* says *idle (starts every N min)* between readings and shows its memory only while a reading runs; the memory of the reader no longer stays at ~370 MB
- [ ] Closing the Claude part of the sidebar stops all readings; opening it reads again; *show Claude usage* off ends them and shows *Claude usage is off*
- [ ] Claude overview (Dashboard, below *What next?*): start `claude` in a terminal of two WorkDesks under two Accounts: both rows show the WorkDesk, Tab, Account name, a state; send a prompt (*working*), let it ask for permission (*waiting for you*, with the question as the message, on top), let it finish (*finished*); the age counts up; a click opens that WorkDesk on that Tab
- [ ] A parked or planned WorkDesk, a pane where `claude` ended, and a plain shell are not listed; after restarting the app a running session shows *idle* until it does something; the row of what waits for you has a thin yellow bar on its left, square corners

## Profiles (branch feat/profiles)
Unit tests cover the tags and the view filter, the migration of the untagged layout (byte for byte), credentials per Profile in a fake keychain, routing to several Status Repos in temporary folders, and the per-Profile background watch with fake GitHub clients. Nothing of the UI, the real keychain or a second real GitHub account was looked at in the running app.
- [ ] First start after the update: Settings → Profiles shows one Profile, *Default*; every Todo and WorkDesk is still there; the files in `workdesk-status` are unchanged (`git status` in it is clean); GitHub, Notion, GitLab and Jira are still connected (Keychain Access now also has `workdesk-profile-default-…` items next to the old `workdesk-…` ones, which stay)
- [ ] The selector under the WORKDESK title shows *Default* with a coloured dot; with one Profile its list has no *All profiles*
- [ ] Add a Profile "B" (own colour): the selector list has B and *All profiles*; switching to B shows an empty sidebar, Dashboard and Work items; switching back shows everything as before
- [ ] In B: add a Todo, start a WorkDesk, a template WorkDesk, a repeating WorkDesk: all appear only in B (and in *All profiles*); Default does not show them; a Todo captured with ⌥⌘T while B is in view goes to B
- [ ] In B: ⌘P and *Search all WorkDesks…* list only B's WorkDesks and files; *Jump to…* too; Dashboard: What next?, Claude sessions, Activity and Time today only count B; with *All profiles* everything is there
- [ ] Switching away from a WorkDesk's Profile while it is open goes to the Dashboard; a terminal of the other Profile's WorkDesk keeps running (come back: output is there)
- [ ] Signals: raise one in a Default WorkDesk (Claude finishes) while B is in view: the selector shows a small yellow count; it disappears when you switch to Default and open the WorkDesk
- [ ] Credentials: with B in view, Settings → GitHub says not connected (or uses `gh`); store a token for B; switch to Default: its own token is untouched; the pull request lists change with the Profile; Notion and GitLab / Jira the same (a different Notion database id per Profile)
- [ ] Settings → Profiles → B → Set token (GitHub): the token field is a password field, nothing is shown afterwards, only "set"; Remove clears it; the tokens never show up in the console
- [ ] Background PR watch: a WorkDesk of Default with a PR and one of B (different org/token); with B in view both get their "ready to merge" notification / chips, each read with its own Profile's token
- [ ] Remove B (Settings → Profiles → Remove …): the question names what moves; afterwards B's Todos and WorkDesks are under Default, B's Keychain items are gone, its Status Repo stays listed
- [ ] Status Repos: add a folder (`/Users/you/status-b`, new): it is created and `git init`ed; point B at it; new Todos of B appear in `status-b/todos.json`, Default's stay in `workdesk-status/`; restart: both load; B's WorkDesk notes link (`<desk>/notes`) points into `status-b`
- [ ] Clone a remote as a Status Repo (empty and non-empty remote; a folder that is not empty is refused); *Backup remote* of that repo sets/pushes it; a push conflict or an unreachable remote is reported
- [ ] Two Profiles sharing one repo: each sees only its own; pointing B at another repo later moves nothing (old B items stay in the old repo and stay visible)
- [ ] A Status Repo folder that is gone or unreadable at start: the app starts, Settings → Profiles says "not available", new items of that Profile go to `workdesk-status` and are tagged
- [ ] Settings → Projects lists only the Projects of the Profile in view; a new Project goes to it; Settings → Profiles → Projects moves one to another Profile
- [ ] Claude Account per Profile: set one for B; a new terminal of a B WorkDesk (without an account of its own) starts `claude` under it; Claude sessions on the Dashboard show it
- [ ] The selector, its list items and the Profile cards have square corners; the selected list item has the thin yellow bar on its left

## Profiles page split and + dialogs
- [ ] Settings → Profiles: a list (colour dot, name, Status Repo, Claude Account, Projects, logins); + adds a Profile (name, Status Repo); Edit … changes name, colour, Status Repo, Claude Account, sets/removes tokens (own dialog), Remove … (asks, Default has none)
- [ ] Settings → Projects: each Project has a Profile selector (when more than one Profile); + asks clone/existing, name, address, Profile
- [ ] Settings → Status Repos: list with Backup remote … (dialog) and Forget; + adds (folder or clone)
- [ ] The + dialogs: Escape and a click outside close them, Enter submits, an error stays in the dialog. Check: Claude Account, hooks directory, Extensions, GitHub watch repository, GitHub token, Notion client, GitLab/Jira connect, Git hosts check, Browser sessions, Repeating WorkDesks, Todos page, Todos in a WorkDesk, Branches in a WorkDesk, New branch on the Branches page

## Review mode
- [ ] The eye button under the tabs (and ⌘P "Review mode…") replaces the tabs with the review view, with tabs on top, on the left and on the right; Close review / Esc brings them back unchanged; terminals still run
- [ ] Left: branch switcher (several branches), Since base (base picker, tree, comments buttons) and Working tree (stage, commit, Check types); the diff opens on the right at full width; comments in the gutter work
- [ ] Open in editor in the diff opens the file in a File tab and leaves review mode; the File pane's side has only Files and Search; the choice is remembered per WorkDesk after a restart
- [ ] Not built: next / previous file buttons and a reviewed tick per file; collapsed single-child paths in the tree are as before

## Side panel bar, profile selector, default colour
- [ ] The button next to Performance / Settings (and ⌘\\) shrinks the left panel to a slim icon bar; its icons switch pages and WorkDesks, the active one has the yellow bar, a WorkDesk with a Signal has a dot; the first button shows the panel again; the choice survives a restart
- [ ] The Profile selector is above the WORKDESK title; the Default Profile's dot is the theme's yellow (also in Settings → Profiles; a Default that was blue before turns yellow)

## Review: next / previous, ticks, side by side
- [ ] Since base: Previous / Next step through the changed files (wrapping), the shown file is marked, each file has a tick (struck through when ticked), "n/N reviewed" counts, "Reviewed ✓ & next" ticks and goes to the next unticked file, reset clears; ticks stay after a restart (per WorkDesk, Branch folder and base)
- [ ] Diff: side by side is the default and the Inline button switches to one column and back, also when the view is narrow (Monaco used to switch to one column by itself below a width, so the button seemed to do nothing)

- Todos: right-click a Todo for Open, Add to today, Resolve/Reopen, Copy title, Delete. The + next to the Todos, Pull Requests and Branches headings is a quiet yellow icon, no box.

- Tabs: Details stays the first tab; a head row (WorkDesk name left, plain icons right: Review, panes list, group by branch) sits above the list; below it New terminal / browser / file and VS Code.

- File bar: only the ☰ toggle, name, word wrap and a ⋯ menu (Back, Forward, Diff against HEAD, Review comments, New scratch file, Show in VS Code). Review mode has a list-with-tick icon.

## Right-click menus, branches, notes
- [ ] Right-click: Todos (page and WorkDesk checklist), WorkDesk branches, Branches overview, work items, pull requests
- [ ] Branch details → Delete: "Remove from WorkDesk and delete…" removes the folder (asks first), then offers to delete the local branch
- [ ] Details: Notes is a card after Branches; the editor stays inside it and no longer covers the cards below

## Control commands and skills
- [ ] In a WorkDesk terminal: `node "$WORKDESK_CLI" desk list|current|open|park`, `branch add`, `todo add|done`, `review state|comment` answer JSON (needs the new build running; an old one does not answer)
- [ ] `desk clear` without --yes only lists what would be lost
- [ ] Copy skills/* to ~/.claude/skills and try "review my branches" / "close this desk" in a desk

## Dashboard
- [ ] "Your WorkDesks": a list like the others, by section (Working, Waiting, Planned, Postponed): name, a line with the open Todos and branches, chips for Signals / parked / Stage, when it last did something; a click opens the desk

- [ ] Settings → Claude → Skills: Install / Update / Remove skills per registered config directory; your own skills in ~/.claude/skills stay
- [ ] Start Review mode in a WorkDesk, go to the Dashboard or another WorkDesk: Review mode no longer shows over them, and is still there when you come back

- [ ] WorkDesk settings → Tabs: a WorkDesk can have its tabs on top, left or right, or follow Settings → Tabs; other WorkDesks are not affected; the choice stays after a restart (per machine)

## Review as a tab
- [ ] Review button sits with new terminal / browser / file and in ⌘P ("Open Review"); it adds a **Review** tab after the first tab
- [ ] Click another tab (terminal, browser, file): Review hides but keeps its file, ticks and scroll; click the Review tab to come back; × closes it
- [ ] Tabs at the left or right: a panel icon in the head row (next to the desk name) folds the whole list of tabs to a narrow strip of icons (two letters for a tab without an icon, the new-tab buttons stacked), again to unfold; remembered per WorkDesk. Review's own file list is not folded
- [ ] Open in editor in the diff opens the file in a file tab

- [ ] Go to definition on a method name (`public abc(`, `private async abc(`, `abc() {`, Go `func (s *S) abc(`) finds its declaration; declarations come before methods

- [ ] Review comment box in a diff (add and edit): the box is fully inside its space, Save / Cancel do not cover code lines, resizing the textarea moves the lines below
- [ ] Click into the comment box (textarea, Save, Cancel, Edit, Delete): the cursor stays in the box, the code behind does not take the click
- [ ] Review comment box: drag the grip at its bottom right to make it taller or shorter (the lines below move with it), a long comment scrolls inside it, it does not flash at the top of the editor when it opens
- [ ] A new file tab shows cards: New note (folder, name, Create), Scratch file, Find something (find by name, search ⇧⌘F, go to definition ⌘D open their finders)
- [ ] Review comments: Cancel and Save close the box; Edit shows one box only; scrolling moves the boxes with their lines (no ghosts over the code)
- [ ] Review comment box: dragging its grip makes the textarea (or the comment text) taller with it; the wheel over a textarea that scrolls scrolls the text, not the file
- [ ] Diffs (Review tab and Diff against HEAD): follow the word wrap setting of the File panes, have the wrap icon in the diff bar and ⌥Z; toggling it in either place changes both; comment boxes stay under their lines when lines wrap
- [ ] Diffs: a map of the file at the right edge with the changes marked (and change marks on the scrollbar); the Map button in the diff bar hides or shows it, remembered; comment boxes stop before the map
- [ ] File pane: change the open file from a terminal (or let Claude do it): within about two seconds the editor shows the new text (cursor and scroll stay); with unsaved changes in the editor a note offers Reload instead; ⋯ menu has Reload from disk
- [ ] Review → Since base: next to the Base branch box a **Since** box lists the newest commits (8-character hash and title); picking one lists only the files changed after it (the branch box then reads "Since a commit", the diff title shows the short hash); picking a branch again goes back; a new commit shows at the top of the list
- [ ] Review → **Comments** tab next to Since base / Working tree: all comments listed by file and line; a click opens the diff at that line; Edit (⌘Enter saves, Esc cancels), Delete, Clear all (asks), Copy as markdown (Base line, then one "## [ ] path:line" heading per comment); no .review/comments.md is written any more
- [ ] Skills panel lists 10 skills (new: desk-review-to-pr); in a review WorkDesk with a PR: "send my review comments to the PR" creates a pending review only you see, nothing submitted

## Time
- [ ] New **Time** page (side panel, icon bar, ⌘P "Go to Time"): a horizontal bar per day of the week that has time (the same as the WorkDesk box), a table per WorkDesk with days and total, ◀ ▶ for other weeks, total / days worked / per worked day; a click on a WorkDesk opens it; cleared WorkDesks in one row
- [ ] A WorkDesk's Details page has the time as a half-width box at the top of the left column: today and 7 days, then a horizontal bar per day that has time ("This week →" opens the Time page)
- [ ] Terminals: leave a terminal tab and come back (also after resizing the window or the side panel): it fills its pane again instead of a small area in a corner (tmux window-size latest); a terminal already stuck small should fix itself when you come back to it
- [ ] The Dashboard has no "Time today" box any more (see the Time page)

## Review start, terminals
- [ ] Start a review from a pull request (or open a planned review): the branch is checked out on its own (first time the repository is cloned, in the background), the **Review** tab is open, and the browser tab with the PR's files comes up; Review shows the files once the checkout is there; if the checkout fails the "Check out the branch" button is still on the Details page
- [ ] Terminals: a terminal opened in a tab you were not looking at (restart, a tab restored in the background) does not cut the others to a small box with dots around it; coming back to a tab fills the pane
- [ ] A terminal that was stuck small (dots around a small box) fills its pane again after the app starts or the tab is shown; new terminals follow the pane size when it changes
- [ ] The Review tab is a real tab: drag it to another place among the tabs, Ctrl+Tab / Ctrl+Shift+Tab stop on it, × closes it and the review button opens it again; a WorkDesk that had the Review open before keeps it as a tab, a Review WorkDesk gets it once
- [ ] ⌘P in a WorkDesk: "New note…" (name, folder; opens the note in a file tab) and "New scratch file"; on other pages "New note on the Files page…" and "New scratch file on the Files page"

## Waiting
- [ ] Settings → Behavior → "When a WorkDesk moves to Waiting": Ask me / Park it / Keep it active. Set a running WorkDesk's Stage to a waiting one (or let a review be approved): Ask opens a dialog (Park it / Keep it active, what would end, "Remember my choice"); Park it parks without asking when only a shell runs, else asks; Keep does nothing
- [ ] A review WorkDesk starts with the tabs: Details, the pull request on GitHub (its conversation page, not Files changed), Review, then the terminal, with the pull request on screen
- [ ] Browser: the back button goes back after following a link that moved the page to another session (a login hop, a link to another site with its own session); it still goes back normally within a site
- [ ] Start a review WorkDesk (its terminal tab is not the one on screen): when you open the terminal tab, no text like `1;2c0;276;0c2026;2$y` is typed at the prompt
- [ ] Waiting question: not asked for the WorkDesk you are working in (on screen), not when only a Signal comes and goes; the dialog has "Do not ask again for this WorkDesk"

## Blocked sites
- [ ] Settings → Browser → Blocked sites: + adds a site (reddit.com, or reddit.com/r/all), Remove takes it out
- [ ] A browser tab (Browser page or WorkDesk) that goes to a blocked site (typed, a link, a redirect, a single-page site changing its address) shows "… is on your block list": Go back, or after 10 seconds "Open this page for 10 minutes"; the pass is for that page only, another page of the site is blocked again; images and embeds of blocked sites in other pages still load
- [ ] Dashboard order: What next, Claude overview, Start working, then Your WorkDesks
- [ ] Review → Comments: "Add a general comment" (a comment on the review as a whole, kept in .review/notes.json): edit, delete, in Copy as markdown first as "## [ ] General"; `workdesk review note <text>` adds one; desk-review-to-pr puts them in the review summary
- [ ] Dashboard: a click on the heading of Ready to merge, What next, Claude sessions, Start working and Your WorkDesks folds the section (▾ / ▸); remembered

## One kind of WorkDesk
- [ ] Start a WorkDesk from two pull requests that are not yours (Dashboard → select both → Start together): both are checked out (a folder each), both pages open, the Details page shows both, Review lists both folders, the Stage follows the one that needs you
- [ ] A pull request of yours in that selection is only a work item (no review Stage from it)
- [ ] Open a WorkDesk that was saved before this change (a review, a ticket, a plain one): it looks and behaves as before, with no type chip; a review keeps its Stage and its checkout
- [ ] Combine with…: the button next to the gear on a WorkDesk's Details page, ⌘P "Combine this WorkDesk with another…", and the right-click menu of a WorkDesk in the left panel: pick another WorkDesk: its branch folders move (uncommitted files and Review comments are there), its pull requests / Todos / pages / note are in this one, it is gone from the list, the pull request pages open as tabs
- [ ] Add a branch, a second pull request or a ticket to a WorkDesk that reviews a pull request: allowed now
- [ ] The Stage list of a WorkDesk has all eight Stages; with reviewed pull requests, "automatic" follows GitHub
- [ ] Copy path: right-click a file or a folder in the Review list (Show the diff, Copy relative path, Copy path), the file name in the file bar and in the diff bar (relative / full path), a line in the editor and in a diff (Copy Relative Path / Copy Path in its menu), and a file or folder in the Files tree
- [ ] Dashboard layout: four numbers on top (Needs you, Working, Waiting, Ready to merge), then Your WorkDesks in the wide column with Ready to merge / What next / Claude sessions beside it (stacked below on a narrow window), Start working as a card below; sections still fold
- [ ] Notion ticket of a pull request: start or open a WorkDesk with a pull request (Notion connected): within a moment its Pages list has the ticket ("ACME-1205 …"), found through the GitHub PRs relation of the tasks database, else by the key in the branch / title; a click opens it as a browser tab. Needs the Notion connection; asked once per start of the app per pull request
- [ ] Combine: tick several WorkDesks (a checkbox list with folders and items per WorkDesk) and combine them in one go; the time spent in each of them is in the combined one on the Time page and its Details box; `workdesk desk combine a b`
- [ ] WorkDesk settings: with the tabs in a row on top, a hint under "Group the tabs by branch" says it shows in a list at the side
- [ ] ⌘P "Analyse JWT…" (in a WorkDesk; "…on the Files page" elsewhere): paste a JWT, an SD-JWT or "Bearer …" into the dialog; a message under it says what is wrong while it cannot be read; Decode and open (or ⌘Enter) makes a scratch file jwt-HHMMSS.json with header, payload, the times in words (iat / nbf / exp, how long ago or from now), the disclosures of an SD-JWT, and the signature; nothing is verified
- [ ] Reload on the Details page (the icon in the header): after the spinner, the WorkDesk that reviews pull requests changes its Stage and moves in the left panel at once (for example to Waiting once you reviewed the last one), not only a minute later
- [ ] Reviews on your own pull requests: a WorkDesk (also a parked or postponed one) that has a pull request of yours gets a Signal when somebody approves it, asks for changes or comments ("#803 Changes requested", "#803 2 new comments"), a macOS notification, and a postponed WorkDesk comes back; each is told once, also after a restart (what was seen is kept with the work item); the first look of a pull request tells where it stands once (approved / changes requested / N comments); comments of bots are not counted; pull requests you review for others are handled by the review logic as before
- [ ] A WorkDesk's Stage follows its own pull requests (not set by hand, no pull requests it reviews): changes requested on any → Implement; open, not draft and nobody asked for changes → Waiting (so it sinks in the left panel, and the Waiting question can come); drafts, merged and closed ones change nothing. Expect a few WorkDesks to move to Waiting the first time after the update
- [ ] Performance: the parked WorkDesks are one folded row "Parked WorkDesks (n)" under the running ones (▸ opens the list); running WorkDesks are listed as before
- [ ] On the Details page of a parked WorkDesk, "Open pull request" / PR chips / pages open in the Browser page of the app (a new tab there), not in the system browser
- [ ] New section **Can be cleared (n)** in the left panel (after Waiting) and on the Dashboard (a number and a group in Your WorkDesks): WorkDesks whose pull requests are all merged or closed and whose Todos are resolved (also parked ones); right-click → "Clear this WorkDesk…"; a postponed or planned WorkDesk stays where it is; tickets and branch pull requests are not looked at
- [ ] What next? has a group "Can be cleared (n)" (after the Todos) for WorkDesks whose pull requests are merged or closed and whose Todos are resolved: Open, Clear… (asks first); it counts in the number next to Dashboard in the left panel
- [ ] A pull request of yours with changes requested whose reviewer was asked again (you answered and re-requested): the WorkDesk goes to Waiting, not Implement; with changes requested and nobody re-requested it is Implement; a team asked (review required) is waiting
- [ ] Settings navigation: first everything that is not about a Profile (WorkDesk: Appearance, Behavior, Shortcuts, Templates, Repeating WorkDesks, Status Repos, Claude; Browser: …); then **Profiles** with a + in its header and each Profile as an entry (a click opens its edit dialog; "All Profiles" is the list); then **Settings of the Profile** with a selector for the Profile in view (the same as the one above WORKDESK) and its Projects, GitHub, GitLab, Jira, Git hosts and Notion
- [ ] With a second Profile in view: Work items → Branches (and its fetch) lists and fetches only the Projects of that Profile; the setup checklist counts only its Projects
- [ ] There is no *All profiles* choice (neither in the selector under the WORKDESK title nor in the Settings): one Profile is always in view; a config saved with *all* opens on the Default Profile
- [ ] Settings → Settings of the Profile → Details: a page for the Profile in view: colour, name (saved when you leave the field), Status Repo, Claude Account, Projects count, logins (Set token … / Remove), Remove this Profile …; picking a Profile in the navigation or *Details …* in the list of Profiles opens it
- [ ] Left panel order: the WORKDESK title with its icons, then what is global (Files, Browser, pinned browser tabs), a line, the Profile selector, then what belongs to the Profile in view (Dashboard, Work Items, Time) and its WorkDesks; the icon bar of the hidden panel has the same order
- [ ] With several Profiles, Start working (Dashboard) and the pull request pickers offer only pull requests of repositories that are Projects of the Profile in view; with one Profile all of them
- [ ] The left panel: the WORKDESK bar has a darker background of its own, the Profile selector only a light tint of the Profile's colour with a bar at its edge
- [ ] Left panel: the top bar has hide, Browser, Performance and Settings; under it the pinned Browser tabs, then the Profile selector with Dashboard, Work Items, Files, Time and the WorkDesks; Files and Browser are no longer separate text buttons
- [ ] With two Profiles on different Status Repos, the Files page shows each Profile's own knowledge, notes and scratch folder, and switching the Profile reloads the tree; with the same Status Repo for both they show the same folders
- [ ] A WorkDesk's Work items list shows, per Pull Request, "✓ n approved" (your own), the checks and "ready to merge" — also while the WorkDesk is parked; an approval that arrives while it is parked shows after the next refresh (⟳ on the page) without reactivating it
- [ ] Left panel header: the time (hours and minutes) sits on the second row at the left, the pinned Browser tabs at the right; it moves on by itself, hovering shows the date and the week of the year (ISO, e.g. "week 45")
- [ ] Settings → Claude → Skills lists *desk-scratch* as missing; after installing it, in a WorkDesk terminal "put that in a scratch file" in Claude writes `scratch/<name>` in the WorkDesk folder, and it shows in the File pane under *scratch*
- [ ] A WorkDesk with unread Claude Signals ("finished", "needs input") whose review you then submit (Stage becomes Reviewed, waiting) moves to Waiting by itself, its red number gone; a Signal from GitHub that arrives later brings it back out
- [ ] A running WorkDesk in a waiting Stage shows "Waiting for somebody else. Park this WorkDesk…" with a Park button on its page; parked, planned or finished ones do not
- [ ] The top bar has no Performance icon any more; the Performance entry at the bottom of the left panel shows the pulse icon with memory and CPU, and a click on its title or on the figures opens the page (the entry is lit while the page is open)
- [ ] Park all / Reactivate all sit in each section of the left panel (Working, Waiting, Can be cleared, Postponed) and act on that section's WorkDesks only; with two Profiles, WorkDesks of the other Profile are never parked or reactivated (also from ⌘P and the menu); Park all asks first and lists only that section
- [ ] Docs site: after enabling GitHub Pages (main, /docs) the home page, the side navigation, a use case and a features page render; every link in the navigation and in the pages opens a page (no 404)

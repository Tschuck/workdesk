---
title: "Navigation and layout"
description: "The command palette, tabs and panes, keyboard shortcuts and the layout of the app."
sidebar_position: 5
---

# Navigation and layout

## The command palette

`⌘P` opens a search bar over everything you can do right now. Type to filter (every word must match), `↓` / `↑` or `Ctrl+N` / `Ctrl+P` move, `Enter` runs, `Esc` closes.

It depends on where you are. Everywhere it offers pages and Settings sections, switching WorkDesks, adding, parking and reactivating WorkDesks, the Browser's tabs and your favorites. While a WorkDesk is on screen it adds that WorkDesk's tabs, new terminal and browser tabs, *Open VS Code*, its pull requests and tickets, *Park this WorkDesk*, *Postpone this WorkDesk…* and, with two or more branches, *Group the tabs by branch*.

Three things start from it:

- **Jump to…** lists everything that is open: every pane of your started WorkDesks (the one on screen first), then the tabs of the Browser page and the Files page. Every word must appear in the name, address, path or WorkDesk name (`api src` finds `…/api/src/app.ts`). Parked and planned WorkDesks are not listed.
- **Search all WorkDesks…** has three modes (`Tab` switches): **Files** (part of a name), **Text** (`git grep` over the branch folders, notes and scratch of every started WorkDesk; `.*` for a regular expression, `Aa` for case) and **Terminals** (the last 3000 lines of every tmux pane). Enter opens the hit in its WorkDesk. Hits are capped (300 text, 100 terminal lines).
- **Open a file by its path:** type or paste a path such as `modules/billing/invoice/types/invoice.type.ts` (or `…/main.ts:42` for a line). The files it names come first, and `Enter` opens one in a File tab. A leading `./` is ignored, and a path that is a little off still finds the file.

## Tabs and panes

A WorkDesk is a row of **tabs**, and a tab is a tiling of **panes** (terminal, browser or file). A new tab or pane starts from one filterable picker (`⌘T`, `⇧⌘+arrow`): the kinds, your favorites, an address you typed, or a search with your engines.

- **Rename** a tab by clicking the active tab. The middle mouse button closes one. Closing a tab that runs something other than a shell prompt asks first.
- **Reopen:** `⌘⇧T` brings back what you closed last in this WorkDesk, newest first.
- **Pin** a tab (right-click, or *Pin this tab* in ⌘P): it moves right behind Details, shows only its icon and cannot be closed by accident.
- **Groups:** right-click → *Add to a group…* and type a name such as `terminals` or `research`. In a list of tabs a group is a folding heading; drag tabs onto it, or drag the heading to move the group.
- **Tabs on top or as a list:** *Settings → Appearance → Tabs*, separately for the Browser page, the WorkDesks and the Files page. As a list, a tab with several panes shows them under it, one entry each.
- **Resizable:** drag the edge of the left panel or of a tab list; double-click to reset. Sizes are kept on this machine.
- **Hibernate:** right-click a tab → *Hibernate* unloads its pages (a terminal is never touched). *Wake up* loads them again.

### Keyboard

| Keys | Does |
|---|---|
| `⌘←/→/↑/↓` | move the focus to the neighbouring pane (also from a web page) |
| `⌘⇧←/→/↑/↓` | split the focused pane that way; the overlay asks for Terminal or Browser (`T` / `B`) |
| `⌘W` | close the focused pane |
| `⌘T` | new tab |
| `Ctrl+Tab`, `Ctrl+Shift+Tab` | next, previous tab |
| `Opt+Tab` | the tab you used before; hold Option and press Tab again to go further back |
| `⌘P` | command palette |
| `⌘\` | hide or show the left panel |
| `⌥⌘T` | capture a Todo from any app |
| `⌥⌘Q` | quit and stop all terminals |
| `Shift+Enter` in a terminal | a new line instead of submitting |
| `Ctrl+←/→`, `Option+←/→` in a terminal | jump over words |

*Settings → Shortcuts* lists all shortcuts and can hide the buttons on each pane. Drag a tab over a pane to merge it there, drag a pane by its grip (⠿) to another pane's edge, another tab or the tab bar; a terminal keeps running while it moves, a browser page reloads.

## Hiding the left panel

The button in the header (or `⌘\`, or *Hide the side panel* in ⌘P) shrinks the panel to a slim icon rail: show it again, Dashboard, Work Items, Files, Time, Orchestrator, the WorkDesks in use (numbered like ⌘1…⌘9, a dot for an open Signal), Browser, Performance and Settings.

## Themes

*Settings → Appearance* shows each theme as a card: *Gruvbox Dark* (the default), *Gruvbox Light*, *Nord*, *Dracula*, *Tokyo Night* and *Solarized Dark*. A click switches the whole app and its terminals. A theme is one small palette in `src/renderer/theme.ts` plus the terminal's 16 colours, so adding one is a single entry.

Tooltips of the app show after half a second; tooltips inside web pages are the page's own.

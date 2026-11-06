---
title: "Files and editor"
description: "The File pane, the Files page, search, symbols and VS Code."
sidebar_position: 9
---

# Files and editor

Three ways to look at a file: in a **File pane** next to a terminal, on the **Files page**, or in your own **VS Code** window.

## VS Code

Your real VS Code, one window per WorkDesk on a multi-root workspace with a folder per branch, kept up to date as branches come and go. The VS Code icon at the right end of the tab bar opens it (it is lit while open) and brings it to the front. It is a window of its own, so WorkDesk never moves or resizes it. When you open one WorkDesk's editor, the windows of the other WorkDesks are minimised; VS Code windows that are not a WorkDesk's are left alone. `Cmd+Tab` finds the one in front.

*VS Code ↗* in the file bar shows the file at the same line in that window. Controlling the window uses AppleScript through System Events, so macOS asks once for permission under *Privacy & Security → Accessibility*.

## The File pane

A third kind of pane next to Terminal and Browser shows **one file** in a light editor (Monaco, with syntax highlighting in the app's colours), so you can look at something, change it and go back. Open one with the file button in the tab bar, *File right* in a pane's buttons, the pane picker, or ⌘P (*New file tab*, *New scratch file*).

On its left side:

- **Files:** a tree of the WorkDesk's branch folders (tracked and untracked files, nothing ignored), plus *notes* and *scratch*. Type to find a file by name.
- **Search:** text or regular expression, case on or off, and globs such as `*.ts, src/**/*.tsx, !dist/**`. A click opens the file at that line.

Keys: `⌘B` shows or hides that side, `⇧⌘F` opens the search (also from a terminal in the same tab), `⌘S` saves (branch files are saved only then; a dot in the title shows changes and closing asks first), **Cmd-click** opens a file in a new pane beside this one, `⌥Z` toggles word wrap (one setting for all File panes).

A pane without a file shows three cards: **New note** (pick *notes* or *knowledge*, type a name such as `name.md`; no dot makes `.md`, folders are made), **Scratch file** and **Find something**.

Limits: linting is only what Monaco does itself (syntax errors in JavaScript, TypeScript, JSON, CSS, HTML). ESLint, project-wide types and extensions stay in VS Code. Files over 2 MB and binary files are not opened.

**Back / forward:** `Ctrl+-` and `Ctrl+Shift+-` (or ◀ ▶ in the file bar) go through the places your cursor was, across files. A File pane remembers its cursor, scroll and unsaved changes across restarts.

### In the tree

Right-click a file: *Open*, *Open beside*, **Duplicate**, **Rename…**, **Delete** (to the Trash) and *Copy path*. A folder has *New file…* and *Search in…*. Drag a file onto a folder, or onto *notes* or *scratch*, to move it. Git state shows as a letter on changed files (`M` modified, `A` added, `D` deleted, `R` renamed, `U` untracked, `!` conflict) and a dot on the folders above. Changes, staging and review are in [Review mode](./review.md).

### Scratch, notes and knowledge

| Place | For | Lives in | Kept |
|---|---|---|---|
| **scratch** | throwaway files | `<WorkDesk folder>/scratch/` | survives parking and restarts, goes when the WorkDesk is cleared. A file never written to disappears when its pane closes. |
| **notes** | what you want to keep with the WorkDesk | `desks/<desk>/notes` in the Status Repo | archived on clear |
| **knowledge** | reference material: a specification, a contract, how something works | `knowledge/` of the Status Repo of the Profile in view | no WorkDesk owns it, clearing never touches it |

Put knowledge in one folder per topic, for example `knowledge/payments/requirements.pdf`. *Move to knowledge…* in a file's right-click menu asks for the folder (`payments`, `payments/specs`; made when missing). *New folder…* on a root or folder makes one (also `a/b`). Changes are picked up by the Status Repo's auto-commit.

## The Files page

*Files* in the left panel is for files outside any WorkDesk and belongs to the Profile in view. It has one tree and search at full height on the left and **tabs of one file each** beside it, kept across restarts (`⌘T` new tab, `⌘W` close). It shows the Profile's knowledge, the notes of Todos and a global scratch folder that is kept until you delete its files. The same editor, keys and right-click menu as in a File pane. Every WorkDesk's File pane lists *knowledge* and *global scratch* too.

## Finding things

- **Search in:** the *Search* side has a field under the text field. Empty, it searches every folder of the tree. A path narrows it: start at the name of a root as the tree shows it (`knowledge`, `notes`, or `project/branch`) and go down (`knowledge/sub`); the start of a root's name (`know`) takes every root it fits. Right-click a folder → *Search in…* fills it.
- **From anywhere:** ⌘P has *Find a file…* and *Search in files…*. A path typed into ⌘P lists the matching files of the WorkDesk you are in first, then those of other started WorkDesks; Enter switches there and opens the file. See [Navigation](./navigation.md).
- **Go to definition (`⌘D`):** copy a class or file name from a review on GitHub, press `⌘D`, and the finder opens with the name filled in. It lists where the name is declared (`class`, `interface`, `type`, `enum`, `const`, `function`, `namespace`, and `def`/`func`/`fn`/`struct`/`trait` of other languages) with the line. Case matters. The key is taken before the page, so in a File pane `⌘D` no longer adds the next match to the selection.

## Find usages and rename (text based)

With the cursor on a name in a File pane:

- `⌥⇧F7` (*Find Usages (text based)*) lists every whole-word match in the files of the branch scope, with definitions first. `$`, `_` and letters of any script belong to a word, and case matters.
- `⌥⇧F6` (*Rename Symbol (text based)*) opens a **preview**: the new name, every match with a checkbox, one group per file, and *Skip matches inside strings and comments* (ticked). That skip is **best effort** and reads comments and strings the same way for every language, so look through the list before you apply.
- *Rename N matches* writes only the ticked ones, only in the branch folders of the scope (never notes, scratch or other branches). A place whose text changed since the search is left alone, and a file with unsaved changes in a pane is not touched and is reported. Nothing is committed, and the pane's undo does not undo it.

There is no language server: a property, a variable and a class with the same name are one symbol. For types, use *VS Code ↗*.

## Analyse a JWT

⌘P → *Analyse JWT…* opens a dialog to paste a token (a JWT, an SD-JWT with its disclosures, or a `Bearer …` line). It is decoded, not verified, and opened as a scratch file: the header, the payload, the times (`iat`, `nbf`, `exp`) as dates with how long ago or from now, the decoded disclosures and the signature. An encrypted token (five parts) is reported as such.

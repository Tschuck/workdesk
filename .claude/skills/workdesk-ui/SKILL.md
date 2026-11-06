---
name: workdesk-ui
description: House rules for WorkDesk renderer UI (React, src/renderer). Use when adding or changing any screen, button, dialog or menu.
---

- **Square corners** on anything with an active or selected state. The active state is a thin yellow bar on the left with a dim background, never a rounded pill.
- **Adding things**: never an inline "input + Add" form. Show an always-visible `+` (`AddButton`, or `PageHead` for a page title) that opens a `Modal` with `Field`s (all in `src/renderer/Modal.tsx`, styles in `modal.css`). The modal closes only when the action succeeded; show the error inside it.
- **The + is a plain icon button**: grey, no frame, no colour until hovered. Same for other icon buttons: `IconButton` / `ICONS` in `Icons.tsx`; add a new icon there, not an emoji or a text glyph.
- **Many actions on a bar** go into a `⋯` menu (`ContextMenu` in `ContextMenu.tsx`); keep only the one or two toggles people use all the time as icons.
- **Right-click** on list rows: use `ContextMenu` with `onContextMenu`; destructive entries confirm first.
- Colours come from the theme variables (`--yellow`, `--fg-rgb`, `--line`, …), never hard-coded, except a Profile's own colour via `cssColor()`.
- Words: use the terms of `CONTEXT.md` (WorkDesk, Todo, Branch folder, Profile, Status Repo), not the "Avoid" ones.

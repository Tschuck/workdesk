---
name: desk-review-preset
description: Make a Review preset for this WorkDesk that narrows the review to the changed files that matter for what the user wants to look at. Use for "shrink this review", "only show me the API part", "review without the generated files", "make a preset for X".
---

A Review preset decides which of the changed files Review mode lists. It never changes the diff or the comments. "Whole review" and "Without tests" always exist; you make the others.

1. Find out what the user wants to see or skip (a layer, a feature, a concern like security or migrations, "no generated code"). If they did not say, ask one short question.
2. `node "$WORKDESK_CLI" review state [--root <project>]` lists the changed files (`entries`). Read the paths; look into a few files when the names do not tell what they are. With several branches, use the files of all of them: a preset is for the WorkDesk, its patterns are relative to each branch folder.
3. Write the smallest set of patterns that picks exactly those files:
   - `--include <glob>` keeps only matching files (several allowed); `--exclude <glob>` drops matching ones; `--file <path>` names one file exactly.
   - A pattern without `/` matches at any depth (`*.test.*`, `package-lock.json`); with a `/` it starts at the branch folder's root (`src/api/**`); a trailing `/` is a folder anywhere (`migrations/`). `**` crosses folders, `*` and `?` stay inside one.
   - Prefer patterns over a long list of `--file`; use `--file` only for the odd single file.
   - Check every changed path against your patterns before saving: nothing wanted left out, nothing unwanted in.
4. `node "$WORKDESK_CLI" review preset add "<short name>" --description "<one line: what it is for>" --include … --exclude …`. The same name replaces the old preset.
5. Tell the user the name, how many of the changed files it shows (and which it hides, if few), and that it is in the "Preset" menu above the Previous / Next buttons of Review mode. `review preset list` shows all of them, `review preset remove "<name>"` deletes one.

Do not comment on files or write a review here; that is `desk-review`. After a preset exists, `desk-review` can be run on just those files.

---
name: desk-scratch
description: Put something into a scratch file of this WorkDesk (output, a snippet, a draft, a list), so it can be read and edited in the app's File pane. Use for "put that in a scratch file", "save this to scratch", "scratch this".
---

Scratch files live in `scratch/` in the WorkDesk folder (the parent of the branch folders; `node "$WORKDESK_CLI" desk current` names the WorkDesk if unsure). They are not in git and survive parking.

1. Make sure the folder exists: `mkdir -p <desk folder>/scratch`.
2. Pick a short name from the content, kebab-case, with the right extension (`.md` for text, `.json`, `.sql`, `.ts`, …). Never overwrite a file that is there: add `-2`, `-3` if the name is taken, unless the user asked to replace or append to a named file.
3. Write exactly what the user asked for, with no extra commentary around it. If they said "that", it is the last thing you showed them.
4. Reply with the path, in one line. The file shows in the File pane's tree under *scratch*.

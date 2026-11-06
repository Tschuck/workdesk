---
name: desk-add-branch
description: Add a branch (a Project's folder) to this WorkDesk, or take one out. Use for "add a branch for X", "I also need the api project here".
---

- Add: `node "$WORKDESK_CLI" branch add <project> <branch> [--base <branch>]`. Without `--base` the branch starts from the Project's default.
- Take out: `node "$WORKDESK_CLI" branch remove <project> <branch>` removes the folder from the desk and keeps the branch. Check `git status` in that folder first and tell the user about unsaved work.
- Project names are the ones in `desk current` or the user's Projects list. Branch names have no spaces.

Any WorkDesk takes more branches, also one that reviews pull requests. To bring two related WorkDesks together (for example the backend and the frontend pull request), use `node "$WORKDESK_CLI" desk combine <other>`: its branch folders move here with their uncommitted work and review comments, and it is cleared.

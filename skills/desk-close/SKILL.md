---
name: desk-close
description: Park or clear a WorkDesk when the work is done. Use for "close this desk", "I'm done here", "park it".
---

1. `node "$WORKDESK_CLI" desk current` and check that every Todo is resolved; if not, say which are open.
2. To pause only: `desk park` (terminals shut down, everything kept).
3. To end it for good: run `desk clear` **without** `--yes` first. It lists what would be lost (uncommitted or unpushed work, branches without a remote, `.env` files). Show that list to the user.
4. Only after the user says yes: `desk clear --yes`. Notes and Claude sessions are archived, folders removed, Branches and Todos kept.

Never add `--yes` on your own. Clearing is never automatic.

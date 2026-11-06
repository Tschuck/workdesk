---
name: workdesk-check
description: Run the WorkDesk checks (type check, unit tests, build) and report the result faithfully. Use after every code change in this repo and before a commit.
---

Run from the repo root, in this order, and stop at the first failure to fix it:

1. `pnpm typecheck` (`tsc --noEmit`)
2. `pnpm test` (vitest; all tests must pass, say the count)
3. `pnpm exec electron-vite build`

Report plainly what passed and what failed, with the error text of a failure. Never say "works" for UI: none of it is seen in the running app, so say "type check, tests and build pass, not looked at in the app".

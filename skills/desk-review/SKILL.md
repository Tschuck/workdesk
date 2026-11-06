---
name: desk-review
description: Review the branches of this WorkDesk against their base and leave line comments the user sees in Review mode. Use for "review my branches", "look over this desk's changes".
---

1. `node "$WORKDESK_CLI" review state` gives the base branch, the changed files and existing comments. Pass `--root <project>` when the desk has several branches (do each in turn). If no base is set, tell the user to pick one in Review mode.
2. If the user named a Review preset (or asks for a narrower review), run `node "$WORKDESK_CLI" review state --preset "<name>"` and review only the changed files it lists (`review preset list` shows the presets); `desk-review-preset` makes a new one. Otherwise review everything.
3. Read the diff: `git diff $(git merge-base HEAD <base>)...HEAD` in that folder, file by file.
4. For each real problem: `node "$WORKDESK_CLI" review comment <file> <line> "<text>"`. Be specific: what is wrong, why, and the fix. No praise, no style nits the linter covers.
5. Finish with a short list: blockers first, then smaller points. Say the comments are in Review mode (Comments tab; kept in `.review/comments.json`).

Never post anything to GitHub.

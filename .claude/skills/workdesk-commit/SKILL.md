---
name: workdesk-commit
description: Commit work in the WorkDesk repo the way the owner wants it. Use when asked to commit or when a finished change should be saved.
---

1. Run the `workdesk-check` skill first; do not commit a red tree.
2. Stage only what belongs to the change (`git add src TESTING.md …`). Never `git add -A` at the root: `.claude/worktrees` is untracked junk.
3. Commit **GPG-signed** (`git commit -S`); never bypass signing. If the gpg-agent is cold and blocks, ask the user to unlock it.
4. Message: `feat:` / `fix:` / `refactor:` + one line saying what the user gets.
5. **No Claude or AI attribution** anywhere: no Co-Authored-By trailer, no "Generated with" line.
6. **Never push** unless asked, and **never force push** (no `--force`, `--force-with-lease`, `+branch`); if a push needs it, stop and ask.

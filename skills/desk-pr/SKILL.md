---
name: desk-pr
description: Open or update the pull request of a branch in this WorkDesk. Use for "open a PR", "update the PR description".
---

1. Check `git status` is clean and the branch is pushed (`git push -u origin <branch>`; never force push).
2. Review first, when `/t-review` is there: the scratch file `scratch/review-<branch>.md` (in the WorkDesk folder, next to the branch folders; `node "$WORKDESK_CLI" desk current` names it) must exist and be newer than the last commit (`git log -1 --format=%ct`). If it is missing or older, run `/t-review` on the branch first. Its comments land in Review mode. Blockers it finds are told to the user, who decides: fix them first, or go on. Never go on without asking when there are blockers. Without `/t-review`, skip this step.
3. `gh pr view` to see if one exists. If not: `gh pr create --title "<title>" --body "<body>"`; otherwise `gh pr edit`.
4. Title: one line of what the user gets. Body: write it with `/t-pr-description` when that skill is there (it starts from the review scratch file: TLDR, what changed, from the outside, how to test, look closely); otherwise what and why, how it was tested, anything to look at first. Base it on `git log <base>..HEAD`.
5. No Claude or AI attribution in the title, body or comments.
6. Add the pull request to the WorkDesk you are working in, as yours: `node "$WORKDESK_CLI" pr add <url> --title "<title>"` (the URL `gh pr create` printed, or `gh pr view --json url -q .url`). It does nothing when the WorkDesk has it already. Without `$WORKDESK_CLI` (not a WorkDesk terminal), skip this and say so.
7. Give the user the link.

---
name: desk-review-to-pr
description: Turn the local review comments of this WorkDesk into a draft (pending) review on its GitHub pull request, written in the user's own review voice. Use for "send my review comments to the PR", "make PR comments from my notes", "draft the review on GitHub".
---

The local comments (`.review/comments.json`, shown in Review mode) are notes to yourself. This turns them into a **pending** GitHub review that only the user sees until they submit it themselves.

## Rules

- **Never submit.** Create the review without an `event` field (that is what makes it pending). Never send `COMMENT`, `APPROVE` or `REQUEST_CHANGES`, never use `gh pr review`, never resolve or delete anything on GitHub.
- No Claude or AI attribution anywhere in the comments or the summary.
- Do not invent findings and do not drop any: every local comment ends up on GitHub, inline or in the summary. Do not delete the local comments.

## Steps

1. **The pull request.** In the Branch folder: `gh pr view --json number,url,headRefOid,baseRefName,headRepositoryOwner,headRepository` (and `gh repo view --json nameWithOwner` for `owner/repo`). No PR yet: say so and stop (the `desk-pr` skill opens one). A desk with several Branch folders: do one folder at a time (`--root <project>`).
2. **The comments.** `node "$WORKDESK_CLI" review state [--root <project>]`; take `comments` (`path` relative to the folder, `line`, `text`) and `notes` (comments on the review as a whole). None of either: say so and stop.
3. **Is the code the PR's?** `git rev-parse HEAD` must equal `headRefOid`, and `git status --short` should be clean for the commented files. If not, tell the user the line numbers may not match the PR and ask whether to go on.
4. **Which lines GitHub accepts.** An inline comment only works on a line that is part of the PR diff, on the new (RIGHT) side. Get them:

   ```bash
   gh pr diff <number> | node -e '
   let path, n, out = []
   for (const l of require("fs").readFileSync(0, "utf8").split("\n")) {
     if (l.startsWith("+++ b/")) path = l.slice(6)
     else if (l.startsWith("@@")) n = +/\+(\d+)/.exec(l)[1]
     else if (path && n !== undefined && !l.startsWith("-") && !l.startsWith("\\")) { out.push(path + ":" + n); n++ }
   }
   console.log(out.join("\n"))'
   ```

   A comment whose `path:line` is in that list becomes an inline comment. The `notes` go into the review summary (`body`) first, in the user's voice. All others go into the review summary, each as `` `path:line` `` followed by its text, so nothing is lost.
5. **Write them in the user's voice.** Rewrite each note; keep the technical content exact (names, paths, code, suggested fix). If the user has a review-style section in their `CLAUDE.md` or memory, follow it. Otherwise: casual and direct, first person ("I'd …", "I guess … ?"), no bold headline sentence, short paragraphs, and for a bug a concrete "Lets say you …" walk-through. Keep the user's language. Never make a comment harsher or softer than the note, and do not add a finding that is not in it.
6. **Create the draft** (no `event`):

   ```bash
   cat > "$(mktemp -d)/review.json" <<'JSON'   # write to a temp file, e.g. in the scratchpad
   { "commit_id": "<headRefOid>",
     "body": "<short summary: the comments that could not be inline, with path:line>",
     "comments": [ { "path": "<path>", "line": <line>, "side": "RIGHT", "body": "<comment>" } ] }
   JSON
   gh api repos/<owner>/<repo>/pulls/<number>/reviews -X POST --input <that file>
   ```

   If GitHub answers that a pending review already exists, stop and tell the user (they can submit or delete it, then run this again). Any other error: show it as it is.
7. **Report:** the link `<pr url>` (the pending review shows at the top of the PR's "Files changed" tab), how many comments went inline and how many into the summary, and the rewritten texts so the user can check them. Remind them it is not submitted.

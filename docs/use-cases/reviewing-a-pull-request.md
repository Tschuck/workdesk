---
title: "Review a pull request"
description: "From the review request to your verdict."
sidebar_position: 5
---

# Review a pull request

**Goal:** review without losing your own work, and know when to come back.

1. **Find it.** Review requests from GitHub appear on the Dashboard and under *Work Items → Pull Requests*. Filter by state, hide drafts and dependency updates, skip what you do not care about.
2. **Start review.** Choose whether to check the branch out. Without a checkout nothing is cloned and the desk opens with a browser tab on the pull request; you can check the branch out later from *Details*.
3. **Read it.** Open the **Review tab**: the branch switcher, *Since base* (files changed against a base branch) and the *Working tree*, with the diff at full width. Step through files with *Previous* / *Next*; a *reviewed* tick per file counts progress.
4. **Comment.** Click the gutter for a line comment. Comments live in `.review/comments.json` at the root of the branch folder, so Claude can read them (`workdesk review state`) and turn them into a review summary.
5. **Submit on GitHub.** WorkDesk reads your verdict back: the desk's Stage turns to *Reviewed, waiting*, it moves to **Waiting**, and the Signals Claude raised while you worked are cleared.
6. **Come back by itself.** When the author asks again or answers, a Signal (*re-review requested*, *new review comments*) brings the desk back to Working, parked or not.

## Related

[Work items and sources](/features/work-items) · [Files and editor](/features/files-and-editor)

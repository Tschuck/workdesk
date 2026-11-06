---
name: desk-address-comments
description: Work through the review comments on this WorkDesk's branches and fix them. Use for "fix my review comments", "address the comments".
---

1. For each branch: `node "$WORKDESK_CLI" review state [--root <project>]`; the `comments` list has file, line and text. (They are kept in `.review/comments.json`; the Comments tab of Review lists them.)
2. Fix one at a time, small commits, and tell the user what you changed per comment. If a comment is unclear or you disagree, ask instead of guessing.
3. Do not delete comments yourself; the user clears them in Review mode once they agree.
4. Run the project's tests before saying you are done.

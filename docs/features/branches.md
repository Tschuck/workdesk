---
title: "Branches, stacks and .env files"
description: "Worktrees per branch, stacks, setup commands, pull requests of branches and the central .env store."
sidebar_position: 13
---

# Branches, stacks and .env files

## Worktrees

**Every branch has its own git worktree** inside the WorkDesk's folder, so nothing is ever switched. A WorkDesk can have several branches per Project. The first branch of a Project is in `<WorkDesk folder>/<project>/`, further ones in `<project>--2-<slug>/` and so on. The repositories are **Projects** (*Settings → Projects*): a bare clone in `.projects/<project>.git`, or a clone you already have.

**Commands after checkout.** Each Project can have commands (one per line, such as `pnpm install`) in *Settings → Projects*. Whenever a branch of it is checked out into a WorkDesk, a *Setup \<project\>* terminal tab opens in the branch folder and the commands are typed in, so you watch them run. They are chained (the first failure stops the rest) and the terminal stays open. Reactivating a parked WorkDesk does not run them again.

## Add and update branches

- **Add** on the Details tab (the **+** in *Branches*): type an existing name to check it out, or a new name to create it, optionally on top of another branch. Or use *Add to WorkDesk* on the *From branches* page.
- **Fetch** and **Pull** (fast-forward only) bring in what was pushed from elsewhere and show how far each branch is ahead or behind.
- **Stacks:** a branch added on top of another has a pull request that targets the previous branch, and the left panel shows the stack as a tree. When a base moves, a bar at the top of the WorkDesk names the branches that are behind it. Rebasing them (and force-pushing) is left to you, in their folders.

## Pull requests of a branch

Each branch row shows its pull request and where it stands (`PR #12 · open · ✓`): open, draft, merged or closed, whether checks pass, approvals and requested changes, and who is still asked to review. A branch without a pull request has a *Create* link that targets the branch it is stacked on. It needs a GitHub login and asks GitHub when you open the tab, then every two minutes.

The details of a branch list its pull requests with the same chips a review has (*approved*, *checks running*, *ready to merge*), worked out by one rule for both. The Branches section also has **Open pull requests (N)**: every open pull request of the WorkDesk's branches opens as its own browser tab in one go (one that is open already is reused). A review WorkDesk without a checkout has no branch, so its chips sit under the pull request link at the top.

## The From branches page

*From branches* (on *Work Items → Branches*) lists the existing branches of all your Projects, local and remote, with their last commit. It is the same list and detail pane as the Branches section of a WorkDesk, filtered to that WorkDesk there.

A branch's details show its commits, how far it is ahead of or behind the default branch, and whether it is merged. From there you can add it to an open WorkDesk or start a new one, **remove it from its WorkDesk** (this deletes the branch's folder after the same safety check as clearing; the branch is kept, and afterwards you are offered to delete it) and **delete it locally or on the remote**. A local branch is only deleted without force when all its commits are on a remote branch, deleting on the remote needs the branch name typed, and the default branch is never deleted.

## `.env` files

`.env` files are stored **once per Project** in a central store (`.env/<project>/…`, never in the Status Repo), linked into every new branch, and can be stored back, re-linked or **regenerated** with the Project's own setup commands (for example `pnpm apps:setup-env`). A differing local `.env` is never overwritten. Only files named exactly `.env` are handled, in any folder of the repository (`apps/*/.env`), and they are shared: editing one changes it everywhere.

Buttons in the Branches section of the Details tab (the same actions per branch behind the small `env` button):

- **Use as base for other Branches** copies the real `.env` files of this WorkDesk's branches into the store (per Project, the first branch that has real files; links are skipped).
- **Symlink the stored .env files** replaces this WorkDesk's `.env` files by links to the stored ones. **Force symlink** appears when a differing local file was kept.

A checkbox on each Project in *Settings → Projects* switches the sharing off for its new branches.

## A CLAUDE.md in every WorkDesk folder

WorkDesk writes and keeps current a block with the WorkDesk's name, Stage, Todos (with ticket or pull request links) and branches (stacks included), plus how it is handled: worktree per branch, never delete branches, `.env` from the store, findings go to `notes/`. Claude Code reads it, because it looks in the parent folders of where it runs. Write your own instructions **below** the generated block; they are never touched, and they are kept in the archive when the WorkDesk is cleared.

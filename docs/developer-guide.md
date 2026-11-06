---
title: "Developer guide"
description: "How to run, build, test and package WorkDesk, and how it is built."
---

# Developer guide

For building and changing WorkDesk. Changes are welcome: see `CONTRIBUTING.md` in the repository for the rules (checks to run, sign-off, the license of contributions). The vocabulary used in code and docs (WorkDesk, Stage, Signal, Status Repo, …) is in `CONTEXT.md`.

## Requirements
| | |
|---|---|
| macOS | Apple Silicon build; Intel needs the `arch` in `electron-builder.yml` changed |
| Node.js 22 and [pnpm](https://pnpm.io) 11 | for development |
| `git`, `tmux`, VS Code with the `code` command on the PATH | needed at runtime; the app checks for them on start |
| `gh` (optional) | GitHub login without a token (`gh auth login`) |

## Run it
```bash
pnpm install       # also rebuilds node-pty for Electron
pnpm dev           # starts the app with hot reload
```

| Script | What it does |
|---|---|
| `pnpm dev` | run the app in development |
| `pnpm test` | unit and integration tests (Vitest) |
| `pnpm typecheck` | TypeScript check of main, preload and renderer |
| `pnpm build` | build main, preload and renderer into `out/` |
| `pnpm package` | build an unsigned `.dmg` into `dist/` |
| `pnpm package:dir` | build just the `.app` into `dist/mac-arm64/` (faster) |
| `pnpm icons` | regenerate `build/icon.icns` from `assets/logo.svg` (needs `brew install librsvg`) |

pnpm blocks dependency build scripts by default. The ones WorkDesk needs are allowed in `pnpm-workspace.yaml` (`node-pty`).

## Configuration
| Variable | Default | Meaning |
|---|---|---|
| `WORKDESK_ROOT` | `~/workdesk` | the WorkDesk root folder (see below) |
| `WORKDESK_SEED` | unset | set to `1` to add in-memory demo WorkDesks and Todos (Signals, Stages, a stack) to look at the UI; the screenshots above were made with it |
| `WORKDESK_NO_USAGE` | unset | set to `1` to not start the hidden Claude sessions that read the usage |
| `WORKDESK_TMUX_SOCKET` | `workdesk` | name of the tmux server the terminals run on (`tmux -L <name>`); another name gives a separate instance |
| `WORKDESK_SOCKET` | `~/Library/Application Support/WorkDesk/hook.sock` | unix socket for Claude hook events |

## How it is built
```
src/
  main/            Electron main process
    domain/        pure, tested logic: Stage, Signal, order, layout, Todos, Stacks, PR review state, desk checklist, reminders, What next? …
    status/        the Status Repo, debounced auto-commit and push (behind a Git interface)
    projects/      Projects, worktrees, clearing (behind a RepoGit interface)
    terminal/      tmux (own server), node-pty, Tabs and Panes
    editor/        VS Code window control and the .code-workspace file
    claude/        hook socket server, hook installer, sessions, focus acknowledgement
    sources/       GitHub (REST via gh or token), Notion (OAuth), polling, Candidates
    env/           the central .env store
    service.ts     application state: Todos and WorkDesks on top of the Status Repo
    index.ts       window, IPC handlers, wiring
  preload/         the typed bridge exposed to the renderer
  renderer/        React UI
  shared/          IPC channel names, the API type, the setup checklist
cli/workdesk.mjs   the hook command Claude Code calls (plain Node, no dependencies)
docs/adr/          architecture decision records
```
- **Shape of the code.** Logic that can be pure is pure (`domain/`). Everything that touches the outside world (git, tmux, HTTP, the Keychain, AppleScript, pty) sits behind a small interface, so tests use fakes or real tools in temporary folders.
- **IPC.** The renderer only talks to the main process through the typed `WorkDeskApi` in `src/shared/api.ts`.
- **Terminals.** Each WorkDesk is a tmux session, each Pane a window. A Pane is shown through a grouped view session attached to a node-pty, so several Panes of one WorkDesk can be visible at once and the shells outlive the app.
- **Claude detection.** Hook events reach the app over a unix socket and are matched to a WorkDesk by the working directory (`ADR 0003`).

## Tests
`pnpm test` runs about 150 tests. They use real `git` repositories in temp folders, a real local callback server for the OAuth flow, and a real `tmux` on a throw-away socket (skipped if `tmux` is missing). `node-pty` itself only runs inside Electron, so it is not loaded in the tests.

## Package and release
```bash
pnpm package            # unsigned .dmg in dist/
```
Pushing a tag `v*` runs `the release workflow`: it installs, type-checks, tests, builds the `.dmg` and attaches it to a GitHub Release.
```bash
git tag v0.1.0 && git push origin v0.1.0
```
The app is **unsigned** (no Apple developer certificate). On first start right-click the app and choose *Open*, or run `xattr -dr com.apple.quarantine /Applications/WorkDesk.app`.

## Troubleshooting
| Problem | Fix |
|---|---|
| `[ERR_PNPM_IGNORED_BUILDS]` on install | build scripts must be allowed: check `allowBuilds` in `pnpm-workspace.yaml` |
| "Downloading Electron binary…" and then nothing | `node node_modules/electron/install.js`, then `pnpm exec electron-rebuild -f -w node-pty` |
| "tmux is not installed" although it is | the app adds Homebrew's folders to its PATH; check `tmux -V` in a terminal and that it is in `/opt/homebrew/bin` or `/usr/local/bin` |
| Terminal shows an error right away | WorkDesk uses its own tmux server; stale sessions can be listed with `tmux -L workdesk ls` and removed with `tmux -L workdesk kill-server` |
| The editor does not show over the content | allow the app under *Accessibility* (see above); another VS Code window may also be covering it |
| `Ctrl+←/→` does nothing | macOS reserves them for Mission Control: turn off *Move left/right a space* under *System Settings → Keyboard → Keyboard Shortcuts → Mission Control* (or use `Option+←/→`) |
| No Claude Signals | *Claude hooks* page: is the config dir registered and *installed*? The cwd of Claude must lie inside the WorkDesk's folder |

## The documentation site

The docs are this folder (`docs/`), built with [Docusaurus](https://docusaurus.io) from `website/`. It has its own dependencies, so the app's install is not touched.

```bash
pnpm --dir website install --ignore-workspace   # once
pnpm docs:dev                                   # live preview at http://localhost:3000
pnpm docs:build                                 # the production build, with a strict check of every link and image
```

`pnpm docs:build` fails on a broken link or image, so run it before committing docs. Search only works in the production build: `pnpm --dir website serve` serves `website/build/`.

Pages are Markdown with a small front matter (`title`, `description`, `sidebar_position`). Put a feature in the page of its topic under `docs/features/`, a walkthrough in `docs/use-cases/`, and images in `docs/img/`. The site is published by `.github/workflows/docs.yml` to GitHub Pages on every push to `main` that touches `docs/` or `website/`.

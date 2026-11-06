import { mkdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { STATUS_REPO_NAME, type StatusRepo, type StoredDesk } from '../status/status-repo'
import type { BranchWorktree } from '../domain/types'
import { EnvStore } from '../env/env-store'
import { readOwnText } from '../desk-guide'
import { deskDir, worktreeDirName } from './layout'
import type { Project } from './projects'
import type { RepoGit } from './repo-git'

export type { BranchWorktree }

/** Create the WorkDesk folder and its `notes` link into the Status Repo. */
export async function ensureDeskFolder(root: string, deskId: string, statusDir = join(root, STATUS_REPO_NAME)): Promise<string> {
  const dir = deskDir(root, deskId)
  await mkdir(dir, { recursive: true })
  const notes = join(dir, 'notes')
  const notesDir = join(statusDir, 'desks', deskId, 'notes')
  // the home Status Repo is next to the WorkDesks (a relative link, as always); another one is linked by its full path
  const target = dirname(statusDir) === root ? join('..', STATUS_REPO_NAME, 'desks', deskId, 'notes') : notesDir
  await mkdir(notesDir, { recursive: true })
  try {
    await readlink(notes)
  } catch {
    await symlink(target, notes)
  }
  return dir
}

/** Check out a Branch in its own worktree inside the WorkDesk folder and link the project files. */
export async function createBranchWorktree(
  git: RepoGit,
  root: string,
  deskId: string,
  project: Project,
  existing: readonly BranchWorktree[],
  branch: string,
  base?: string
): Promise<BranchWorktree> {
  if (existing.some((w) => w.project === project.name && w.branch === branch)) {
    throw new Error(`Branch ${branch} of ${project.name} is already in this WorkDesk`)
  }
  const dir = await ensureDeskFolder(root, deskId)
  const index = existing.filter((w) => w.project === project.name).length + 1
  const path = join(dir, worktreeDirName(project.name, index, branch))
  await git.addWorktree(project.gitDir, path, branch, base)
  // stored `.env` files are linked into every new Branch (unless the Project switched that off); a problem here must not block the Branch
  try {
    if (project.sharedEnv !== false) {
      const { linked } = await new EnvStore(root).link(project.name, path)
      if (linked.length > 0) await git.excludeLocally(path, linked)
    }
  } catch {
    // the explicit "link .env" action reports problems
  }
  return { project: project.name, branch, path, index, base }
}

export interface PreflightIssue {
  project: string
  branch: string
  kind: 'uncommitted' | 'untracked' | 'unpushed' | 'no-remote' | 'env' | 'broken'
  /** files for uncommitted/untracked, commit count for unpushed */
  detail: string[] | number
}

/** Everything that would be lost or not yet shared when the WorkDesk is cleared. */
export async function preflight(git: RepoGit, worktrees: readonly BranchWorktree[]): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = []
  for (const w of worktrees) {
    const base = { project: w.project, branch: w.branch }
    let uncommitted: string[]
    let untracked: string[]
    let push: Awaited<ReturnType<RepoGit['pushState']>>
    try {
      ;({ uncommitted, untracked } = await git.status(w.path))
      push = await git.pushState(w.path)
    } catch (err) {
      // the folder is gone or no longer a git work tree: nothing git could tell, so it is named instead of failing the clear
      const line = ((err as { stderr?: string }).stderr ?? (err as Error).message).trim().split('\n').filter(Boolean).slice(-1)[0]
      issues.push({ ...base, kind: 'broken', detail: [line || 'not a git work tree'] })
      continue
    }
    if (uncommitted.length) issues.push({ ...base, kind: 'uncommitted', detail: uncommitted })
    if (untracked.length) issues.push({ ...base, kind: 'untracked', detail: untracked })
    if (!push.hasUpstream) issues.push({ ...base, kind: 'no-remote', detail: 0 })
    else if (push.ahead > 0) issues.push({ ...base, kind: 'unpushed', detail: push.ahead })
  }
  return issues
}

/**
 * Clear a WorkDesk after the user approved the pre-flight: archive notes, final Stage and
 * Claude session IDs, remove the worktrees and the desk folder. Branches are never deleted.
 */
export async function clearDesk(
  git: RepoGit,
  status: Pick<StatusRepo, 'archiveDesk'>,
  root: string,
  desk: StoredDesk,
  worktrees: readonly BranchWorktree[],
  projects: readonly Project[],
  claudeSessionIds: string[],
  date: string
): Promise<string> {
  const dir = resolve(deskDir(root, desk.id))
  if (!dir.startsWith(resolve(root) + sep) || dir === resolve(root)) {
    throw new Error(`Refusing to clear ${dir}: not inside the WorkDesk root`)
  }
  const own = await readOwnText(root, desk.id)
  const archived = await status.archiveDesk(desk, claudeSessionIds, date)
  // what you wrote into the WorkDesk's CLAUDE.md outlives the folder
  if (own) await writeFile(join(archived, 'CLAUDE.md'), own + '\n')
  for (const w of worktrees) {
    const project = projects.find((p) => p.name === w.project)
    if (!project) throw new Error(`Unknown Project ${w.project}`)
    await git.removeWorktree(project.gitDir, w.path)
  }
  // the notes link is removed, not followed
  await rm(dir, { recursive: true, force: true })
  return archived
}


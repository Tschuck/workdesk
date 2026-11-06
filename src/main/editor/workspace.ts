import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { deskDir } from '../projects/layout'
import type { BranchWorktree } from '../domain/types'

export interface WorkspaceFile {
  folders: { name: string; path: string }[]
  settings: Record<string, unknown>
}

export const workspacePath = (root: string, deskId: string): string => join(deskDir(root, deskId), `${deskId}.code-workspace`)

/** One folder per Branch (relative to the WorkDesk folder), plus the notes. */
export function buildWorkspace(deskDirPath: string, branches: readonly BranchWorktree[]): WorkspaceFile {
  const perProject = new Map<string, number>()
  for (const b of branches) perProject.set(b.project, (perProject.get(b.project) ?? 0) + 1)
  return {
    folders: [
      ...branches.map((b) => ({
        name: (perProject.get(b.project) ?? 0) > 1 ? `${b.project} · ${b.branch}` : b.project,
        path: relative(deskDirPath, b.path) || basename(b.path)
      })),
      { name: 'notes', path: 'notes' }
    ],
    settings: {}
  }
}

/** Keep the WorkDesk's `.code-workspace` in sync with its Branches; returns true when it changed. */
export async function syncWorkspace(root: string, deskId: string, branches: readonly BranchWorktree[]): Promise<boolean> {
  const file = workspacePath(root, deskId)
  const next = JSON.stringify(buildWorkspace(deskDir(root, deskId), branches), null, 2) + '\n'
  const current = await readFile(file, 'utf8').catch(() => undefined)
  if (current === next) return false
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, next)
  return true
}

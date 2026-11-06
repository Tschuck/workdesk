import { resolve, sep } from 'node:path'
import type { WorkDesk } from './types'

export interface CwdMatch {
  deskId: string
  /** worktree folder of the Branch the cwd lies in, when it lies in one */
  branchPath?: string
}

const inside = (dir: string, path: string): boolean => {
  const d = resolve(dir)
  const p = resolve(path)
  return p === d || p.startsWith(d.endsWith(sep) ? d : d + sep)
}

/** A hook event belongs to the WorkDesk whose folder holds the working directory. */
export function matchCwd(root: string, desks: readonly Pick<WorkDesk, 'id' | 'branches'>[], cwd: string): CwdMatch | undefined {
  const desk = desks.find((d) => inside(resolve(root, d.id), cwd))
  if (!desk) return undefined
  const branch = [...desk.branches].sort((a, b) => b.path.length - a.path.length).find((b) => inside(b.path, cwd))
  return { deskId: desk.id, branchPath: branch?.path }
}

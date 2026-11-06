import { buildDeskTree, flattenBranches } from './tree'
import type { BranchWorktree, WorkDesk } from './types'

export interface RestackStep {
  project: string
  branch: string
  onto: string
}

/** Branch name of a Ticket WorkDesk: the ticket key, made safe for git. */
export function ticketBranchName(key: string): string {
  const name = key.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9._/-]/g, '').replace(/^[-./]+|[-./]+$/g, '').replace(/\.\.+/g, '.')
  if (!name) throw new Error(`"${key}" cannot be used as a branch name`)
  return name
}

/** The Pull Request of a Branch targets the Branch it is based on, else the default branch. */
export function prBase(branch: Pick<BranchWorktree, 'base'>): string | undefined {
  return branch.base
}

/** Branches of a WorkDesk in Stack order: every Branch comes after its base. */
export function stackOrder(desk: Pick<WorkDesk, 'branches'>): BranchWorktree[] {
  return buildDeskTree(desk).flatMap((p) => flattenBranches(p.branches).map((n) => n.branch))
}

/** Which Branches have to be rebased, given which (base, branch) pairs are out of line. */
export function restackSteps(desk: Pick<WorkDesk, 'branches'>, behind: (b: BranchWorktree) => boolean): RestackStep[] {
  const stale = new Set<string>()
  const steps: RestackStep[] = []
  for (const b of stackOrder(desk)) {
    if (!b.base) continue
    // a rebased base moves, so everything above it has to follow
    if (stale.has(`${b.project}/${b.base}`) || behind(b)) {
      stale.add(`${b.project}/${b.branch}`)
      steps.push({ project: b.project, branch: b.branch, onto: b.base })
    }
  }
  return steps
}

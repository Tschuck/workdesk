import type { BranchWorktree, WorkDesk } from './types'

export interface BranchNode {
  branch: BranchWorktree
  children: BranchNode[]
}

export interface ProjectNode {
  project: string
  branches: BranchNode[]
}

/** Sidebar tree of one WorkDesk: Project, then Branches indented by their base (the Stack). */
export function buildDeskTree(desk: Pick<WorkDesk, 'branches'>): ProjectNode[] {
  const projects: ProjectNode[] = []
  for (const name of [...new Set(desk.branches.map((b) => b.project))]) {
    const own = desk.branches.filter((b) => b.project === name)
    const nodes = new Map(own.map((b) => [b.branch, { branch: b, children: [] as BranchNode[] }]))
    const roots: BranchNode[] = []
    for (const node of nodes.values()) {
      const parent = node.branch.base ? nodes.get(node.branch.base) : undefined
      if (parent && parent !== node) parent.children.push(node)
      else roots.push(node)
    }
    projects.push({ project: name, branches: roots })
  }
  return projects
}

/** Flatten a Stack from base to tip. */
export function flattenBranches(nodes: readonly BranchNode[]): BranchNode[] {
  return nodes.flatMap((n) => [n, ...flattenBranches(n.children)])
}

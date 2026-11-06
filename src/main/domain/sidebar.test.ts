import { describe, expect, it } from 'vitest'
import { deskAtShortcut, freezeOrder } from './navigation'
import { moveBefore } from './order'
import { buildDeskTree, flattenBranches } from './tree'
import type { BranchWorktree, WorkDesk } from './types'

const b = (project: string, branch: string, base?: string): BranchWorktree => ({ project, branch, base, path: '/x', index: 1 })
const d = (id: string, priority = 0): WorkDesk => ({
  id, name: id, stage: 'implement', stageOverridden: false, priority,
  presence: 'inactive', todoIds: [], branches: [], signals: [], createdAt: 0
})

describe('desk tree', () => {
  it('groups by Project and nests Branches by base', () => {
    const tree = buildDeskTree({
      branches: [b('api', 'one'), b('web', 'w1'), b('api', 'two', 'one'), b('api', 'three', 'two'), b('api', 'side')]
    })
    expect(tree.map((p) => p.project)).toEqual(['api', 'web'])
    const api = tree[0].branches
    expect(api.map((n) => n.branch.branch)).toEqual(['one', 'side'])
    expect(flattenBranches(api).map((n) => n.branch.branch)).toEqual(['one', 'two', 'three', 'side'])
    expect(api[0].children[0].children[0].branch.branch).toBe('three')
  })

  it('treats a base outside the WorkDesk as a root', () => {
    const [p] = buildDeskTree({ branches: [b('api', 'x', 'main')] })
    expect(p.branches.map((n) => n.branch.branch)).toEqual(['x'])
  })
})

describe('navigation', () => {
  const desks = [d('a'), d('b'), d('c')]
  it('maps ⌘1…9', () => {
    expect(deskAtShortcut(desks, 2)?.id).toBe('b')
    expect(deskAtShortcut(desks, 4)).toBeUndefined()
    expect(deskAtShortcut(desks, 0)).toBeUndefined()
  })
})

describe('order frozen during drag', () => {
  it('keeps the drag-start order, appends new, drops removed', () => {
    const now = [d('c'), d('a'), d('n')]
    expect(freezeOrder(now, ['a', 'b', 'c']).map((x) => x.id)).toEqual(['a', 'c', 'n'])
    expect(freezeOrder(now, null).map((x) => x.id)).toEqual(['c', 'a', 'n'])
  })
})

describe('drag and drop priority', () => {
  it('moves a desk before the target in manual priority', () => {
    const desks = [d('a', 0), d('b', 1), d('c', 2)]
    const byPriority = (xs: WorkDesk[]) => [...xs].sort((x, y) => x.priority - y.priority).map((x) => x.id)
    expect(byPriority(moveBefore(desks, 'c', 'a'))).toEqual(['c', 'a', 'b'])
    expect(byPriority(moveBefore(desks, 'a', 'c'))).toEqual(['b', 'a', 'c'])
    expect(byPriority(moveBefore(desks, 'a', 'a'))).toEqual(['a', 'b', 'c'])
    expect(() => moveBefore(desks, 'a', 'zzz')).toThrow()
  })
})

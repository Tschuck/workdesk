import { describe, expect, it } from 'vitest'
import type { FileRoot } from '../main/files'
import { branchOf, scopedRoots } from './scope'

const roots: FileRoot[] = [
  { label: 'api/one', path: '/w/api-one' },
  { label: 'api/two', path: '/w/api-two' },
  { label: 'notes', path: '/w/notes', plain: true },
  { label: 'scratch', path: '/w/scratch', scratch: true }
]

describe('scope', () => {
  it('keeps one branch with the notes and scratch, or everything without a scope', () => {
    expect(scopedRoots(roots, '/w/api-two').map((r) => r.label)).toEqual(['api/two', 'notes', 'scratch'])
    expect(scopedRoots(roots, undefined)).toBe(roots)
    expect(scopedRoots(roots, '/gone')).toBe(roots)
    expect(scopedRoots(roots.slice(0, 1), '/w/api-one')).toHaveLength(1)
  })

  it('tells which branch a path is in, only when there are several', () => {
    expect(branchOf(roots, '/w/api-two/src/a.ts')?.label).toBe('api/two')
    expect(branchOf(roots, '/w/api-two')?.label).toBe('api/two')
    expect(branchOf(roots, '/w/api-twofold/a.ts')).toBeUndefined()
    expect(branchOf(roots, '/w/notes/a.md')).toBeUndefined()
    expect(branchOf(roots.slice(0, 1), '/w/api-one/a.ts')).toBeUndefined()
  })
})

import { branchChip } from './scope'
describe('branch chip', () => {
  it('drops the shared project, cuts long names at the front and colours each branch', () => {
    expect(branchChip(roots, roots[1])).toMatchObject({ text: 'two', title: 'api/two' })
    expect(branchChip([{ label: 'a/x', path: '/a' }, { label: 'b/y', path: '/b' }], { label: 'b/y', path: '/b' }).text).toBe('b/y')
    expect(branchChip([{ label: 'a/feature/very-long-branch-name-123', path: '/a' }, { label: 'a/two', path: '/b' }], { label: 'a/feature/very-long-branch-name-123', path: '/a' }).text).toBe('…' + 'feature/very-long-branch-name-123'.slice(-15))
    expect(branchChip(roots, roots[0]).color).not.toBe(branchChip(roots, roots[1]).color)
  })
})

import { groupedOrder } from './scope'
describe('grouped order', () => {
  it('keeps the first tabs, then one run per branch, then the tabs without one', () => {
    const tabs = [{ id: 'd', kind: 'details' }, { id: 'a', kind: 'panes' }, { id: 'b', kind: 'panes' }, { id: 'c', kind: 'panes' }, { id: 'p', kind: 'panes', pinned: true }, { id: 'e', kind: 'panes' }]
    const of: Record<string, string | undefined> = { a: '/two', b: '/one', c: '/two', e: undefined }
    expect(groupedOrder(tabs, (t) => of[t.id], ['/one', '/two']).map((t) => t.id)).toEqual(['d', 'p', 'b', 'a', 'c', 'e'])
  })
})

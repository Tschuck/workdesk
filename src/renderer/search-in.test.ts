import { describe, expect, it } from 'vitest'
import { foldersOf, searchRoots } from './search-in'

const roots = [
  { label: 'acme-api/feature/X-1', path: '/w/backend' },
  { label: 'notes', path: '/w/notes', plain: true },
  { label: 'knowledge', path: '/s/knowledge', plain: true }
]

describe('Search in', () => {
  it('is every root when nothing is typed', () => {
    expect(searchRoots(roots, '')).toEqual(roots)
    expect(searchRoots(roots, '  /')).toEqual(roots)
  })
  it('drills down from a root, also one whose name has slashes', () => {
    expect(searchRoots(roots, 'knowledge')).toEqual([roots[2]])
    expect(searchRoots(roots, 'knowledge/sub/')).toEqual([{ ...roots[2], path: '/s/knowledge/sub', label: 'knowledge/sub' }])
    expect(searchRoots(roots, 'acme-api/feature/X-1/src/app')).toEqual([{ ...roots[0], path: '/w/backend/src/app', label: 'acme-api/feature/X-1/src/app' }])
  })
  it('takes a start of a root name for every root it fits, anything else for none, and never leaves the root', () => {
    expect(searchRoots(roots, 'acme')).toEqual([roots[0]])
    expect(searchRoots(roots, 'Kn')).toEqual([roots[2]])
    expect(searchRoots(roots, 'nope')).toEqual([])
    expect(searchRoots(roots, 'knowledge/../notes')).toEqual([])
  })
  it('suggests every folder above the files', () => {
    expect(foldersOf('knowledge', ['a.md', 'x/y/b.md', 'x/c.md'])).toEqual(['knowledge', 'knowledge/x', 'knowledge/x/y'])
  })
})

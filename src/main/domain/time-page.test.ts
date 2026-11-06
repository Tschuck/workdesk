import { describe, expect, it } from 'vitest'
import { deskOfEditorPath, deskOfPage, isIdleOnDesk } from './time-tracking'

const desks = [
  { id: 'rev', reviews: [{ url: 'https://github.com/o/r/pull/806' }], items: [{ url: 'https://github.com/o/r/pull/806' }] },
  { id: 'feat', items: [{ url: 'https://www.notion.so/ticket-1' }, {}], refs: [{ url: 'https://docs.example.com/spec' }] },
  { id: 'none' }
]

describe('which WorkDesk a page of the Browser counts for', () => {
  it('is the one that reviews or holds the pull request, also its sub-pages, query and fragment aside', () => {
    expect(deskOfPage(desks, 'https://github.com/o/r/pull/806')).toBe('rev')
    expect(deskOfPage(desks, 'https://github.com/o/r/pull/806/files?w=1#diff')).toBe('rev')
    expect(deskOfPage(desks, 'https://GitHub.com/o/r/pull/806/')).toBe('rev')
  })
  it('is the one a page is attached to, or whose ticket it is', () => {
    expect(deskOfPage(desks, 'https://docs.example.com/spec#intro')).toBe('feat')
    expect(deskOfPage(desks, 'https://www.notion.so/ticket-1')).toBe('feat')
  })
  it('is none for another pull request (806 is not 8061), another page, a blank tab or a non-web address', () => {
    expect(deskOfPage(desks, 'https://github.com/o/r/pull/8061')).toBeUndefined()
    expect(deskOfPage(desks, 'https://example.org/')).toBeUndefined()
    expect(deskOfPage(desks, 'about:blank')).toBeUndefined()
    expect(deskOfPage(desks, 'file:///etc/hosts')).toBeUndefined()
  })
})

describe('idle in a WorkDesk', () => {
  it('is five minutes without input while its window is in front', () => {
    expect(isIdleOnDesk({ shownDesk: 'd', idleSeconds: 300 })).toBe(true)
    expect(isIdleOnDesk({ shownDesk: 'd', idleSeconds: 299 })).toBe(false)
    expect(isIdleOnDesk({ shownDesk: 'd', idleSeconds: 900, locked: true })).toBe(false)
    expect(isIdleOnDesk({ idleSeconds: 900 })).toBe(false)
  })
})

describe('deskOfEditorPath', () => {
  const desks = [{ id: 'a', branches: [{ path: '/w/a/api' }] }, { id: 'b', branches: [{ path: '/w/b/web' }] }]
  const dir = (id: string) => `/w/${id}`
  it('finds the desk of a workspace file, a folder URI or a Branch folder', () => {
    expect(deskOfEditorPath(desks, dir, 'file:///w/a/a.code-workspace')).toBe('a')
    expect(deskOfEditorPath(desks, dir, 'file:///w/b/web/src')).toBe('b')
    expect(deskOfEditorPath(desks, dir, '/w/b')).toBe('b')
  })
  it('knows no desk for other folders, also not for a name that only starts the same', () => {
    expect(deskOfEditorPath(desks, dir, 'file:///elsewhere/x')).toBeUndefined()
    expect(deskOfEditorPath(desks, dir, '/w/ab/x')).toBeUndefined()
  })
})

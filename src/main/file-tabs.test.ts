import { describe, expect, it } from 'vitest'
import { activateFileTab, closeFileTab, newFileTab, openFile, parseFileTabs, setFilePath } from './domain/file-tabs'

const empty = { tabs: [] }

describe('tabs of the Files page', () => {
  it('open a file in an empty tab that is shown, else in a new tab, and go to the one that has it', () => {
    const one = newFileTab(empty, 'a')
    const opened = openFile(one, '/x/a.md', 'b')
    expect(opened).toEqual({ tabs: [{ id: 'a', path: '/x/a.md' }], active: 'a' })
    const two = openFile(opened, '/x/b.md', 'b', 7)
    expect(two).toEqual({ tabs: [{ id: 'a', path: '/x/a.md' }, { id: 'b', path: '/x/b.md', line: 7 }], active: 'b' })
    const back = openFile(two, '/x/a.md', 'c', 3)
    expect(back.active).toBe('a')
    expect(back.tabs[0]).toEqual({ id: 'a', path: '/x/a.md', line: 3 })
    expect(openFile(back, '/x/a.md', 'c').tabs[0]).toEqual({ id: 'a', path: '/x/a.md' })
  })

  it('show another file in the same tab, and the file tree again without one', () => {
    const s = openFile(newFileTab(empty, 'a'), '/x/a.md', 'z', 4)
    expect(setFilePath(s, 'a', '/x/b.md').tabs[0]).toEqual({ id: 'a', path: '/x/b.md' })
    expect(setFilePath(s, 'a', undefined).tabs[0]).toEqual({ id: 'a' })
  })

  it('close, and show the neighbour; the last one leaves nothing shown', () => {
    const s = openFile(openFile(newFileTab(empty, 'a'), '/1', 'a'), '/2', 'b')
    expect(closeFileTab(s, 'b').active).toBe('a')
    expect(closeFileTab(openFile(s, '/3', 'c'), 'b').active).toBe('c')
    expect(closeFileTab(closeFileTab(s, 'b'), 'a')).toEqual({ tabs: [] })
    expect(closeFileTab(s, 'nope')).toBe(s)
    expect(activateFileTab(s, 'a').active).toBe('a')
    expect(activateFileTab(s, 'nope')).toBe(s)
  })

  it('are read from the storage, whatever it holds', () => {
    expect(parseFileTabs(null)).toEqual({ tabs: [] })
    expect(parseFileTabs({ tabs: [{ id: 'a', path: '/x', line: 2 }, { id: 5 }, 'x', { id: 'b', path: '' }], active: 'zzz' })).toEqual({ tabs: [{ id: 'a', path: '/x', line: 2 }, { id: 'b' }], active: 'a' })
  })
})

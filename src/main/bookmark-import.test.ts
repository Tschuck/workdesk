import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BookmarkImport } from './bookmark-import'
import { countPages, importBookmarks, importItems, parseChromiumBookmarks, treeFromFirefoxRows } from './domain/bookmark-import'
import { addBookmark } from './domain/bookmarks'

const chromium = {
  roots: {
    bookmark_bar: {
      type: 'folder',
      name: 'Bookmarks bar',
      children: [
        { type: 'url', name: 'Loose', url: 'https://loose.test' },
        { type: 'folder', name: 'Work', children: [{ type: 'url', name: 'Docs', url: 'https://docs.test' }, { type: 'folder', name: 'Deep', children: [{ type: 'url', name: 'Wiki', url: 'https://wiki.test' }] }] },
        { type: 'folder', name: 'Empty', children: [] },
        { type: 'url', name: 'Script', url: 'javascript:alert(1)' }
      ]
    },
    other: { type: 'folder', name: 'Other bookmarks', children: [{ type: 'url', name: '', url: 'https://other.test' }] },
    trash: { type: 'folder', name: 'Trash', children: [{ type: 'url', name: 'Gone', url: 'https://gone.test' }] },
    sync_transaction_version: '3'
  }
}

describe('Vivaldi (Chromium) bookmarks', () => {
  const tree = parseChromiumBookmarks(chromium)
  it('keeps folders and http(s) pages, leaves out empty folders, the trash and scripts', () => {
    expect(tree.map((n) => n.type === 'folder' && n.name)).toEqual(['Bookmarks bar', 'Other bookmarks'])
    expect(countPages(tree)).toBe(4)
  })
  it('turns a tree into pages with their folders, the top level not being part of it', () => {
    expect(importItems(tree).map((i) => [i.title, i.group])).toEqual([['Loose', ''], ['Docs', 'Work'], ['Wiki', 'Work / Deep'], ['https://other.test', '']])
  })
  it('is empty for anything else', () => {
    expect(parseChromiumBookmarks(null)).toEqual([])
    expect(parseChromiumBookmarks({ roots: 5 })).toEqual([])
  })
})

describe('Firefox bookmarks', () => {
  it('builds the folders under the root from the rows of the places database', () => {
    const rows = [
      { id: 1, type: 2, parent: 0, title: '', url: null },
      { id: 2, type: 2, parent: 1, title: 'menu', url: null },
      { id: 3, type: 2, parent: 1, title: 'toolbar', url: null },
      { id: 4, type: 1, parent: 3, title: 'Site', url: 'https://site.test' },
      { id: 5, type: 2, parent: 3, title: 'Work', url: null },
      { id: 6, type: 1, parent: 5, title: null, url: 'https://work.test' },
      { id: 7, type: 1, parent: 5, title: 'Query', url: 'place:sort=8' },
      { id: 8, type: 3, parent: 3, title: null, url: null }
    ]
    const tree = treeFromFirefoxRows(rows)
    expect(tree.map((n) => n.type === 'folder' && n.name)).toEqual(['toolbar'])
    expect(importItems(tree).map((i) => [i.title, i.group])).toEqual([['Site', ''], ['https://work.test', 'Work']])
  })
})

describe('importing', () => {
  it('adds the pages with their groups and leaves the favorites that exist', () => {
    const list = addBookmark([], 'Mine', 'https://docs.test/', 'x')
    let n = 0
    const r = importBookmarks(list, importItems(parseChromiumBookmarks(chromium)), () => `id${++n}`)
    expect(r.added).toBe(3)
    expect(r.skipped).toBe(1)
    expect(r.list.find((b) => b.url === 'https://wiki.test')).toMatchObject({ title: 'Wiki', group: 'Work / Deep' })
    expect(r.list.find((b) => b.id === 'x')?.title).toBe('Mine')
    expect('group' in r.list.find((b) => b.url === 'https://loose.test')!).toBe(false)
  })
})

describe('finding the browsers on the disk', () => {
  let dir: string
  beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'workdesk-imp-'))))
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('lists the Vivaldi profiles that have bookmarks, by the name they were given, and reads them', async () => {
    await mkdir(join(dir, 'Vivaldi', 'Profile 1'), { recursive: true })
    await mkdir(join(dir, 'Vivaldi', 'Crashpad'), { recursive: true })
    await writeFile(join(dir, 'Vivaldi', 'Profile 1', 'Bookmarks'), JSON.stringify(chromium))
    await writeFile(join(dir, 'Vivaldi', 'Profile 1', 'Preferences'), JSON.stringify({ profile: { name: 'Work' } }))
    const imp = new BookmarkImport(dir)
    expect(await imp.sources()).toEqual([{ id: 'vivaldi:Profile 1', browser: 'vivaldi', label: 'Vivaldi: Work (Profile 1)' }])
    expect(countPages(await imp.read('vivaldi:Profile 1'))).toBe(4)
    await expect(imp.read('vivaldi:../../etc')).rejects.toThrow(/Unknown/)
  })
})

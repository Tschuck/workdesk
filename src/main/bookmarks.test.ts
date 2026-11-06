import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BookmarksService } from './bookmarks-service'
import { DEFAULT_GROUP_SETTINGS, collapseAll, isCollapsed, moveGroup, orderGroups, parseGroupSettings, toggleGroup } from './domain/bookmark-groups'
import { renameInSettings } from './domain/bookmark-groups'
import { renameGroup } from './domain/bookmarks'
import { findBrowserPage } from './domain/layout'
import { samePage } from './domain/url'
import { rankBookmarks, sectionsInOrder } from './domain/bookmarks'
import { addBookmark, filterBookmarks, findBookmark, groupBookmarks, parseBookmarks, removeBookmark, renameBookmark, setBookmarkGroup, setBookmarkIcon, setBookmarkUrl } from './domain/bookmarks'

describe('bookmark list', () => {
  it('adds pages once, ignoring a trailing slash or fragment, and keeps the newest title', () => {
    let l = addBookmark([], 'GitHub', 'https://github.com/', 'a')
    l = addBookmark(l, ' Home ', 'https://github.com#top', 'b')
    expect(l).toEqual([{ id: 'a', title: 'Home', url: 'https://github.com/' }])
    expect(findBookmark(l, 'https://github.com')?.id).toBe('a')
    expect(addBookmark([], '', 'https://x.dev/p', 'c')[0].title).toBe('https://x.dev/p')
  })

  it('refuses pages a Tab cannot show', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'about:blank', 'https://a b']) {
      expect(() => addBookmark([], 't', url, 'x')).toThrow(/http/)
    }
  })

  it('removes and renames; a name is required', () => {
    const l = addBookmark([], 'A', 'https://a.dev', 'a')
    expect(renameBookmark(l, 'a', 'B')[0].title).toBe('B')
    expect(() => renameBookmark(l, 'a', '  ')).toThrow(/name/)
    expect(removeBookmark(l, 'a')).toEqual([])
  })

  it('reads only what is usable from the file', () => {
    expect(parseBookmarks([{ id: 'a', title: 'A', url: 'https://a.dev' }, { id: 'b', title: 'B', url: 'javascript:1' }, 3, null])).toHaveLength(1)
    expect(parseBookmarks({})).toEqual([])
  })
})

describe('BookmarksService', () => {
  let dir: string
  let writes: number
  let service: BookmarksService
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'workdesk-bm-'))
    writes = 0
    service = new BookmarksService(dir, () => writes++)
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('keeps them in bookmarks.json of the Status Repo and tells the auto-commit', async () => {
    expect(await service.list()).toEqual([])
    const l = await service.add('Docs', 'https://docs.dev')
    expect(l).toHaveLength(1)
    expect(JSON.parse(await readFile(join(dir, 'bookmarks.json'), 'utf8'))).toEqual(l)
    await service.rename(l[0].id, 'Documentation')
    expect((await service.list())[0].title).toBe('Documentation')
    expect(await service.remove(l[0].id)).toEqual([])
    expect(writes).toBe(3)
  })
})

describe('icons of bookmarks', () => {
  it('keeps the icon, takes one for a bookmark without, and does not replace a kept one', () => {
    const list = addBookmark([], 'A', 'https://a.test/', '1')
    const withIcon = setBookmarkIcon(list, 'https://a.test', 'data:image/png;base64,AA')
    expect(withIcon[0].favicon).toBe('data:image/png;base64,AA')
    expect(setBookmarkIcon(withIcon, 'https://a.test/', 'data:image/png;base64,BB')[0].favicon).toBe('data:image/png;base64,AA')
    expect(parseBookmarks(JSON.parse(JSON.stringify(withIcon)))[0].favicon).toBe('data:image/png;base64,AA')
  })
  it('is cached when a bookmark is added and when a page tells its icon later', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'workdesk-bm-'))
    try {
      const svc = new BookmarksService(dir, () => undefined, async (src) => `data:cached,${src}`)
      expect((await svc.add('A', 'https://a.test/', 'https://a.test/i.png'))[0].favicon).toBe('data:cached,https://a.test/i.png')
      await svc.add('B', 'https://b.test/')
      const list = await svc.icon('https://b.test/', 'https://b.test/f.ico')
      expect(list.find((b) => b.title === 'B')?.favicon).toBe('data:cached,https://b.test/f.ico')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('groups of bookmarks', () => {
  const list = setBookmarkGroup(
    setBookmarkGroup(addBookmark(addBookmark(addBookmark([], 'Docs', 'https://docs.dev', '1'), 'Grafana', 'https://grafana.test', '2'), 'Mail', 'https://mail.test', '3'), '2', ' Ops '),
    '3',
    'Ops'
  )

  it('lists a bookmark under a trimmed group, and an empty name takes it out again', () => {
    expect(list.map((b) => b.group)).toEqual([undefined, 'Ops', 'Ops'])
    expect('group' in setBookmarkGroup(list, '2', '  ')[1]).toBe(false)
  })
  it('keeps the group in the file and when the page is bookmarked again', () => {
    expect(parseBookmarks(JSON.parse(JSON.stringify(list)))[1].group).toBe('Ops')
    expect(addBookmark(list, 'Grafana 2', 'https://grafana.test', 'x')[1].group).toBe('Ops')
  })
  it('makes sections by group name with the ungrouped ones last', () => {
    expect(groupBookmarks(list).map((g) => [g.group, g.items.length])).toEqual([['Ops', 2], ['', 1]])
  })
  it('filters by every typed word in title, address or group', () => {
    expect(filterBookmarks(list, 'ops').map((b) => b.id)).toEqual(['2', '3'])
    expect(filterBookmarks(list, 'ops graf').map((b) => b.id)).toEqual(['2'])
    expect(filterBookmarks(list, 'MAIL.test').map((b) => b.id)).toEqual(['3'])
    expect(filterBookmarks(list, '  ')).toHaveLength(3)
  })
  it('is set through the service', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'workdesk-bm-'))
    try {
      const svc = new BookmarksService(dir)
      const [b] = await svc.add('Docs', 'https://docs.dev')
      expect((await svc.group(b.id, 'Work'))[0].group).toBe('Work')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('changing the address of a bookmark', () => {
  const icon = 'data:image/png;base64,AA'
  const list = addBookmark(addBookmark([], 'Docs', 'https://docs.dev/a', '1', icon), 'Mail', 'https://mail.test', '2')

  it('takes a new address, https for a bare one, and keeps the icon on the same host', () => {
    expect(setBookmarkUrl(list, '1', 'docs.dev/b')[0]).toMatchObject({ url: 'https://docs.dev/b', favicon: icon, title: 'Docs' })
  })
  it('drops the icon when the host changes', () => {
    expect('favicon' in setBookmarkUrl(list, '1', 'https://other.test')[0]).toBe(false)
  })
  it('refuses what cannot be bookmarked and an address that is a favorite already', () => {
    expect(() => setBookmarkUrl(list, '1', 'javascript:alert(1)')).toThrow(/http/)
    expect(() => setBookmarkUrl(list, '1', 'https://mail.test/')).toThrow(/Mail/)
    expect(setBookmarkUrl(list, '1', 'https://docs.dev/a/')[0].url).toBe('https://docs.dev/a/')
  })
})

describe('layout of the groups', () => {
  const sections = ['Work', 'Ops', '', 'Alpha'].map((group) => ({ group }))
  const s = DEFAULT_GROUP_SETTINGS
  it('shows groups by name with the ungrouped ones last until they are ordered', () => {
    expect(orderGroups(sections, s).map((x) => x.group)).toEqual(['Alpha', 'Ops', 'Work', ''])
  })
  it('puts the ordered ones first, and keeps the order when one is moved', () => {
    const shown = orderGroups(sections, s).map((x) => x.group)
    const moved = moveGroup(s, shown, 'Work', 'Alpha')
    expect(orderGroups(sections, moved).map((x) => x.group)).toEqual(['Work', 'Alpha', 'Ops', ''])
    const after = moveGroup(s, shown, 'Alpha', '', true)
    expect(orderGroups(sections, after).map((x) => x.group)).toEqual(['Ops', 'Work', '', 'Alpha'])
    // groups hidden by a search keep their place
    expect(moveGroup(moved, ['Ops', 'Work'], 'Ops', 'Work', true).order).toEqual(['Work', 'Ops', 'Alpha', ''])
  })
  it('opens and closes groups against the default, and everything at once', () => {
    expect(isCollapsed(s, 'Ops')).toBe(false)
    const closed = collapseAll(s, true)
    expect(isCollapsed(closed, 'Ops')).toBe(true)
    const opened = toggleGroup(closed, 'Ops')
    expect(isCollapsed(opened, 'Ops')).toBe(false)
    expect(isCollapsed(opened, 'Work')).toBe(true)
    expect(isCollapsed(toggleGroup(opened, 'Ops'), 'Ops')).toBe(true)
    expect(collapseAll(opened, false).toggled).toEqual([])
  })
  it('is read from a file that may hold anything, and kept by the service', async () => {
    expect(parseGroupSettings({ order: ['A', 3, 'A'], collapseByDefault: 'yes', toggled: 'x' })).toEqual({ order: ['A'], collapseByDefault: false, toggled: [] })
    expect(parseGroupSettings(null)).toEqual(s)
    const dir = await mkdtemp(join(tmpdir(), 'workdesk-bm-'))
    try {
      const svc = new BookmarksService(dir)
      expect(await svc.groupSettings()).toEqual(s)
      await svc.setGroupSettings({ order: ['B'], collapseByDefault: true, toggled: ['A'] })
      expect(await new BookmarksService(dir).groupSettings()).toEqual({ order: ['B'], collapseByDefault: true, toggled: ['A'] })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('renaming a group', () => {
  const list = [
    { id: '1', title: 'A', url: 'https://a.test', group: 'Ops' },
    { id: '2', title: 'B', url: 'https://b.test', group: 'Dev' },
    { id: '3', title: 'C', url: 'https://c.test' }
  ]
  it('renames it for all its bookmarks, merges into an existing group, and does not touch the rest', () => {
    expect(renameGroup(list, 'Ops', 'Platform').map((b) => b.group)).toEqual(['Platform', 'Dev', undefined])
    expect(renameGroup(list, 'Ops', 'Dev').map((b) => b.group)).toEqual(['Dev', 'Dev', undefined])
  })
  it('takes its place in the order and its closed state along', () => {
    const s = { order: ['Dev', 'Ops'], collapseByDefault: false, toggled: ['Ops'] }
    expect(renameInSettings(s, 'Ops', 'Platform')).toEqual({ order: ['Dev', 'Platform'], collapseByDefault: false, toggled: ['Platform'] })
    expect(renameInSettings(s, 'Ops', 'Dev').order).toEqual(['Dev'])
  })
  it('is done by the service in both files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'workdesk-bm-'))
    try {
      const svc = new BookmarksService(dir)
      const [b] = await svc.add('A', 'https://a.test')
      await svc.group(b.id, 'Ops')
      await svc.setGroupSettings({ order: ['Ops'], collapseByDefault: false, toggled: [] })
      expect((await svc.renameGroup('Ops', ' Platform '))[0].group).toBe('Platform')
      expect((await svc.groupSettings()).order).toEqual(['Platform'])
      expect((await svc.renameGroup('Platform', '  '))[0].group).toBe('Platform')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('finding a page that is open', () => {
  const layout = {
    activeTabId: 't1',
    tabs: [
      { kind: 'details' as const, id: 'd', name: 'Details' },
      { kind: 'panes' as const, id: 't1', name: 'Terminal', layout: { type: 'pane' as const, id: 'p1', kind: 'terminal' as const } },
      {
        kind: 'panes' as const,
        id: 't2',
        name: 'Pages',
        layout: { type: 'split' as const, direction: 'horizontal' as const, children: [{ type: 'pane' as const, id: 'p2', kind: 'terminal' as const }, { type: 'pane' as const, id: 'p3', kind: 'browser' as const, url: 'https://a.test/x/' }] }
      }
    ]
  }
  it('is the same page whatever a fragment, a trailing slash or the case say, also in a split', () => {
    expect(findBrowserPage(layout as never, 'https://A.test/x#top')).toEqual({ tabId: 't2', paneId: 'p3' })
    expect(findBrowserPage(layout as never, 'https://a.test/y')).toBeUndefined()
    expect(samePage('https://a.test/', 'https://a.test')).toBe(true)
    expect(samePage('https://a.test/a', 'https://a.test/b')).toBe(false)
  })
})

describe('ranking favorites', () => {
  const mk = (id: string, title: string, url: string, group?: string) => ({ id, title, url, ...(group ? { group } : {}) })
  const list = [
    mk('1', 'Portal docs', 'https://docs.test/portal', 'Docs'),
    mk('2', 'Demo', 'https://acme.test/demo', 'acme'),
    mk('3', 'portal demo', 'https://w.test', 'acme'),
    mk('4', 'Status', 'https://status.test', 'acme'),
    mk('5', 'Grafana', 'https://grafana.test/acme-portal'),
    mk('6', 'Mail', 'https://mail.test')
  ]
  const ids = (q: string) => rankBookmarks(list, q).map((b) => b.id)

  it('puts the category first when a word names it: its entries that fit every word, then the rest of it, then other matches', () => {
    expect(ids('acme portal')).toEqual(['3', '2', '4', '5'])
  })
  it('shows the whole category for its name alone, ahead of titles and addresses that only mention it', () => {
    expect(ids('acme')).toEqual(['2', '3', '4', '5'])
  })
  it('keeps the title before the address, and works as before for words that are no category', () => {
    expect(ids('portal')).toEqual(['1', '3', '5'])
    expect(ids('grafana portal')).toEqual(['5'])
    expect(ids('  ')).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(ids('nothing')).toEqual([])
  })
  it('does not take a one-letter word for a category', () => {
    const two = [mk('a', 'Zed', 'https://z.test', 'acme'), mk('b', 'Exam', 'https://x.test')]
    expect(rankBookmarks(two, 'e').map((b) => b.id)).toEqual(['b', 'a'])
  })
  it('makes sections in the order of their best entry, ungrouped last', () => {
    expect(sectionsInOrder(rankBookmarks(list, 'portal')).map((s) => [s.group, s.items.map((b) => b.id)])).toEqual([['Docs', ['1']], ['acme', ['3']], ['', ['5']]])
  })
})

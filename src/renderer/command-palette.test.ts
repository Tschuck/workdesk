import { describe, expect, it } from 'vitest'
import { otherDeskFileCommands, pathQuery, rankCommands, type Command } from './command-palette'

describe('otherDeskFileCommands', () => {
  const desks = [
    { deskId: 'a', deskName: 'Alpha', roots: [{ label: 'p/x', path: '/w/a/p', files: ['src/main.ts', 'README.md'] }] },
    { deskId: 'b', deskName: 'Beta', roots: [{ label: 'q/y', path: '/w/b/q', files: ['lib/main.ts'] }] }
  ]
  it('lists the files of the other desks, labelled with the desk, not those of the current one', () => {
    const opened: unknown[] = []
    const cmds = otherDeskFileCommands(desks, 'a', 'main.ts', 3, (...a) => void opened.push(a))
    expect(cmds.map((c) => [c.group, c.hint])).toEqual([['Beta', 'q/y/lib/main.ts']])
    cmds[0].run()
    expect(opened).toEqual([['b', '/w/b/q/lib/main.ts', 3]])
  })
  it('lists every desk when none is current', () => {
    expect(otherDeskFileCommands(desks, undefined, 'main.ts', undefined, () => undefined).map((c) => c.group)).toEqual(['Alpha', 'Beta'])
  })
})

const c = (title: string, over: Partial<Command> = {}): Command => ({ id: title, title, group: 'Go to', run: () => undefined, ...over })
const list = [c('Switch to WorkDesk auth0 invitations'), c('New terminal tab', { group: 'Tab' }), c('New browser tab', { group: 'Tab' }), c('Open Settings: Browser sessions'), c('Dashboard', { keywords: 'home overview' })]

describe('rankCommands', () => {
  it('keeps everything in order when nothing is typed', () => {
    expect(rankCommands(list, '  ').map((x) => x.title)).toEqual(list.map((x) => x.title))
  })
  it('needs every word, anywhere in the title', () => {
    expect(rankCommands(list, 'new tab').map((x) => x.title)).toEqual(['New terminal tab', 'New browser tab'])
    expect(rankCommands(list, 'browser')).toHaveLength(2)
  })
  it('puts the start of a title before a word inside it', () => {
    expect(rankCommands(list, 'dash settings')).toEqual([])
    expect(rankCommands([c('Reopen tab'), c('Open tab')], 'open').map((x) => x.title)).toEqual(['Open tab', 'Reopen tab'])
    expect(rankCommands(list, 'new')[0].title).toBe('New terminal tab')
  })
  it('finds by group, hint and keywords, but ranks the title first', () => {
    expect(rankCommands(list, 'home').map((x) => x.title)).toEqual(['Dashboard'])
    expect(rankCommands(list, 'tab').map((x) => x.title)).toEqual(['New terminal tab', 'New browser tab'])
  })
  it('accepts scattered letters of longer words as a last resort', () => {
    expect(rankCommands(list, 'dshb').map((x) => x.title)).toEqual(['Dashboard'])
    expect(rankCommands(list, 'zzz')).toEqual([])
  })
})

describe('a path typed into the palette', () => {
  it('is one word with a slash or an extension, and may end in :line', () => {
    expect(pathQuery('modules/a/b.type.js')).toEqual({ path: 'modules/a/b.type.js', line: undefined })
    expect(pathQuery('  src/app/main.ts:42 ')).toEqual({ path: 'src/app/main.ts', line: 42 })
    expect(pathQuery('main.ts')).toEqual({ path: 'main.ts', line: undefined })
    expect(pathQuery('park all')).toBeUndefined()
    expect(pathQuery('settings')).toBeUndefined()
    expect(pathQuery('')).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import type { DeskLayout } from '../main/domain/layout'
import { deskJumpItems, fileJumpItems, filterJump, pageJumpItems } from './jump-to'

const layout: DeskLayout = {
  activeTabId: 't1',
  tabs: [
    { kind: 'details', id: 'd', name: 'Details' },
    { kind: 'panes', id: 't1', name: 'Docs', layout: { type: 'pane', id: 'p1', kind: 'browser', url: 'https://docs.example.com/guide', title: 'The guide' } },
    {
      kind: 'panes',
      id: 't2',
      name: 'Work',
      layout: { type: 'split', id: 's', direction: 'horizontal', ratio: 0.5, children: [{ type: 'pane', id: 'p2', kind: 'terminal', cwd: '/w/api' }, { type: 'pane', id: 'p3', kind: 'file', path: '/w/api/src/app.ts' }] }
    }
  ]
} as unknown as DeskLayout

describe('jump to', () => {
  const items = [
    ...deskJumpItems('desk1', 'Rate limiting', layout),
    ...pageJumpItems([{ id: 'x', url: 'https://github.com/a/b/pull/3', title: 'Fix login' }]),
    ...fileJumpItems([{ id: 'f', path: '/status/knowledge/notes.md' }, { id: 'g' }])
  ]

  it('lists a row per Pane of a Tab, and the tabs of the Browser and Files pages', () => {
    expect(items.map((i) => [i.group, i.title])).toEqual([
      ['Rate limiting', 'Docs'],
      ['Rate limiting', 'Work › Terminal'],
      ['Rate limiting', 'Work › app.ts'],
      ['Browser', 'Fix login'],
      ['Files', 'notes.md']
    ])
  })

  it('finds rows by address, path, name, Tab or WorkDesk, every word having to fit', () => {
    const t = (q: string) => filterJump(items, q).map((i) => i.title)
    expect(t('example.com')).toEqual(['Docs'])
    expect(t('api src')).toEqual(['Work › app.ts'])
    expect(t('rate work')).toEqual(['Work › Terminal', 'Work › app.ts'])
    expect(t('knowledge md')).toEqual(['notes.md'])
    expect(t('pull/3')).toEqual(['Fix login'])
    expect(t('guide')).toEqual(['Docs'])
    expect(t('')).toHaveLength(5)
    expect(t('zzz')).toEqual([])
  })
})

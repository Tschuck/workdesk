import { describe, expect, it } from 'vitest'
import { newBrowserPane, newTerminalPane, paneSummaries, setBrowserLocation, type PaneTab } from './layout'

describe('the list of panes under a tab', () => {
  const tab = (): PaneTab => ({
    kind: 'panes',
    id: 't',
    name: 'Mixed',
    layout: { type: 'split', direction: 'horizontal', children: [newTerminalPane('pt', '/x'), newBrowserPane('p1', 'https://www.example.com/a'), newBrowserPane('p2', 'https://b.dev/x')] }
  })

  it('names a page by its title, falls back to its host, and carries its icon', () => {
    const located = setBrowserLocation(setBrowserLocation(tab().layout, 'p1', 'https://www.example.com/a', '  Docs\n page ', 'https://www.example.com/i.png'), 'p2', 'https://b.dev/x')
    const list = paneSummaries({ ...tab(), layout: located })
    expect(list.map((p) => p.label)).toEqual(['Terminal', 'Docs page', 'b.dev'])
    expect(list.map((p) => p.favicon)).toEqual([undefined, 'https://www.example.com/i.png', undefined])
  })
})

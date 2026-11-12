import { describe, expect, it } from 'vitest'
import { newTerminalPane, paneAfterClose, type LayoutNode } from './layout'

const p = (id: string) => newTerminalPane(id)

describe('the focus after closing a Pane', () => {
  // a | (b over c) | d
  const layout: LayoutNode = {
    type: 'split',
    direction: 'horizontal',
    children: [p('a'), { type: 'split', direction: 'vertical', children: [p('b'), p('c')] }, p('d')]
  }

  it('goes to the Pane beside it that takes its space', () => {
    expect(paneAfterClose(layout, 'd')).toBe('c')
    expect(paneAfterClose(layout, 'b')).toBe('c')
    expect(paneAfterClose(layout, 'c')).toBe('b')
  })

  it('goes to the nearest Pane of a split beside it', () => {
    expect(paneAfterClose(layout, 'a')).toBe('b')
  })

  it('is nothing for the only Pane or an unknown one', () => {
    expect(paneAfterClose(p('a'), 'a')).toBeUndefined()
    expect(paneAfterClose(layout, 'x')).toBeUndefined()
  })
})

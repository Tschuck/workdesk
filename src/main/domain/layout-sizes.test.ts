import { describe, expect, it } from 'vitest'
import { newTerminalPane, removePane, setSplitSizes, splitPane, splitSizes, type LayoutNode, type SplitNode } from './layout'

const p = (id: string) => newTerminalPane(id)

describe('the sizes of a split', () => {
  // a | (b over c)
  const layout: SplitNode = {
    type: 'split',
    direction: 'horizontal',
    children: [p('a'), { type: 'split', direction: 'vertical', children: [p('b'), p('c')] }]
  }

  it('are all the same until they are dragged', () => {
    expect(splitSizes(layout)).toEqual([0.5, 0.5])
  })

  it('are all the same when the kept ones do not fit the children', () => {
    expect(splitSizes({ ...layout, sizes: [1, 2, 3] })).toEqual([0.5, 0.5])
    expect(splitSizes({ ...layout, sizes: [1, 0] })).toEqual([0.5, 0.5])
  })

  it('are set on the root or on a nested split, as shares that add up to 1', () => {
    const root = setSplitSizes(layout, [], [3, 1]) as SplitNode
    expect(root.sizes).toEqual([0.75, 0.25])
    const nested = setSplitSizes(layout, [1], [1, 4]) as SplitNode
    expect((nested.children[1] as SplitNode).sizes).toEqual([0.2, 0.8])
  })

  it('refuse a place that is no split, or sizes that do not fit', () => {
    expect(() => setSplitSizes(layout, [0], [1, 1])).toThrow('There is no split there')
    expect(() => setSplitSizes(layout, [5], [1, 1])).toThrow('There is no split there')
    expect(() => setSplitSizes(layout, [], [1, 1, 1])).toThrow('The sizes do not fit the split')
    expect(() => setSplitSizes(layout, [], [1, -1])).toThrow('The sizes do not fit the split')
  })

  it('give a new Pane half the space of the one it was split from', () => {
    const sized: LayoutNode = { ...layout, sizes: [0.6, 0.4] }
    const split = splitPane(sized, 'a', 'horizontal', p('n')) as SplitNode
    expect(split.children.map((c) => (c.type === 'pane' ? c.id : 'split'))).toEqual(['a', 'n', 'split'])
    expect(split.sizes).toEqual([0.3, 0.3, 0.4])
  })

  it('keep the shares of the others when a Pane is closed', () => {
    const three: LayoutNode = { type: 'split', direction: 'horizontal', children: [p('a'), p('b'), p('c')], sizes: [0.5, 0.25, 0.25] }
    expect((removePane(three, 'a') as SplitNode).sizes).toEqual([0.5, 0.5])
    expect((removePane(three, 'b') as SplitNode).sizes?.map((s) => +s.toFixed(4))).toEqual([0.6667, 0.3333])
  })
})

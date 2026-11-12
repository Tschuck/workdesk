import { describe, expect, it } from 'vitest'
import { buildTree, filterFiles, isFileDirty, setFileDirty, splitLineRef } from './file-buffers'

describe('the file tree', () => {
  it('nests paths, folders first, names in order', () => {
    const tree = buildTree(['b.txt', 'src/z.ts', 'src/a.ts', 'src/deep/x.ts', 'a.txt'])
    expect(tree.map((n) => n.name)).toEqual(['src', 'a.txt', 'b.txt'])
    const src = tree[0]
    expect(src.children!.map((n) => n.name)).toEqual(['deep', 'a.ts', 'z.ts'])
    expect(src.children![0].children![0].path).toBe('src/deep/x.ts')
    expect(buildTree([])).toEqual([])
    // an entry ending in a slash is a folder with nothing in it
    expect(buildTree(['a.txt', 'payments/specs/', 'payments/x.md'])).toEqual([
      { name: 'payments', path: 'payments', children: [{ name: 'specs', path: 'payments/specs', children: [] }, { name: 'x.md', path: 'payments/x.md' }] },
      { name: 'a.txt', path: 'a.txt' }
    ])
  })
})

describe('finding a file by name', () => {
  const files = ['src/app/main.ts', 'src/main.test.ts', 'README.md', 'docs/main-notes.md']
  it('needs every word, shortest path first', () => {
    expect(filterFiles(files, 'main')).toEqual(['src/app/main.ts', 'src/main.test.ts', 'docs/main-notes.md'])
    expect(filterFiles(files, 'main test')).toEqual(['src/main.test.ts'])
    expect(filterFiles(files, '  ')).toEqual([])
  })

  const deep = ['modules/billing/invoice/protocols/v2/types/invoice-request.type.ts', 'modules/other/types/invoice-request.type.ts', 'README.md']
  it('takes a whole relative path, also with ./ in front', () => {
    const full = 'modules/billing/invoice/protocols/v2/types/invoice-request.type.ts'
    expect(filterFiles(deep, full)).toEqual([deep[0]])
    expect(filterFiles(deep, './' + full)).toEqual([deep[0]])
  })
  it('finds a path that is a little off: letters in order, or the extension that is not the real one', () => {
    expect(filterFiles(deep, 'modules/billing/protocols/invoice-request.type.ts')).toEqual([deep[0]])
    expect(filterFiles(deep, 'modules/billing/invoice/protocols/v2/types/invoice-request.type.js')).toEqual([deep[0]])
    expect(filterFiles(deep, 'nothing/like/it.js')).toEqual([])
  })
})

describe('unsaved changes', () => {
  it('are remembered per Pane', () => {
    setFileDirty('p1', true)
    expect(isFileDirty('p1')).toBe(true)
    setFileDirty('p1', false)
    expect(isFileDirty('p1')).toBe(false)
  })
})

describe('a file named with its line', () => {
  it('is looked for without the line, and opens at its first line', () => {
    expect(splitLineRef('agent/src/modules/standards/jsonld/document-loader.service.ts:82-100')).toEqual({ query: 'agent/src/modules/standards/jsonld/document-loader.service.ts', line: 82 })
    expect(splitLineRef('a.ts:82')).toEqual({ query: 'a.ts', line: 82 })
    expect(splitLineRef('a.ts:82:5')).toEqual({ query: 'a.ts', line: 82 })
    expect(splitLineRef('a.ts#L82-L100')).toEqual({ query: 'a.ts', line: 82 })
    expect(splitLineRef('a.ts')).toEqual({ query: 'a.ts' })
    expect(splitLineRef(':82')).toEqual({ query: ':82' })
    expect(splitLineRef('a.ts:0')).toEqual({ query: 'a.ts:0' })
  })
})

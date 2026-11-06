import { describe, expect, it } from 'vitest'
import {
  baseChoices,
  buildReviewTree,
  childrenOf,
  commentCounts,
  parseComments,
  parseNameStatus,
  parseUntracked,
  renderMarkdown,
  serializeComments,
  withExcludeEntry
} from './local-review'

describe('parseNameStatus', () => {
  it('reads A, M, D and renames; copies are added, other codes modified', () => {
    const out = 'M\0a.ts\0A\0b.ts\0D\0c.ts\0R087\0old.ts\0new.ts\0C100\0src.ts\0copy.ts\0T\0t.ts\0'
    expect(parseNameStatus(out)).toEqual([
      { status: 'M', path: 'a.ts' },
      { status: 'A', path: 'b.ts' },
      { status: 'D', path: 'c.ts' },
      { status: 'R', path: 'new.ts', oldPath: 'old.ts' },
      { status: 'A', path: 'copy.ts' },
      { status: 'M', path: 't.ts' }
    ])
    expect(parseNameStatus('')).toEqual([])
  })
  it('reads untracked files', () => {
    expect(parseUntracked('x.md\0dir/y.md\0')).toEqual([
      { status: 'U', path: 'x.md' },
      { status: 'U', path: 'dir/y.md' }
    ])
  })
})

describe('tree', () => {
  it('lists folders first, collapses single-child chains', () => {
    const tree = buildReviewTree([
      { status: 'M', path: 'z.ts' },
      { status: 'M', path: 'a/b/c/deep.ts' },
      { status: 'A', path: 'src/x.ts' },
      { status: 'A', path: 'src/sub/y.ts' }
    ])
    const top = childrenOf(tree)
    expect(top.map((c) => (c.kind === 'dir' ? `dir ${c.label}` : `file ${c.entry.path}`))).toEqual(['dir a/b/c', 'dir src', 'file z.ts'])
    const chain = top[0]
    expect(chain.kind === 'dir' && chain.path).toBe('a/b/c')
    const src = top[1]
    if (src.kind !== 'dir') throw new Error('dir expected')
    expect(childrenOf(src.node).map((c) => (c.kind === 'dir' ? `dir ${c.label}` : `file ${c.entry.path}`))).toEqual(['dir sub', 'file src/x.ts'])
  })
})

describe('renderMarkdown', () => {
  it('says so when there are no comments', () => {
    expect(renderMarkdown([], 'origin/main')).toBe('Base `origin/main`\n\n_No open comments._\n')
  })
  it('has one heading per path:line, sorted, with the text as written under it', () => {
    const md = renderMarkdown(
      [
        { id: '1', path: 'b.ts', line: 3, text: 'second' },
        { id: '2', path: 'a.ts', line: 20, text: 'late\n\nmore text\n' },
        { id: '3', path: 'a.ts', line: 2, text: 'early' }
      ],
      'main'
    )
    expect(md).toBe(
      [
        'Base `main`',
        '',
        '## [ ] a.ts:2',
        '',
        'early',
        '',
        '## [ ] a.ts:20',
        '',
        'late',
        '',
        'more text',
        '',
        '## [ ] b.ts:3',
        '',
        'second',
        ''
      ].join('\n')
    )
  })
  it('puts the comments on the review as a whole first', () => {
    const md = renderMarkdown([{ id: '1', path: 'a.ts', line: 2, text: 'line' }], 'main', [{ id: 'n', text: 'overall' }])
    expect(md).toBe(['Base `main`', '', '## [ ] General', '', 'overall', '', '## [ ] a.ts:2', '', 'line', ''].join('\n'))
  })
  it('leaves out the Base line without a base', () => {
    expect(renderMarkdown([{ id: '1', path: 'a', line: 1, text: 't' }])).not.toContain('Base')
  })
})

describe('comments file', () => {
  it('round-trips and drops entries of another shape', () => {
    const c = { id: 'u', path: 'a.ts', line: 4, text: 'x' }
    expect(parseComments(serializeComments([c]))).toEqual([c])
    expect(serializeComments([c]).endsWith('}\n]\n')).toBe(true)
    expect(parseComments(JSON.stringify([c, { id: 1 }, null, { ...c, line: 1.5 }]))).toEqual([c])
    expect(parseComments('{}')).toEqual([])
    expect(parseComments('not json')).toEqual([])
  })
  it('counts per file', () => {
    expect(commentCounts([{ id: '1', path: 'a', line: 1, text: '' }, { id: '2', path: 'a', line: 2, text: '' }, { id: '3', path: 'b', line: 1, text: '' }])).toEqual({ a: 2, b: 1 })
  })
})

describe('info/exclude', () => {
  it('appends the entry once', () => {
    expect(withExcludeEntry('', '/.review/')).toBe('/.review/\n')
    expect(withExcludeEntry('# x', '/.review/')).toBe('# x\n/.review/\n')
    expect(withExcludeEntry('a\n/.review/\n', '/.review/')).toBeNull()
    expect(withExcludeEntry('a\n  /.review/  \n', '/.review/')).toBeNull()
  })
})

describe('baseChoices', () => {
  it('puts remote main/master first, then local main/master, drops HEAD refs', () => {
    expect(baseChoices('refs/heads/zeta\nrefs/heads/main\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/main\nrefs/remotes/origin/alpha\n')).toEqual(['origin/main', 'main', 'origin/alpha', 'zeta'])
  })
})

import { describe, expect, it } from 'vitest'
import type { Todo } from './types'
import { addRef, attachableTodos, filterTodos, cleanRefInput, hasRef, hostOf, markdownLink, refLabel, removeRef } from './page-refs'

describe('page references', () => {
  it('names a page by its title, else its host, else its address', () => {
    expect(refLabel({ url: 'https://github.com/a/b/pull/1', title: ' Fix  the\nbug ' })).toBe('Fix the bug')
    expect(refLabel({ url: 'https://www.example.com/x', title: '' })).toBe('example.com')
    expect(refLabel({ url: 'not a url' })).toBe('not a url')
    expect(hostOf('http://localhost:3000/a')).toBe('localhost:3000')
  })

  it('writes a Markdown link and keeps it from breaking', () => {
    expect(markdownLink('https://a.dev/x', 'Docs')).toBe('[Docs](https://a.dev/x)')
    expect(markdownLink('https://a.dev/x', 'Array [0] of \\')).toBe('[Array \\[0\\] of \\\\](https://a.dev/x)')
    expect(markdownLink('https://en.wikipedia.org/wiki/Foo_(bar)', 'Foo')).toBe('[Foo](https://en.wikipedia.org/wiki/Foo_%28bar%29)')
    expect(markdownLink('https://a.dev/a b', '')).toBe('[a.dev](https://a.dev/a%20b)')
  })

  it('accepts only web pages and tidies the input', () => {
    expect(cleanRefInput({ url: ' https://a.dev/x ', title: '  T  ', favicon: 'https://a.dev/i.png' })).toEqual({ url: 'https://a.dev/x', title: 'T', favicon: 'https://a.dev/i.png' })
    expect(cleanRefInput({ url: 'https://a.dev', favicon: 'x'.repeat(5000) }).favicon).toBeUndefined()
    expect(() => cleanRefInput({ url: 'about:blank' })).toThrow()
    expect(() => cleanRefInput({ url: 'javascript:alert(1)' })).toThrow()
    expect(() => cleanRefInput(undefined)).toThrow()
  })

  it('adds a page once, refreshing the title of one that is there', () => {
    const one = addRef(undefined, { url: 'https://a.dev/x', title: '' }, 'r1', 10)
    expect(one).toEqual([{ id: 'r1', url: 'https://a.dev/x', title: '', favicon: undefined, addedAt: 10 }])
    const two = addRef(one, { url: 'https://a.dev/x/#top', title: 'Docs', favicon: 'i' }, 'r2', 20)
    expect(two).toHaveLength(1)
    expect(two[0]).toMatchObject({ id: 'r1', title: 'Docs', favicon: 'i', addedAt: 10 })
    const three = addRef(two, { url: 'https://b.dev', title: '' }, 'r3', 30)
    expect(three.map((r) => r.id)).toEqual(['r1', 'r3'])
    expect(hasRef(three, 'https://B.dev/')).toBe(true)
    expect(hasRef(three, 'https://c.dev')).toBe(false)
  })

  it('keeps the old title when the new one is empty and removes by id', () => {
    const list = addRef(addRef(undefined, { url: 'https://a.dev', title: 'A' }, 'r1', 1), { url: 'https://a.dev', title: '' }, 'r2', 2)
    expect(list[0].title).toBe('A')
    expect(removeRef(list, 'r1')).toEqual([])
    expect(removeRef(undefined, 'r1')).toEqual([])
  })

  it('offers the open Todos of the WorkDesk, then loose ones of Today, then other loose ones', () => {
    const todo = (id: string, extra: Partial<Todo>): Todo => ({ id, title: `Todo ${id}`, topics: [], list: 'backlog', resolved: false, createdAt: 0, ...extra })
    const all = [
      todo('loose-backlog', {}),
      todo('other-desk', { deskId: 'x', list: 'today' }),
      todo('done', { deskId: 'd', resolved: true }),
      todo('loose-today', { list: 'today' }),
      todo('mine', { deskId: 'd', list: 'today' })
    ]
    expect(attachableTodos(all, 'd').map((t) => t.id)).toEqual(['mine', 'loose-today', 'loose-backlog'])
    expect(attachableTodos(all, undefined).map((t) => t.id)).toEqual(['loose-today', 'loose-backlog'])
  })

  it('filters Todos by every typed word', () => {
    const list = [{ title: 'Fix login bug' }, { title: 'Write docs' }] as Todo[]
    expect(filterTodos(list, 'LOGIN fix')).toHaveLength(1)
    expect(filterTodos(list, '')).toHaveLength(2)
    expect(filterTodos(list, 'zzz')).toHaveLength(0)
  })
})

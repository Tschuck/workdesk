import { describe, expect, it } from 'vitest'
import { claimedKeys, deskItemOf, itemOfDesk, prItem, searchItems, startList, suggestName, ticketItem, todoItem } from './work-items'
import type { Todo, WorkDesk } from './types'

const todo = (id: string, list: 'today' | 'backlog', deskId?: string): Todo => ({ id, title: `todo ${id}`, topics: [], list, resolved: false, createdAt: 0, deskId })
const pr = prItem({ id: 'a/b#1', title: 'a/b#1 Fix login', name: 'Fix login', url: 'https://x/1', subtitle: 'b by sam' })
const ticket = ticketItem({ id: 'page1', title: 'ENG-5 Export', name: 'Export', url: 'https://n/1', ticketKey: 'ENG-5' })

describe('work items', () => {
  it('orders Todos, Pull requests and tickets, and leaves out what a WorkDesk has', () => {
    const list = startList([todoItem(todo('1', 'backlog')), ticket, pr, todoItem(todo('2', 'today')), todoItem(todo('3', 'today', 'd'))])
    expect(list.map((i) => i.key)).toEqual(['todo:1', 'todo:2', 'pr:a/b#1', 'ticket:page1'])
  })

  it('searches every word in title, subtitle, key and kind', () => {
    const all = [pr, ticket, todoItem(todo('1', 'today'))]
    expect(searchItems(all, 'login sam').map((i) => i.key)).toEqual(['pr:a/b#1'])
    expect(searchItems(all, 'eng-5').map((i) => i.key)).toEqual(['ticket:page1'])
    expect(searchItems(all, 'ticket').map((i) => i.key)).toEqual(['ticket:page1'])
    expect(searchItems(all, '')).toHaveLength(3)
  })

  it('turns Pull Requests and tickets into desk items and back, but not Todos', () => {
    expect(deskItemOf(pr)).toMatchObject({ kind: 'pr', id: 'a/b#1', title: 'Fix login' })
    expect(itemOfDesk(deskItemOf(ticket)!).key).toBe('ticket:page1')
    expect(deskItemOf(todoItem(todo('1', 'today')))).toBeUndefined()
  })

  it('marks why a Pull request is offered', () => {
    expect(pr.role).toBe('review')
    expect(prItem({ id: 'a/b#2', title: 't', url: 'u' }, 'mine').hint).toBe('needs work')
  })

  it('knows which items WorkDesks have', () => {
    const desk = { items: [deskItemOf(pr)!] } as WorkDesk
    expect(claimedKeys([desk]).has('pr:a/b#1')).toBe(true)
    expect(claimedKeys([{} as WorkDesk]).size).toBe(0)
  })

  it('suggests a name from the first item', () => {
    expect(suggestName([ticket])).toBe('ENG-5 Export')
    expect(suggestName([pr, ticket])).toBe('Fix login +1')
    expect(suggestName([])).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import { migrateToItems } from './migrate-items'
import type { Todo, WorkDesk } from './types'

const todo = (id: string, over: Partial<Todo> = {}): Todo => ({ id, title: `t${id}`, topics: [], list: 'today', resolved: false, createdAt: 0, ...over })
const pr = (id: string, over: Partial<Todo> = {}) => todo(id, { title: 'Fix login', source: { sourceId: 'github-prs', externalId: 'a/b#4', url: 'https://x/4' }, ...over })
const ticket = (id: string, over: Partial<Todo> = {}) => todo(id, { title: 'Export', source: { sourceId: 'notion-tickets', externalId: 'page1', ticketKey: 'ENG-5', url: 'https://n/1' }, ...over })
const desk = (id: string, todoIds: string[]): WorkDesk => ({ id, name: id, stage: 'implement', stageOverridden: false, priority: 0, presence: 'inactive', todoIds, branches: [], signals: [], createdAt: 0 })

describe('migration of Pull request and ticket Todos to work items', () => {
  it('turns the Todo of a WorkDesk into an item of it and keeps the other Todos', () => {
    const m = migrateToItems([pr('1', { deskId: 'd' }), todo('2', { deskId: 'd' })], [desk('d', ['1', '2'])])
    expect(m.todos.map((t) => t.id)).toEqual(['2'])
    expect(m.desks[0].todoIds).toEqual(['2'])
    expect(m.desks[0].items).toEqual([{ kind: 'pr', id: 'a/b#4', title: 'Fix login', url: 'https://x/4', ticketKey: undefined, subtitle: 'a/b' }])
    expect(m.removed.map((t) => t.id)).toEqual(['1'])
    expect(m.notes).toEqual([{ from: '1', to: 'pr-a-b-4' }])
  })

  it('keeps the ticket key and does not add an item twice', () => {
    const d = { ...desk('d', ['1']), items: [{ kind: 'ticket' as const, id: 'page1', title: 'Export' }] }
    const m = migrateToItems([ticket('1', { deskId: 'd' })], [d])
    expect(m.desks[0].items).toHaveLength(1)
    expect(migrateToItems([ticket('1', { deskId: 'd' })], [desk('d', ['1'])]).desks[0].items?.[0]).toMatchObject({ kind: 'ticket', ticketKey: 'ENG-5' })
  })

  it('drops open ones in no WorkDesk, moving their notes, and leaves resolved ones in no WorkDesk alone', () => {
    const m = migrateToItems([pr('1'), ticket('2', { list: 'backlog' }), pr('3', { resolved: true }), todo('4')], [])
    expect(m.todos.map((t) => t.id)).toEqual(['3', '4'])
    expect(m.notes.map((n) => n.to)).toEqual(['pr-a-b-4', 'ticket-page1'])
  })

  it('does nothing when there is nothing to migrate', () => {
    const desks = [desk('d', ['2'])]
    const m = migrateToItems([todo('2', { deskId: 'd' })], desks)
    expect(m.removed).toEqual([])
    expect(m.todos).toHaveLength(1)
    expect(m.desks).toEqual(desks)
  })
})

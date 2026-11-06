import { describe, expect, it } from 'vitest'
import type { DeskLayout } from './layout'
import { resume, retarget, type Schedule } from './schedule'
import { TEMPLATES, type DeskTemplate } from './templates'
import { captureTemplate, deleteTemplate, duplicateTemplate, editTemplate, layoutFromTabs, moveTemplate, pauseMissingTemplates } from './user-templates'
import type { Todo, WorkDesk } from './types'

const todo = (id: string, resolved = false): Todo => ({ id, title: `todo ${id}`, topics: [], list: 'today', resolved, createdAt: 0 })
const desk = (extra: Partial<WorkDesk> = {}): WorkDesk => ({ id: 'd', name: 'd', stage: 'testing', stageOverridden: false, priority: 0, presence: 'inactive', todoIds: ['b', 'a', 'c'], branches: [], signals: [], createdAt: 0, ...extra })
const layout: DeskLayout = {
  activeTabId: 'det',
  tabs: [
    { kind: 'details', id: 'det', name: 'Details' },
    {
      kind: 'panes',
      id: 't1',
      name: 'Work',
      layout: { type: 'split', direction: 'horizontal', children: [{ type: 'pane', id: 'p1', kind: 'terminal', cwd: '/x' }, { type: 'pane', id: 'p2', kind: 'browser', url: 'https://ci.example/run/1' }] }
    },
    { kind: 'panes', id: 't2', name: 'Notes', layout: { type: 'pane', id: 'p3', kind: 'file', path: '/x/notes.md' } }
  ]
}
let n = 0
const id = () => `id${n++}`

describe('capture', () => {
  it('keeps the stage, the open todos in checklist order, and the tabs with pages and files', () => {
    const t = captureTemplate('user-1', ' Mine ', desk(), [todo('a'), todo('b'), todo('c', true)], layout, false)
    expect(t).toMatchObject({ id: 'user-1', name: 'Mine', stage: 'testing', todos: ['todo b', 'todo a'], panes: ['terminal', 'browser'] })
    expect(t.builtin).toBeUndefined()
    expect(t.tabs).toHaveLength(2)
    expect(t.tabs![0].layout).toEqual({ type: 'split', direction: 'horizontal', children: [{ type: 'pane', kind: 'terminal' }, { type: 'pane', kind: 'browser', url: 'https://ci.example/run/1' }] })
    expect(t.tabs![1].layout).toEqual({ type: 'pane', kind: 'file', path: '/x/notes.md' })
  })

  it('can keep only the kinds of panes', () => {
    const t = captureTemplate('user-1', 'Kinds', desk(), [], layout, true)
    expect(JSON.stringify(t.tabs)).not.toContain('ci.example')
    expect(JSON.stringify(t.tabs)).not.toContain('notes.md')
    expect(t.tabs![0].layout).toMatchObject({ children: [{ kind: 'terminal' }, { kind: 'browser', url: 'about:blank' }] })
  })

  it('turns a stage that does not exist into Implement, and needs a name', () => {
    expect(captureTemplate('u', 'x', desk({ stage: 'nonsense' as never }), [], layout, true).stage).toBe('implement')
    expect(captureTemplate('u', 'x', desk({ stage: 'to-review' }), [], layout, true).stage).toBe('to-review')
    expect(() => captureTemplate('u', ' ', desk(), [], layout, true)).toThrow()
  })

  it('builds a layout for a new WorkDesk with fresh ids and Details in front', () => {
    const t = captureTemplate('u', 'x', desk(), [], layout, false)
    const l = layoutFromTabs(t.tabs!, id, '/new', 'details')
    expect(l.tabs.map((x) => x.kind)).toEqual(['details', 'panes', 'panes'])
    expect(l.activeTabId).toBe('details')
    const ids = JSON.stringify(l).match(/"id":"(id\d+|details)"/g)!
    expect(new Set(ids).size).toBe(ids.length)
    expect(JSON.stringify(l)).toContain('"cwd":"/new"')
    expect(JSON.stringify(l)).toContain('https://ci.example/run/1')
  })
})

describe('the list of user templates', () => {
  const mine: DeskTemplate = { id: 'user-1', name: 'Mine', stage: 'implement', todos: ['a', 'b'], panes: ['terminal'] }
  const other: DeskTemplate = { ...mine, id: 'user-2', name: 'Other' }

  it('edits name, stage and todos; refuses built-ins and bad input', () => {
    const [e] = editTemplate([mine], 'user-1', { name: ' New ', stage: 'waiting', todos: [' x ', '', 'y'] })
    expect(e).toMatchObject({ name: 'New', stage: 'waiting', todos: ['x', 'y'] })
    expect(() => editTemplate([mine], TEMPLATES[0].id, { name: 'x' })).toThrow(/duplicate/)
    expect(() => editTemplate([mine], 'user-1', { name: ' ' })).toThrow()
    expect(() => editTemplate([mine], 'user-1', { stage: 'nonsense' as never })).toThrow()
    expect(() => editTemplate([mine], 'nope', {})).toThrow(/Unknown/)
  })

  it('deletes only user templates', () => {
    expect(deleteTemplate([mine, other], 'user-1')).toEqual([other])
    expect(() => deleteTemplate([mine], TEMPLATES[1].id)).toThrow()
  })

  it('duplicates, also a built-in one, with a free name and no built-in flag', () => {
    const a = duplicateTemplate([], 'release', 'user-9')
    expect(a[0]).toMatchObject({ id: 'user-9', name: 'Release copy', todos: TEMPLATES[1].todos })
    expect(a[0].builtin).toBeUndefined()
    expect(duplicateTemplate(a, 'release', 'user-10')[1].name).toBe('Release copy 2')
    expect(() => duplicateTemplate([], 'nope', 'x')).toThrow()
  })

  it('reorders among the user templates', () => {
    expect(moveTemplate([mine, other], 'user-2', -1).map((t) => t.id)).toEqual(['user-2', 'user-1'])
    expect(moveTemplate([mine, other], 'user-1', -1).map((t) => t.id)).toEqual(['user-1', 'user-2'])
    expect(() => moveTemplate([mine], 'release', 1)).toThrow()
  })
})

describe('schedules and deleted templates', () => {
  const sched = (templateId: string, extra: Partial<Schedule> = {}): Schedule => ({ id: templateId, templateId, name: 'n', repeat: 'daily', time: '09:00', nextAt: 5, ...extra })

  it('pauses the schedules whose template is gone, with a reason, once', () => {
    const out = pauseMissingTemplates([sched('release'), sched('user-1')], TEMPLATES)
    expect(out[0].paused).toBeUndefined()
    expect(out[1]).toMatchObject({ paused: true })
    expect(out[1].pausedReason).toMatch(/template was deleted/)
    expect(pauseMissingTemplates(out, TEMPLATES)[1]).toBe(out[1])
  })

  it('retargeting clears the reason and resuming clears the pause', () => {
    const paused = pauseMissingTemplates([sched('user-1')], TEMPLATES)[0]
    const r = retarget(paused, 'release')
    expect(r).toMatchObject({ templateId: 'release', paused: true })
    expect(r.pausedReason).toBeUndefined()
    expect(resume(r, 0).paused).toBeUndefined()
  })
})

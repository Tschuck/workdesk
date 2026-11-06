import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkDeskService } from './service'
import { FakeGit } from './status/fake-git'

let root: string
let service: WorkDeskService
let clock = new Date(2026, 10, 1, 10, 0).getTime()
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workdesk-dtodo-'))
  clock = new Date(2026, 10, 1, 10, 0).getTime()
  service = new WorkDeskService(root, new FakeGit(), () => clock)
  await service.load()
})
afterEach(async () => {
  service.status.autoCommit.dispose()
  await rm(root, { recursive: true, force: true })
})

const H = 3_600_000

describe('desk checklist', () => {
  it('captures into a WorkDesk, or loose for Today, and reorders', async () => {
    await service.startPlainDesk([], 'Desk')
    await service.captureTodo('desk', 'one')
    await service.captureTodo('desk', 'two')
    let s = await service.captureTodo(undefined, 'loose')
    const [one, two, loose] = s.todos
    expect(s.desks[0].todoIds).toEqual([one.id, two.id])
    expect(loose).toMatchObject({ title: 'loose', list: 'today' })
    expect(loose.deskId).toBeUndefined()
    s = await service.stepDeskTodo('desk', two.id, -1)
    expect(s.desks[0].todoIds).toEqual([two.id, one.id])
    s = await service.placeDeskTodo('desk', two.id, one.id, true)
    expect(s.desks[0].todoIds).toEqual([one.id, two.id])
    await expect(service.captureTodo('nope', 'x')).rejects.toThrow(/Unknown WorkDesk/)
  })

  it('keeps the order across a reload', async () => {
    await service.startPlainDesk([], 'Desk')
    await service.captureTodo('desk', 'one')
    const s = await service.captureTodo('desk', 'two')
    await service.stepDeskTodo('desk', s.todos[1].id, -1)
    const again = new WorkDeskService(root, new FakeGit())
    await again.load()
    expect(again.state().desks[0].todoIds).toEqual([s.todos[1].id, s.todos[0].id])
    again.status.autoCommit.dispose()
  })

  it('has a Markdown note per WorkDesk', async () => {
    await service.startPlainDesk([], 'Desk')
    await service.saveNotes('desk-desk', '# plan')
    expect(await service.readNotes('desk-desk')).toBe('# plan')
    await expect(service.readNotes('desk-nope')).rejects.toThrow(/Unknown/)
  })
})

describe('reminders', () => {
  it('raise a Signal in the WorkDesk once, again after a snooze', async () => {
    await service.startPlainDesk([], 'Desk')
    const s = await service.captureTodo('desk', 'call back')
    const id = s.todos[0].id
    await service.setTodoDue(id, clock + H)
    expect(await service.checkReminders()).toEqual([])
    expect(service.state().desks[0].signals).toEqual([])

    clock += H
    await service.checkReminders()
    expect(service.state().desks[0].signals).toMatchObject([{ type: 'todo-due', message: 'call back', read: false }])
    await service.checkReminders()
    expect(service.state().desks[0].signals).toHaveLength(1)

    await service.snoozeTodo(id, clock + H)
    clock += H
    await service.checkReminders()
    expect(service.state().desks[0].signals).toHaveLength(2)
  })

  it('returns Todos without a WorkDesk, and skips resolved ones', async () => {
    let s = await service.captureTodo(undefined, 'loose')
    s = await service.captureTodo(undefined, 'done')
    await service.setTodoDue(s.todos[0].id, clock - 1)
    await service.setTodoDue(s.todos[1].id, clock - 1)
    await service.setTodoResolved(s.todos[1].id, true)
    expect((await service.checkReminders()).map((t) => t.title)).toEqual(['loose'])
    expect(await service.checkReminders()).toEqual([])
  })
})

describe('recurring Todos and templates', () => {
  it('resolving a repeating Todo starts the next one in the same WorkDesk', async () => {
    await service.startPlainDesk([], 'Desk')
    let s = await service.captureTodo('desk', 'stand-up notes')
    const id = s.todos[0].id
    await service.setTodoDue(id, clock + H)
    await expect(service.setTodoRepeat(id, 'daily')).resolves.toBeDefined()
    s = await service.setTodoResolved(id, true)
    expect(s.todos).toHaveLength(2)
    expect(s.todos[0]).toMatchObject({ resolved: true })
    expect(s.todos[0].repeat).toBeUndefined()
    expect(s.todos[1]).toMatchObject({ title: 'stand-up notes', resolved: false, repeat: 'daily', deskId: 'desk', dueAt: clock + H + 24 * H })
    expect(s.desks[0].todoIds).toEqual([s.todos[0].id, s.todos[1].id])
    // un-ticking and ticking again does not start a third one
    await service.setTodoResolved(id, false)
    s = await service.setTodoResolved(id, true)
    expect(s.todos).toHaveLength(2)
  })

  it('a schedule plans one WorkDesk when due, not while it is open, and survives a reload', async () => {
    const list = await service.addSchedule({ templateId: 'release', name: 'Weekly release', repeat: 'daily', time: '09:00' })
    expect(list[0].nextAt).toBeGreaterThan(clock)
    expect(await service.runSchedules()).toEqual([])
    clock += 20 * 24 * H // the app was closed for weeks
    const made = await service.runSchedules()
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ name: 'Weekly release', presence: 'planned', scheduleId: list[0].id, })
    expect(service.listSchedules()[0].nextAt).toBeGreaterThan(clock)
    // a day later the first one is still open: no second one
    clock += 24 * H
    expect(await service.runSchedules()).toEqual([])
    expect(service.state().desks).toHaveLength(1)

    const again = new WorkDeskService(root, new FakeGit(), () => clock)
    await again.load()
    expect(again.listSchedules()).toHaveLength(1)
    expect(again.state().desks[0].scheduleId).toBe(list[0].id)
    again.status.autoCommit.dispose()

    // paused: nothing; deleted: the WorkDesk stays but is free
    await service.setSchedulePaused(list[0].id, true)
    expect(service.listSchedules()[0].paused).toBe(true)
    const s = await service.deleteSchedule(list[0].id)
    expect(s).toEqual([])
    expect(service.state().desks[0].scheduleId).toBeUndefined()
  })

  it('user templates: saved from a WorkDesk, used for a new one, kept across a reload; a schedule on a deleted one pauses', async () => {
    await service.startPlainDesk([], 'Mine')
    await service.captureTodo('mine', 'step one')
    const done = await service.captureTodo('mine', 'step two')
    await service.setTodoResolved(done.todos[1].id, true)
    const layout = { activeTabId: 'd', tabs: [{ kind: 'details' as const, id: 'd', name: 'Details' }, { kind: 'panes' as const, id: 't', name: 'Work', layout: { type: 'pane' as const, id: 'p', kind: 'browser' as const, url: 'https://x.test/' } }] }
    const list = await service.saveTemplate('mine', 'My flow', layout, false)
    expect(list.length).toBe(4)
    const mine = list[3]
    expect(mine).toMatchObject({ name: 'My flow', todos: ['step one'], stage: 'implement' })
    expect(mine.tabs?.[0].layout).toMatchObject({ kind: 'browser', url: 'https://x.test/' })

    const s = await service.startTemplateDesk(mine.id, '')
    expect(s.desks[1]).toMatchObject({ name: 'My flow', })
    expect(s.todos.filter((t) => t.deskId === 'my-flow').map((t) => t.title)).toEqual(['step one'])

    const again = new WorkDeskService(root, new FakeGit(), () => clock)
    await again.load()
    expect(again.listTemplates().map((t) => t.name)).toContain('My flow')
    again.status.autoCommit.dispose()

    const sched = (await service.addSchedule({ templateId: mine.id, name: 'Flow', repeat: 'daily', time: '09:00' }))[0]
    await service.deleteTemplate(mine.id)
    expect(service.listSchedules()[0]).toMatchObject({ id: sched.id, paused: true })
    expect(service.listSchedules()[0].pausedReason).toMatch(/deleted/)
    await expect(service.setSchedulePaused(sched.id, false)).rejects.toThrow(/Unknown template/)
    await service.setScheduleTemplate(sched.id, 'release')
    expect((await service.setSchedulePaused(sched.id, false))[0].paused).toBeUndefined()
    await expect(service.editTemplate('release', { name: 'x' })).rejects.toThrow()
    expect((await service.duplicateTemplate('release')).map((t) => t.name)).toContain('Release copy')
  })

  it('starts a WorkDesk from a template', async () => {
    const s = await service.startTemplateDesk('review-pr', '')
    expect(s.desks[0]).toMatchObject({ id: 'review-pr', name: 'Review PR', stage: 'in-review' })
    expect(s.todos.length).toBe(s.desks[0].todoIds.length)
    expect(s.todos.every((t) => t.deskId === 'review-pr')).toBe(true)
    await expect(service.startTemplateDesk('nope', '')).rejects.toThrow()
  })
})

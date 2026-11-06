import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { filterByTopics, allTopics } from './domain/todos'
import { WorkDeskService } from './service'
import { FakeGit } from './status/fake-git'

let root: string
let service: WorkDeskService
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workdesk-svc-'))
  service = new WorkDeskService(root, new FakeGit())
  await service.load()
})
afterEach(async () => {
  service.status.autoCommit.dispose()
  await rm(root, { recursive: true, force: true })
})

describe('Todos', () => {
  it('goes from a Todo to a WorkDesk and persists', async () => {
    let s = await service.addTodo({ title: ' Fix login ', topics: ['Auth', 'auth', ' bug '], list: 'backlog' })
    const todo = s.todos[0]
    expect(todo).toMatchObject({ title: 'Fix login', topics: ['auth', 'bug'], list: 'backlog' })

    s = await service.startPlainDesk([todo.id], '')

    expect(s.desks).toHaveLength(1)
    expect(s.desks[0]).toMatchObject({ id: 'fix-login', stage: 'implement', todoIds: [todo.id] })
    expect(s.todos[0].deskId).toBe('fix-login')
    expect(existsSync(join(root, 'fix-login', 'notes'))).toBe(true)

    await expect(service.startPlainDesk([todo.id], 'again')).rejects.toThrow(/already in a WorkDesk/)
    await expect(service.deleteTodo(todo.id)).rejects.toThrow()

    const reloaded = new WorkDeskService(root, new FakeGit())
    await reloaded.load()
    expect(reloaded.state().todos[0].deskId).toBe('fix-login')
    expect(reloaded.state().desks[0].id).toBe('fix-login')
    reloaded.status.autoCommit.dispose()
  })

  it('batches several Todos into one WorkDesk with unique ids', async () => {
    let s = await service.addTodo({ title: 'A', topics: ['x'], list: 'today' })
    s = await service.addTodo({ title: 'B', topics: ['y'], list: 'today' })
    s = await service.addTodo({ title: 'A', topics: [], list: 'today' })
    const [a, b, a2] = s.todos
    s = await service.startPlainDesk([a.id, b.id], 'Batch')
    s = await service.startPlainDesk([a2.id], 'Batch')
    expect(s.desks.map((d) => d.id)).toEqual(['batch', 'batch-2'])
    expect(s.desks[0].todoIds).toEqual([a.id, b.id])
    expect(s.desks[1].priority).toBe(1)
  })

  it('adds an empty WorkDesk: no Todos, no branches', async () => {
    const s = await service.startPlainDesk([], 'Scratch')
    expect(s.desks).toHaveLength(1)
    expect(s.desks[0]).toMatchObject({ id: 'scratch', name: 'Scratch', todoIds: [], branches: [] })
    expect(existsSync(join(root, 'scratch'))).toBe(true)
  })

  it('keeps an event log per WorkDesk: newest first, limited, and moved to the archive on Clear', async () => {
    let s = await service.addTodo({ title: 'A', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'Log me')
    await service.setDeskStage('log-me', 'testing')
    await service.parkDesk('log-me')
    await service.reactivateDesk('log-me')
    await service.setTodoResolved(s.todos[0].id, true)
    const texts = (await service.deskEvents('log-me')).map((e) => e.text)
    expect(texts).toEqual(['Todo resolved: A', 'Reactivated', 'Parked: terminals and editor shut down', 'Stage: Implement → Testing (set by hand)', 'Todo added: A', 'Plain WorkDesk started'])
    expect(await service.deskEvents('log-me', 2)).toHaveLength(2)
    expect(await service.deskEvents('nope')).toEqual([])
    // it is a file in the Status Repo, one JSON object per line
    const file = await readFile(join(service.status.dir, 'desks', 'log-me', 'events.jsonl'), 'utf8')
    expect(file.trim().split('\n')).toHaveLength(6)
    const archived = await service.status.archiveDesk(service.getState().desks[0], [], '2026-10-28')
    expect(await readFile(join(archived, 'events.jsonl'), 'utf8')).toBe(file)
    // the note of the WorkDesk is archived with it
    await service.saveNotes('desk-log-me', 'plan')
    const again = await service.status.archiveDesk(service.getState().desks[0], [], '2026-10-29')
    expect(await readFile(join(again, 'desk-note.md'), 'utf8')).toBe('plan')
    expect(await service.readNotes('desk-log-me')).toBe('')
  })

  it('resolving leaves the WorkDesk in place; filters by topic', async () => {
    let s = await service.addTodo({ title: 'A', topics: ['x', 'y'], list: 'today' })
    s = await service.addTodo({ title: 'B', topics: ['y'], list: 'backlog' })
    s = await service.setTodoResolved(s.todos[0].id, true)
    expect(s.todos[0].resolved).toBe(true)
    expect(filterByTopics(s.todos, ['y']).map((t) => t.title)).toEqual(['A', 'B'])
    expect(filterByTopics(s.todos, ['x', 'y']).map((t) => t.title)).toEqual(['A'])
    expect(allTopics(s.todos)).toEqual(['x', 'y'])
    await expect(service.addTodo({ title: '  ', topics: [], list: 'today' })).rejects.toThrow()
  })
})

describe('WorkDesk sidebar actions', () => {
  it('activates one desk at a time, reorders by drop and persists', async () => {
    let s = await service.addTodo({ title: 'A', topics: [], list: 'today' })
    s = await service.addTodo({ title: 'B', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'A')
    s = await service.startPlainDesk([s.todos[1].id], 'B')

    s = await service.activateDesk('a')
    s = await service.activateDesk('b')
    expect(s.desks.map((d) => d.presence)).toEqual(['inactive', 'active'])

    s = await service.moveDesk('b', 'a')
    expect(s.desks.find((d) => d.id === 'b')!.priority).toBe(0)

    const reloaded = new WorkDeskService(root, new FakeGit())
    await reloaded.load()
    expect(reloaded.state().desks.find((d) => d.id === 'b')!.priority).toBe(0)
    reloaded.status.autoCommit.dispose()
  })

  it('seeds demo desks in memory only', async () => {
    service.seedDemo()
    expect(service.state().desks.length).toBeGreaterThan(3)
    const reloaded = new WorkDeskService(root, new FakeGit())
    await reloaded.load()
    expect(reloaded.state().desks).toEqual([])
    reloaded.status.autoCommit.dispose()
  })
})

describe('Claude hooks in the service', () => {
  it('routes events by cwd, raises and clears Signals, records Pane sessions, opens clear non-Pane ones', async () => {
    let s = await service.addTodo({ title: 'Review', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'Review')
    const cwd = join(root, 'review', 'sub')
    const pushed: number[] = []
    service.onStateChanged = (st) => pushed.push(st.desks[0].signals.filter((x) => !x.read).length)

    await service.handleHook({ event: 'Notification', sessionId: 's1', cwd, paneId: 'p1', message: 'hi' })
    await service.handleHook({ event: 'Stop', sessionId: 's2', cwd })
    await service.handleHook({ event: 'Stop', sessionId: 's9', cwd: '/somewhere/else' })
    expect(service.state().desks[0].signals.map((x) => x.type)).toEqual(['claude-needs-input', 'claude-finished'])
    expect(service.oldestSignal('review')).toMatchObject({ sessionId: 's1', paneId: 'p1' })
    expect(await service.claudeSessions.resumeCommand('review', 'p1')).toBe(`cd '${cwd}' 2>/dev/null; claude --resume 's1'; exec "$SHELL"`)
    expect(await service.claudeSessions.resumeCommand('review', 'p2')).toBeUndefined()

    await service.handleHook({ event: 'UserPromptSubmit', sessionId: 's1', cwd, paneId: 'p1' })
    expect(service.oldestSignal('review')?.sessionId).toBe('s2')

    service.raiseSignal('review', 'command-finished', 'p1', 'exit 0')
    service.acknowledgePane('review', 'p1')
    // a terminal of no WorkDesk (the orchestrator's) is nothing to acknowledge, and no error
    expect(() => service.acknowledgePane('_orchestrator', 'orchestrator')).not.toThrow()
    expect(service.state().desks[0].signals.filter((x) => !x.read).map((x) => x.sessionId)).toEqual(['s2'])

    s = await service.activateDesk('review')
    expect(s.desks[0].signals.every((x) => x.read)).toBe(true)
    expect(pushed.length).toBeGreaterThan(3)
  })

  it('keeps Pane Signals when only opening the WorkDesk', async () => {
    let s = await service.addTodo({ title: 'X', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'X')
    await service.handleHook({ event: 'Stop', sessionId: 's', cwd: join(root, 'x'), paneId: 'p1' })
    s = await service.activateDesk('x')
    expect(s.desks[0].signals.filter((x) => !x.read)).toHaveLength(1)
    s = service.markSignalRead('x', s.desks[0].signals[0].id)
    expect(s.desks[0].signals[0].read).toBe(true)
  })
})

describe('Claude activity and Account of a WorkDesk', () => {
  it('remembers what the Claude of each Pane did last, from its hooks', async () => {
    let s = await service.addTodo({ title: 'Act', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'Act')
    const cwd = join(root, 'act')
    await service.handleHook({ event: 'UserPromptSubmit', sessionId: 's', cwd, paneId: 'p1' })
    expect(service.claudeActivity.get('act:p1')?.state).toBe('working')
    await service.handleHook({ event: 'Notification', sessionId: 's', cwd, paneId: 'p1', message: 'Allow?' })
    expect(service.claudeActivity.get('act:p1')).toMatchObject({ state: 'waiting', message: 'Allow?' })
    await service.handleHook({ event: 'Stop', sessionId: 's', cwd })
    expect(service.claudeActivity.size).toBe(1)
  })

  it('sets and clears the Account of a WorkDesk, and keeps it on disk', async () => {
    let s = await service.addTodo({ title: 'Acc', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'Acc')
    s = await service.setDeskClaudeAccount('acc', 'work1')
    expect(s.desks[0].claudeAccountId).toBe('work1')
    const reloaded = new WorkDeskService(root, new FakeGit())
    await reloaded.load()
    expect(reloaded.state().desks[0].claudeAccountId).toBe('work1')
    reloaded.status.autoCommit.dispose()
    s = await service.setDeskClaudeAccount('acc', null)
    expect('claudeAccountId' in s.desks[0]).toBe(false)
    await expect(service.setDeskClaudeAccount('nope', null)).rejects.toThrow(/Unknown/)
  })
})

describe('Todo details', () => {
  it('edits title and topics', async () => {
    const day = new Date(2026, 9, 31, 12).getTime() // 31 Oct 2026, to cross a month end
    const svc = new WorkDeskService(root, new FakeGit(), () => day)
    await svc.load()
    let s = await svc.addTodo({ title: 'Old', topics: [], list: 'backlog' })
    const id = s.todos[0].id
    s = await svc.editTodo(id, { title: '  New title ', topics: ['Work', 'work', ' Api '] })
    expect(s.todos[0]).toMatchObject({ title: 'New title', topics: ['work', 'api'] })
    await expect(svc.editTodo(id, { title: ' ' })).rejects.toThrow(/title/)

    svc.status.autoCommit.dispose()
  })

  it('keeps notes per Todo as markdown, removes them with the Todo, rejects unknown ids', async () => {
    let s = await service.addTodo({ title: 'N', topics: [], list: 'backlog' })
    const id = s.todos[0].id
    expect(await service.readNotes(id)).toBe('')
    await service.saveNotes(id, '# Notes\n- [link](https://x.y)')
    expect(await service.readNotes(id)).toBe('# Notes\n- [link](https://x.y)')
    expect(await readFile(join(service.status.dir, 'notes', `${id}.md`), 'utf8')).toContain('# Notes')

    await service.saveNotes(id, '   ')
    expect(await service.readNotes(id)).toBe('')
    await service.saveNotes(id, 'again')
    await service.deleteTodo(id)
    expect(existsSync(join(service.status.dir, 'notes', `${id}.md`))).toBe(false)
    await expect(service.readNotes('nope')).rejects.toThrow(/Unknown Todo/)
    s = await service.addTodo({ title: 'M', topics: [], list: 'backlog' })
    await expect(service.status.writeNote('../evil', 'x')).rejects.toThrow(/Invalid/)
  })

  it('gives Todos from sources their topic as before', async () => {
    const s = await service.addSourceTodo({ title: 'PR', list: 'backlog', topics: ['reviews'], source: { sourceId: 'github-prs', externalId: 'o/r#1' } })
    expect(s.todos[0].topics).toEqual(['reviews'])
  })
})

import { groupByTopic } from './domain/todos'
describe('topic groups', () => {
  it('groups by Topic with a Todo in each of its Topics and "No topic" last', () => {
    const t = (title: string, topics: string[]) => ({ title, topics })
    const groups = groupByTopic([t('a', ['work', 'api']), t('b', []), t('c', ['work']), t('d', ['reviews'])])
    expect(groups.map((g) => [g.topic, g.items.map((i) => i.title)])).toEqual([
      ['api', ['a']], ['reviews', ['d']], ['work', ['a', 'c']], ['No topic', ['b']]
    ])
  })
})

describe('Todo order', () => {
  it('places a Todo before or after another, keeps the order across restarts', async () => {
    let s = await service.addTodo({ title: 'A', topics: [], list: 'today' })
    s = await service.addTodo({ title: 'B', topics: [], list: 'today' })
    s = await service.addTodo({ title: 'C', topics: [], list: 'backlog' })
    s = await service.addTodo({ title: 'D', topics: [], list: 'today' })
    const [a, b, c, d] = s.todos.map((t) => t.id)
    const titles = (st: { todos: { title: string }[] }) => st.todos.map((t) => t.title).join('')

    expect(titles(await service.placeTodo(d, a, false))).toBe('DABC')
    expect(titles(await service.placeTodo(a, b, true))).toBe('DBAC')
    expect(titles(await service.placeTodo(c, d, false))).toBe('CDBA')
    expect(titles(await service.placeTodo(c, c, true))).toBe('CDBA')
    await expect(service.placeTodo('x', a, true)).rejects.toThrow(/Unknown Todo/)
    await expect(service.placeTodo(a, 'x', true)).rejects.toThrow(/Unknown Todo/)

    const reloaded = new WorkDeskService(root, new FakeGit())
    await reloaded.load()
    expect(titles(reloaded.state())).toBe('CDBA')
    reloaded.status.autoCommit.dispose()
    expect(b).toBeDefined()
  })
})

describe('automatic topics', () => {
  it('adds a topic once and renames the plural topics of earlier versions on load', async () => {
    let s = await service.addTodo({ title: 'T', topics: ['work'], list: 'today' })
    const id = s.todos[0].id
    s = await service.addTopic(id, 'review')
    s = await service.addTopic(id, 'review')
    expect(s.todos[0].topics).toEqual(['work', 'review'])

    await service.addSourceTodo({ title: 'Old PR', list: 'backlog', topics: ['reviews', 'x'], source: { sourceId: 'github-prs', externalId: 'o/r#1' } })
    await service.addSourceTodo({ title: 'Old ticket', list: 'backlog', topics: ['tickets'], source: { sourceId: 'notion-tickets', externalId: 'p' } })
    await service.addTodo({ title: 'Own', topics: ['reviews'], list: 'backlog' })
    const reloaded = new WorkDeskService(root, new FakeGit())
    await reloaded.load()
    // the Pull request and ticket Todos became work items; the topics of the others are renamed
    expect(reloaded.state().todos.map((t) => t.topics)).toEqual([['work', 'review'], ['reviews']])
    reloaded.status.autoCommit.dispose()
  })
})

describe('Todos of an open WorkDesk', () => {
  async function plainDesk() {
    let s = await service.addTodo({ title: 'First', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'Desk')
    return s
  }

  it('adds a Backlog Todo (moving it to Today), creates a new one in the WorkDesk, and takes one out again', async () => {
    let s = await plainDesk()
    s = await service.addTodo({ title: 'From backlog', topics: ['x'], list: 'backlog' })
    const backlogId = s.todos[1].id
    s = await service.addTodoToDesk('desk', backlogId)
    expect(s.todos[1]).toMatchObject({ deskId: 'desk', list: 'today' })
    expect(s.desks[0].todoIds).toHaveLength(2)

    s = await service.createTodoInDesk('desk', '  Brand new ')
    const made = s.todos.find((t) => t.title === 'Brand new')!
    expect(made).toMatchObject({ deskId: 'desk', list: 'today' })
    expect(s.desks[0].todoIds).toContain(made.id)

    s = await service.removeTodoFromDesk(backlogId)
    expect(s.todos.find((t) => t.id === backlogId)).toMatchObject({ deskId: undefined, list: 'today' })
    expect(s.desks[0].todoIds).not.toContain(backlogId)
    // it can go into another WorkDesk, or be deleted, now
    s = await service.deleteTodo(backlogId)
    expect(s.todos.some((t) => t.id === backlogId)).toBe(false)

    const reloaded = new WorkDeskService(root, new FakeGit())
    await reloaded.load()
    expect(reloaded.state().desks[0].todoIds).toEqual(s.desks[0].todoIds)
    reloaded.status.autoCommit.dispose()
  })

  it('a Todo is in at most one WorkDesk, and the last Todo can leave without closing the WorkDesk', async () => {
    let s = await plainDesk()
    const first = s.todos[0].id
    s = await service.addTodo({ title: 'Other', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[1].id], 'Second')
    await expect(service.addTodoToDesk('desk', s.todos[1].id)).rejects.toThrow(/already in a WorkDesk/)
    await expect(service.addTodoToDesk('nope', first)).rejects.toThrow(/Unknown WorkDesk/)
    await expect(service.removeTodoFromDesk('zzz')).rejects.toThrow(/Unknown Todo/)
    s = await service.removeTodoFromDesk(first)
    expect(s.desks.find((d) => d.id === 'desk')!.todoIds).toEqual([])
    await expect(service.removeTodoFromDesk(first)).rejects.toThrow(/in no WorkDesk/)
    await expect(service.createTodoInDesk('nope', 'x')).rejects.toThrow(/Unknown WorkDesk/)
  })

  it('a WorkDesk that reviews a pull request takes other Todos and other pull requests too', async () => {
    let s = await plainDesk()
    await service.updateDesk('desk', (d) => ({ ...d, reviews: [{ owner: 'o', repo: 'r', number: 1, url: 'u' }] }))
    s = await service.addSourceTodo({ title: 'Other PR', list: 'today', topics: ['review'], source: { sourceId: 'github-prs', externalId: 'o/r#2' } })
    const pr = s.todos[s.todos.length - 1].id
    s = await service.addTodoToDesk('desk', pr)
    expect(s.desks[0].todoIds).toContain(pr)
    s = await service.createTodoInDesk('desk', 'Remember to test X')
    expect(s.desks[0].todoIds).toHaveLength(3)
  })
})

import { migrateTodoTitles, todoPills } from './domain/todos'
import type { Todo } from './domain/types'

describe('kind and project pills', () => {
  const todo = (over: Partial<Todo>): Todo => ({ id: 'x', title: 'T', topics: [], list: 'today', resolved: false, createdAt: 0, ...over })

  it('derives kind and project from where a Todo came from, and drops topics that only repeat the kind', () => {
    const pr = todoPills(todo({ topics: ['review', 'urgent'], source: { sourceId: 'github-prs', externalId: 'acme/acme-api#773' } }))
    expect(pr.map((p) => [p.type, p.label])).toEqual([['kind', 'review #773'], ['project', 'acme-api'], ['topic', 'urgent']])
    expect(pr[1].hint).toBe('acme/acme-api')
    const ticket = todoPills(todo({ topics: ['ticket'], source: { sourceId: 'notion-tickets', externalId: 'p1', ticketKey: 'ACME-1226' } }))
    expect(ticket.map((p) => [p.type, p.label, p.kind])).toEqual([['kind', 'ticket ACME-1226', 'ticket']])
    // a Todo you wrote yourself has only its topics
    expect(todoPills(todo({ topics: ['work', 'api'] })).map((p) => [p.type, p.label])).toEqual([['topic', 'work'], ['topic', 'api']])
    expect(todoPills(todo({}))).toEqual([])
  })

  it('removes the old repository and ticket-key prefixes from titles, and only those', () => {
    const src = (externalId: string, ticketKey?: string) => ({ sourceId: externalId.includes('#') ? 'github-prs' : 'notion-tickets', externalId, ticketKey })
    const migrated = migrateTodoTitles([
      todo({ title: 'acme-api #773 Fix the login', source: src('acme/acme-api#773') }),
      todo({ title: 'acme-api#773 Fix the login', source: src('acme/acme-api#773') }),
      todo({ title: 'ACME-1226 Remove mocks', source: src('p1', 'ACME-1226') }),
      todo({ title: 'Already clean', source: src('acme/acme-api#5') }),
      todo({ title: 'acme-api #773 written by hand' }),
      todo({ title: 'ACME-1226', source: src('p2', 'ACME-1226') }),
      todo({ title: 'C++ #1 (v2.0) fix', source: src('o/c++ (v2.0)#1') })
    ])
    expect(migrated.map((t) => t.title)).toEqual(['Fix the login', 'Fix the login', 'Remove mocks', 'Already clean', 'acme-api #773 written by hand', 'ACME-1226', 'C++ #1 (v2.0) fix'])
  })
})

describe('marking a WorkDesk as unread', () => {
  it('raises a Signal of its own that opening the WorkDesk clears, can be marked as read, and shows in the events', async () => {
    let s = await service.addTodo({ title: 'T', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'Desk')
    expect(s.desks[0].signals).toEqual([])
    s = service.markUnread('desk')
    expect(s.desks[0].signals).toMatchObject([{ type: 'marked-unread', read: false }])
    s = service.markSignalRead('desk', s.desks[0].signals[0].id)
    expect(s.desks[0].signals[0].read).toBe(true)
    s = service.markUnread('desk')
    expect(s.desks[0].signals.filter((x) => !x.read)).toHaveLength(1)
    // opening the WorkDesk is reading it
    s = await service.activateDesk('desk')
    expect(s.desks[0].signals.filter((x) => !x.read)).toEqual([])
    expect(() => service.markUnread('nope')).toThrow(/Unknown WorkDesk/)
    expect((await service.recentEvents(5)).some((e) => e.type === 'signal' && e.text === 'Marked as unread')).toBe(true)
  })
})

describe('what happened lately, in which WorkDesk', () => {
  it('merges the events of all WorkDesks, newest first, with the WorkDesk, and limits them', async () => {
    let clock = 1000
    const svc = new WorkDeskService(root, new FakeGit(), () => clock)
    await svc.load()
    let s = await svc.addTodo({ title: 'A', topics: [], list: 'today' })
    s = await svc.startPlainDesk([s.todos[0].id], 'Alpha')
    clock = 2000
    s = await svc.addTodo({ title: 'B', topics: [], list: 'today' })
    s = await svc.startPlainDesk([s.todos[1].id], 'Beta')
    clock = 3000
    await svc.renameDesk('alpha', 'Alpha renamed')
    const events = await svc.recentEvents(8)
    expect(events[0]).toMatchObject({ at: 3000, deskId: 'alpha', deskName: 'Alpha renamed', type: 'name' })
    expect(events.map((e) => e.at)).toEqual([...events.map((e) => e.at)].sort((x, y) => y - x))
    expect(new Set(events.map((e) => e.deskId))).toEqual(new Set(['alpha', 'beta']))
    expect(events.filter((e) => e.type === 'started').map((e) => [e.at, e.deskName])).toEqual([[2000, 'Beta'], [1000, 'Alpha renamed']])
    expect((await svc.recentEvents(2)).map((e) => e.deskId)).toEqual(['alpha', 'beta'])
    svc.status.autoCommit.dispose()
  })
})

describe('Pull requests and tickets added to an open WorkDesk', () => {
  const pr = { kind: 'pr' as const, id: 'o/r#1', title: 'Fix' }
  const ticket = { kind: 'ticket' as const, id: 'p1', title: 'Export', ticketKey: 'ENG-1' }

  it('adds them once, and only to the WorkDesk that has them', async () => {
    let s = await service.addTodo({ title: 'A', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'Alpha')
    s = await service.addTodo({ title: 'B', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[1].id], 'Beta')
    s = await service.addDeskItem('alpha', pr)
    s = await service.addDeskItem('alpha', ticket)
    expect(s.desks.find((d) => d.id === 'alpha')!.items).toEqual([pr, ticket])
    await expect(service.addDeskItem('alpha', pr)).rejects.toThrow(/in this WorkDesk already/)
    await expect(service.addDeskItem('beta', pr)).rejects.toThrow(/already in the WorkDesk "Alpha"/)
    await expect(service.addDeskItem('nope', ticket)).rejects.toThrow(/Unknown WorkDesk/)
    s = await service.removeDeskItem('alpha', 'pr', pr.id)
    expect((await service.addDeskItem('beta', pr)).desks.find((d) => d.id === 'beta')!.items).toEqual([pr])
  })

  it('gives a WorkDesk that reviews a pull request more pull requests and tickets', async () => {
    await service.registerItemsDesk({ id: 'rev', name: 'Rev', stage: 'to-review', stageOverridden: false, presence: 'inactive', todoIds: [], items: [pr], branches: [], signals: [], createdAt: 0 }, [])
    const second = { ...pr, id: 'o/r#2' }
    expect((await service.addDeskItem('rev', second)).desks[0].items).toEqual([pr, second])
    expect((await service.addDeskItem('rev', ticket)).desks[0].items).toEqual([pr, second, ticket])
  })
})

describe('moving a Todo between WorkDesks', () => {
  async function twoDesks() {
    let s = await service.addTodo({ title: 'One', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'Alpha')
    s = await service.addTodo({ title: 'Two', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[1].id], 'Beta')
    return s
  }

  it('moves a Todo to another WorkDesk, out of any WorkDesk, and back in', async () => {
    let s = await twoDesks()
    const one = s.todos[0].id
    s = await service.assignTodoToDesk(one, 'beta')
    expect(s.todos[0].deskId).toBe('beta')
    expect(s.desks.find((d) => d.id === 'alpha')!.todoIds).toEqual([])
    expect(s.desks.find((d) => d.id === 'beta')!.todoIds).toContain(one)
    expect(s.desks.find((d) => d.id === 'beta')!.todoIds).toHaveLength(2)

    s = await service.assignTodoToDesk(one, undefined)
    expect(s.todos[0]).toMatchObject({ deskId: undefined, list: 'today' })
    expect(s.desks.find((d) => d.id === 'beta')!.todoIds).toHaveLength(1)

    s = await service.assignTodoToDesk(one, 'alpha')
    expect(s.desks.find((d) => d.id === 'alpha')!.todoIds).toEqual([one])
    // the same WorkDesk again changes nothing
    expect(await service.assignTodoToDesk(one, 'alpha')).toEqual(s)

    const reloaded = new WorkDeskService(root, new FakeGit())
    await reloaded.load()
    expect(reloaded.state().desks.map((d) => [d.id, d.todoIds.length])).toEqual([['alpha', 1], ['beta', 1]])
    reloaded.status.autoCommit.dispose()
  })

  it('changes nothing when the Todo cannot go there', async () => {
    let s = await twoDesks()
    s = await service.addSourceTodo({ title: 'A PR', list: 'today', topics: [], source: { sourceId: 'github-prs', externalId: 'o/r#9' } })
    const pr = s.todos[s.todos.length - 1].id
    s = await service.assignTodoToDesk(pr, 'alpha')
    const before = JSON.stringify(service.getState())
    await expect(service.assignTodoToDesk(pr, 'nope')).rejects.toThrow(/Unknown WorkDesk/)
    await expect(service.assignTodoToDesk('zzz', 'alpha')).rejects.toThrow(/Unknown Todo/)
    // still where it was, in its old WorkDesk, after both failed moves
    expect(JSON.stringify(service.getState())).toBe(before)
    expect(service.getState().todos.find((t) => t.id === pr)!.deskId).toBe('alpha')
    expect(service.getState().desks.find((d) => d.id === 'alpha')!.todoIds).toContain(pr)
  })
})

describe('Archive of resolved Todos', () => {
  let clock: number
  let svc: WorkDeskService
  const day = 86_400_000
  beforeEach(async () => {
    clock = new Date(2026, 9, 27, 14, 0).getTime()
    svc = new WorkDeskService(join(root, 'arch'), new FakeGit(), () => clock)
    await svc.load()
  })
  afterEach(() => svc.status.autoCommit.dispose())

  const resolve = async (title: string) => {
    const id = (await svc.addTodo({ title, topics: [], list: 'today' })).todos.find((t) => t.title === title)!.id
    await svc.setTodoResolved(id, true)
    return id
  }
  const titles = () => svc.state().todos.map((t) => t.title)

  it('keeps a Todo resolved today, and archives it the next day on load', async () => {
    await resolve('done today')
    await svc.addTodo({ title: 'open', topics: [], list: 'today' })
    expect((await svc.archiveResolved()).todos).toHaveLength(2)

    clock += day
    const next = new WorkDeskService(join(root, 'arch'), new FakeGit(), () => clock)
    await next.load()
    expect(next.state().todos.map((t) => t.title)).toEqual(['open'])
    expect((await next.archivedTodos()).map((t) => t.title)).toEqual(['done today'])
    expect((await next.archivedTodos())[0]).toMatchObject({ resolved: true, archivedAt: clock })
    next.status.autoCommit.dispose()
  })

  it('does not hide Todos that were resolved before the date was kept, and brings back the ones archived today for lack of it', async () => {
    const dir = join(root, 'arch')
    const old = (id: string, title: string) => ({ id, title, topics: [], list: 'today', resolved: true, createdAt: 1 })
    await svc.status.writeTodos([old('a', 'resolved before') as never])
    // what the first version of the archive did with a Todo like that
    await svc.status.writeArchivedTodos([{ ...old('b', 'archived by mistake'), archivedAt: clock - 1000 } as never, { ...old('c', 'archived last week'), archivedAt: clock - 7 * day } as never])
    const next = new WorkDeskService(dir, new FakeGit(), () => clock)
    await next.load()
    expect(next.state().todos.map((t) => [t.title, t.resolved, t.resolvedAt])).toEqual([['resolved before', true, clock], ['archived by mistake', true, clock - 1000]])
    expect((await next.archivedTodos()).map((t) => t.title)).toEqual(['archived last week'])
    // and the day after, they are put away like any other
    clock += day
    await next.archiveResolved()
    expect(next.state().todos).toEqual([])
    next.status.autoCommit.dispose()
  })

  it('"clear done" archives everything resolved, except Todos that sit in a WorkDesk', async () => {
    await resolve('a')
    const inDesk = await resolve('in a desk')
    await svc.setTodoResolved(inDesk, false)
    await svc.startPlainDesk([inDesk], 'desk')
    await svc.setTodoResolved(inDesk, true)
    await svc.archiveResolved(true)
    expect(titles()).toEqual(['in a desk'])
    expect((await svc.archivedTodos()).map((t) => t.title)).toEqual(['a'])
  })

  it('restores an archived Todo, open, into the Backlog', async () => {
    const id = await resolve('again')
    await svc.archiveResolved(true)
    await expect(svc.restoreTodo('nope')).rejects.toThrow(/Unknown archived/)
    const s = await svc.restoreTodo(id)
    expect(s.todos[0]).toMatchObject({ title: 'again', resolved: false, list: 'backlog' })
    expect(s.todos[0].resolvedAt).toBeUndefined()
    expect(await svc.archivedTodos()).toEqual([])
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createControl, parseControlRequest, type ControlDeps } from './control'
import type { Todo, WorkDesk } from './domain/types'

const desk = (id: string, name: string, branches: WorkDesk['branches'] = [], todoIds: string[] = []) => ({ id, name, kind: 'plain', stage: 'Implement', presence: 'active', branches, todoIds }) as unknown as WorkDesk
const todo = (id: string, title: string) => ({ id, title, resolved: false }) as Todo

function setup(extra: Partial<ControlDeps> = {}) {
  const calls: string[] = []
  const deps: ControlDeps = {
    root: '/wd',
    desks: () => [desk('a', 'Alpha', [{ project: 'p', branch: 'b', path: '/wd/a/p' } as never], ['t1']), desk('b', 'Beta'), desk('a2', 'Gamma')],
    todos: () => [todo('t1', 'one')],
    activate: async (id) => void calls.push('open ' + id),
    combine: async (t, o) => void calls.push(`combine ${t} ${o.join('+')}`),
    startPlain: async () => ({ id: 'new' }),
    park: async (id) => void calls.push('park ' + id),
    spawnClaude: async (d, prompt, name) => (calls.push(`claude ${d} ${name ?? ''} ${prompt}`), { tabId: 't', paneId: 'p' }),
    clearIssues: async () => [{ kind: 'dirty' }],
    clear: async (id) => void calls.push('clear ' + id),
    addBranch: async (d, p, b, base) => void calls.push(`add ${d} ${p} ${b} ${base ?? ''}`),
    removeBranch: async () => undefined,
    newTodo: async (d, t) => void calls.push(`todo ${d} ${t}`),
    resolveTodo: async (id, r) => void calls.push(`resolve ${id} ${r}`),
    reviewState: async () => ({ entries: [], comments: [] }),
    addComment: async (_d, root, file, line, text) => ({ root, file, line, text }),
    addNote: async (_d, root, text) => ({ root, text }),
    presets: () => [{ id: 'whole-review', name: 'Whole review' }],
    savePreset: (d, p) => ({ ...p, deskId: d }),
    removePreset: (_d, id) => void calls.push('remove-preset ' + id),
    ...extra
  }
  return { run: createControl(deps), calls }
}

describe('review presets', () => {
  it('lists, adds and removes the presets of the WorkDesk', async () => {
    const { run, calls } = setup()
    expect(await run({ control: 'review.preset', args: { desk: 'a', action: 'list' } })).toMatchObject({ ok: true, data: [{ id: 'whole-review' }] })
    expect(await run({ control: 'review.preset', args: { desk: 'a', action: 'add', name: 'API', include: ['src/api/**'] } })).toMatchObject({ ok: true, data: { name: 'API', deskId: 'a' } })
    expect(await run({ control: 'review.preset', args: { desk: 'a', action: 'remove', name: 'whole review' } })).toMatchObject({ ok: true })
    expect(calls).toEqual(['remove-preset whole-review'])
  })

  it('narrows the changed files of a review state to a preset', async () => {
    const { run } = setup({
      reviewState: async () => ({ entries: [{ path: 'a.ts' }, { path: 'a.test.ts' }], comments: [] }),
      presets: () => [{ id: 'without-tests', name: 'Without tests', exclude: ['*.test.*'] }]
    })
    expect(await run({ control: 'review.state', args: { desk: 'a', root: 'p', preset: 'without tests' } })).toMatchObject({ ok: true, data: { entries: [{ path: 'a.ts' }] } })
    expect(await run({ control: 'review.state', args: { desk: 'a', root: 'p', preset: 'nope' } })).toMatchObject({ ok: false })
  })
})

describe('desk claude', () => {
  it('starts a Claude with the prompt in the named WorkDesk, and needs a prompt', async () => {
    const { run, calls } = setup()
    expect(await run({ control: 'desk.claude', args: { desk: 'a', prompt: 'review it', name: 'Review' } })).toMatchObject({ ok: true, data: { desk: 'a', tabId: 't', paneId: 'p' } })
    expect(calls).toEqual(['claude a Review review it'])
    expect(await run({ control: 'desk.claude', args: { desk: 'a' } })).toMatchObject({ ok: false })
  })
})

describe('pane read and send', () => {
  const panes = {
    readPane: async (d: string, t: string, n: number) => ({ paneId: 'p1', tab: 'Claude', text: `${d}:${t}:${n}` }),
    sendToPane: async (d: string, t: string, text: string, enter: boolean) => (sent.push(`${d} ${t} ${text} ${enter}`), { paneId: 'p1', tab: 'Claude' })
  }
  const sent: string[] = []
  it('reads what a Pane shows, with a limit on the lines', async () => {
    const { run } = setup(panes)
    expect(await run({ control: 'pane.read', args: { desk: 'a', target: 'p1' } })).toMatchObject({ ok: true, data: { desk: 'a', paneId: 'p1', text: 'a:p1:200' } })
    expect(await run({ control: 'pane.read', args: { desk: 'a', target: 'p1', lines: 99999 } })).toMatchObject({ data: { text: 'a:p1:2000' } })
    expect(await run({ control: 'pane.read', args: { desk: 'a' } })).toMatchObject({ ok: false })
  })
  it('types into a Pane, with Enter unless told not to', async () => {
    const { run } = setup(panes)
    expect(await run({ control: 'pane.send', args: { desk: 'a', target: 'p1', text: 'yes' } })).toMatchObject({ ok: true })
    await run({ control: 'pane.send', args: { desk: 'a', target: 'p1', text: 'draft', enter: false } })
    expect(sent).toEqual(['a p1 yes true', 'a p1 draft false'])
    expect(await run({ control: 'pane.send', args: { desk: 'a', text: 'x' } })).toMatchObject({ ok: false })
  })
})

describe('control commands', () => {
  it('finds the WorkDesk from the working directory', async () => {
    const { run } = setup()
    const r = await run({ control: 'desk.current', cwd: '/wd/a/p/src' })
    expect(r).toMatchObject({ ok: true, data: { id: 'a', todos: [{ id: 't1' }] } })
  })

  it('takes a WorkDesk by name or id, and refuses a folder outside every WorkDesk', async () => {
    const { run, calls } = setup()
    await run({ control: 'desk.open', args: { desk: 'beta' } })
    expect(calls).toEqual(['open b'])
    expect(await run({ control: 'desk.current', cwd: '/elsewhere' })).toMatchObject({ ok: false })
  })

  it('combines another WorkDesk into this one', async () => {
    const { run, calls } = setup()
    expect(await run({ control: 'desk.combine', cwd: '/wd/a', args: { others: ['Beta', 'a2'] } })).toMatchObject({ ok: true, data: { combined: ['b', 'a2'], into: 'a' } })
    expect(calls).toEqual(['combine a b+a2'])
    expect(await run({ control: 'desk.combine', cwd: '/wd/a', args: { others: ['nope'] } })).toMatchObject({ ok: false })
  })

  it('clears only after the issues were shown and confirmed', async () => {
    const { run, calls } = setup()
    const first = await run({ control: 'desk.clear', args: { desk: 'a' } })
    expect(first).toMatchObject({ ok: true, data: { cleared: false, needsConfirm: true, issues: [{ kind: 'dirty' }] } })
    expect(calls).toEqual([])
    await run({ control: 'desk.clear', args: { desk: 'a', confirm: true } })
    expect(calls).toEqual(['clear a'])
  })

  it('adds a branch to the WorkDesk of the terminal', async () => {
    const { run, calls } = setup()
    await run({ control: 'branch.add', cwd: '/wd/a', args: { project: 'p', branch: 'feat', base: 'main' } })
    expect(calls).toEqual(['add a p feat main'])
  })

  it('resolves only Todos of that WorkDesk', async () => {
    const { run } = setup()
    expect(await run({ control: 'todo.resolve', args: { desk: 'a', id: 'zzz' } })).toMatchObject({ ok: false })
    expect(await run({ control: 'todo.resolve', args: { desk: 'a', id: 't1' } })).toMatchObject({ ok: true })
  })

  it('needs --root when a WorkDesk has several Branch folders and the terminal is in none', async () => {
    const two = [{ project: 'p', branch: 'b', path: '/wd/a/p' }, { project: 'q', branch: 'b', path: '/wd/a/q' }] as never[]
    const { run } = setup({ desks: () => [desk('a', 'Alpha', two)] })
    expect(await run({ control: 'review.state', args: { desk: 'a' } })).toMatchObject({ ok: false })
    expect(await run({ control: 'review.state', args: { desk: 'a', root: 'q' } })).toMatchObject({ ok: true, data: { root: '/wd/a/q' } })
  })

  it('reports an unknown command and bad input as errors, never throws', async () => {
    const { run } = setup({ activate: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(await run({ control: 'nope' })).toMatchObject({ ok: false })
    expect(await run({ control: 'desk.open', args: { desk: 'a' } })).toEqual({ ok: false, error: 'boom' })
    expect(parseControlRequest({ nothing: 1 })).toBeUndefined()
  })
})

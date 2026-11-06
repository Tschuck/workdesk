import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Orchestrator, ORCHESTRATOR_DESK, ORCHESTRATOR_PROMPT, workerCommand } from './orchestrator'

describe('Orchestrator', () => {
  it('remembers the chosen Claude Account and forgets it for the default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orch-'))
    const a = new Orchestrator(join(dir, 'o.json'), join(dir, 'run'))
    await a.load()
    expect(a.accountId()).toBeUndefined()
    await a.setAccount('work')
    const b = new Orchestrator(join(dir, 'o.json'), join(dir, 'run'))
    await b.load()
    expect(b.accountId()).toBe('work')
    await b.setAccount(null)
    expect(b.accountId()).toBeUndefined()
  })
  it('starts Claude in its folder with the instructions, and leaves a shell when Claude ends', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orch-'))
    const o = new Orchestrator(join(dir, 'o.json'), join(dir, "it's"))
    const c = o.command()
    expect(c).toContain(`cd '${join(dir, "it'\\''s")}'`)
    expect(c).toContain('claude ')
    expect(c.endsWith('exec "$SHELL"')).toBe(true)
    expect(ORCHESTRATOR_PROMPT).toContain('CLAUDE.md')
  })
  it('writes its handbook into its folder, with the commands and the glossary of WorkDesk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orch-'))
    const o = new Orchestrator(join(dir, 'o.json'), join(dir, 'run'))
    await o.load()
    const book = await readFile(join(dir, 'run', 'CLAUDE.md'), 'utf8')
    expect(book).toContain('WORKDESK_CLI')
    expect(book).toContain('desk claude')
    expect(book).toContain('**Stage**')
    expect(book).toContain('without `--yes`')
  })
  it('keeps what it started as a history, newest first, across restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orch-'))
    const a = new Orchestrator(join(dir, 'o.json'), join(dir, 'run'))
    await a.load()
    const told: number[] = []
    a.onHistory = (l) => void told.push(l.length)
    await a.record({ kind: 'spawn', deskId: 'd1', deskName: 'One', tabId: 't', paneId: 'p', prompt: 'x' }, 1)
    await a.record({ kind: 'spawn', deskId: 'd2', deskName: 'Two', tabId: 't', paneId: 'p', prompt: 'y' }, 2)
    const b = new Orchestrator(join(dir, 'o.json'), join(dir, 'run'))
    await b.load()
    expect(b.history().map((e) => e.deskId)).toEqual(['d2', 'd1'])
    expect(told).toEqual([1, 2])
  })
  it('quotes the prompt of a worker', () => {
    expect(workerCommand('/a b', "it's")).toBe(`cd '/a b'; claude 'it'\\''s'; exec "$SHELL"`)
  })
  it('has an id that no WorkDesk can have', () => {
    expect(ORCHESTRATOR_DESK.startsWith('_')).toBe(true)
  })
})

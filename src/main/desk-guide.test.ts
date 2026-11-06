import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { END, GUIDE_FILE, START, mergeGuide, ownText, renderGuide, writeDeskGuide } from './desk-guide'
import type { Todo, WorkDesk } from './domain/types'

const desk: WorkDesk = {
  id: 'rate', name: 'Rate limiting', stage: 'implement', stageOverridden: false, priority: 0, presence: 'inactive',
  todoIds: ['t1'], signals: [], createdAt: 1,
  branches: [
    { project: 'api', branch: 'feature/a', index: 1, path: '/root/rate/api-1' },
    { project: 'api', branch: 'feature/b', index: 2, base: 'feature/a', path: '/root/rate/api-2' }
  ]
}
const todos: Todo[] = [
  { id: 't1', title: 'Token bucket', topics: [], list: 'today', resolved: false, deskId: 'rate', createdAt: 1, source: { sourceId: 'notion-tickets', externalId: 'x', ticketKey: 'ENG-7' } },
  { id: 't2', title: 'Other desk', topics: [], list: 'today', resolved: false, deskId: 'other', createdAt: 1 }
]

describe('renderGuide', () => {
  it('names the WorkDesk, its Todos and branches (relative to the folder) and the rules', () => {
    const text = renderGuide(desk, todos, '/root/rate')
    expect(text).toContain('# WorkDesk: Rate limiting')
    expect(text).toContain('- [ ] Token bucket (ENG-7)')
    expect(text).not.toContain('Other desk')
    expect(text).toContain('api: `feature/a` in `api-1`')
    expect(text).toContain('on top of `feature/a` (a stack)')
    expect(text).toContain('Never delete branches')
    expect(text.startsWith(START) && text.trimEnd().endsWith(END)).toBe(true)
  })
})

describe('mergeGuide', () => {
  const block = renderGuide(desk, todos, '/root/rate')
  it('makes a new file with a place for your own notes', () => {
    const file = mergeGuide(undefined, block)
    expect(file).toContain('## Your notes for this WorkDesk')
    expect(ownText(file)).toBe('')
  })
  it('replaces only the generated block and keeps your text', () => {
    const mine = mergeGuide(undefined, block) + '\nAlways run the linter first.\n'
    const changed = renderGuide({ ...desk, name: 'Renamed' }, todos, '/root/rate')
    const next = mergeGuide(mine, changed)
    expect(next).toContain('# WorkDesk: Renamed')
    expect(next).not.toContain('# WorkDesk: Rate limiting')
    expect(ownText(next)).toBe('Always run the linter first.')
  })
  it('puts the block on top of a file the user made themselves', () => {
    const next = mergeGuide('# My own rules\n', block)
    expect(next.startsWith(START)).toBe(true)
    expect(next.endsWith('# My own rules\n')).toBe(true)
    expect(ownText(next)).toBe('# My own rules')
  })
})

describe('writeDeskGuide', () => {
  let root: string
  beforeEach(async () => void (root = await mkdtemp(join(tmpdir(), 'wd-guide-'))))
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('does not create the folder of a WorkDesk that has none', async () => {
    await writeDeskGuide(root, desk, todos)
    await expect(readFile(join(root, 'rate', GUIDE_FILE))).rejects.toThrow()
  })
  it('writes into the folder, follows changes and keeps your text', async () => {
    await mkdir(join(root, 'rate'))
    await writeDeskGuide(root, desk, todos)
    const file = join(root, 'rate', GUIDE_FILE)
    await writeFile(file, (await readFile(file, 'utf8')) + '\nmine\n')
    await writeDeskGuide(root, desk, [{ ...todos[0], resolved: true }])
    const text = await readFile(file, 'utf8')
    expect(text).toContain('- [x] Token bucket')
    expect(text.endsWith('mine\n')).toBe(true)
  })
})

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BranchWorktree } from '../domain/types'
import { EditorController } from './controller'
import { findCodeBinary, MacEditorWindows, revealFile, scripts } from './macos'
import type { EditorWindows } from './windows'
import { buildWorkspace, syncWorkspace, workspacePath } from './workspace'

const b = (project: string, branch: string, path: string): BranchWorktree => ({ project, branch, path, index: 1 })

describe('workspace file', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'workdesk-ws-')) })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('has one folder per Branch with relative paths, naming duplicates by branch', () => {
    const ws = buildWorkspace('/r/d', [b('api', 'a', '/r/d/api'), b('api', 'b', '/r/d/api--2-b'), b('web', 'w', '/r/d/web')])
    expect(ws.folders).toEqual([
      { name: 'api · a', path: 'api' },
      { name: 'api · b', path: 'api--2-b' },
      { name: 'web', path: 'web' },
      { name: 'notes', path: 'notes' }
    ])
  })

  it('syncs with the Branches and only writes on change', async () => {
    const dir = join(root, 'd')
    expect(await syncWorkspace(root, 'd', [b('api', 'a', join(dir, 'api'))])).toBe(true)
    expect(await syncWorkspace(root, 'd', [b('api', 'a', join(dir, 'api'))])).toBe(false)
    expect(await syncWorkspace(root, 'd', [b('api', 'a', join(dir, 'api')), b('web', 'w', join(dir, 'web'))])).toBe(true)
    const ws = JSON.parse(await readFile(workspacePath(root, 'd'), 'utf8'))
    expect(ws.folders.map((f: { path: string }) => f.path)).toEqual(['api', 'web', 'notes'])
  })
})

describe('macOS window control', () => {
  function setup(existing: number[]) {
    const scriptsRun: string[] = []
    const codeRun: string[][] = []
    const counts = [...existing]
    const win = new MacEditorWindows(
      async (s) => { scriptsRun.push(s); return s === scripts.count('d') ? String(counts.length > 1 ? counts.shift() : counts[0] ?? 0) : '1' },
      async (a) => { codeRun.push(a) },
      async () => undefined,
      () => '/r/d/api/README.md'
    )
    return { win, scriptsRun, codeRun }
  }

  it('brings an open window to the front without moving or resizing it', async () => {
    const { win, scriptsRun, codeRun } = setup([1])
    await win.openEditor('d', '/r/d/d.code-workspace')
    expect(codeRun).toEqual([])
    const raise = scriptsRun.at(-1)!
    expect(raise).toContain('"d (Workspace)"')
    expect(raise).toContain('AXRaise')
    expect(raise).toContain('"AXMinimized" of w to false') // back from the Dock if it was minimised
    expect(raise).not.toMatch(/set position|set size/)
  })

  it('opens the workspace first when there is no window yet', async () => {
    const { win, codeRun } = setup([0, 0, 1])
    await win.openEditor('d', '/r/d/d.code-workspace')
    expect(codeRun).toEqual([['--new-window', '/r/d/d.code-workspace']])
  })

  it('tells whether a window is open without opening one', async () => {
    const { win, codeRun } = setup([0, 1])
    expect(await win.isOpen('d')).toBe(false)
    expect(await win.isOpen('d')).toBe(true)
    expect(codeRun).toEqual([])
  })

  it('minimises the windows of other WorkDesks, one script each, and closes via the close button', async () => {
    const { win, scriptsRun, codeRun } = setup([1])
    await win.minimizeEditors(['a', 'b'])
    expect(scriptsRun).toHaveLength(2)
    expect(scriptsRun[0]).toContain('"a (Workspace)"')
    expect(scriptsRun[0]).toContain('"AXMinimized" of w to true')
    expect(scriptsRun[1]).toContain('"b (Workspace)"')
    expect(codeRun).toEqual([])
    await win.minimizeEditors([])
    expect(scriptsRun).toHaveLength(2)
    await win.closeEditor('d')
    expect(scriptsRun.at(-1)).toContain('AXCloseButton')
  })

  it('focuses a Branch folder by opening a file of it in the same window', async () => {
    const { win, codeRun } = setup([1])
    await win.focusFolder('d', '/r/d/d.code-workspace', '/r/d/api')
    // never --reuse-window: it would take the last active window, which may belong to another WorkDesk
    expect(codeRun).toEqual([['/r/d/d.code-workspace', '--goto', '/r/d/api/README.md']])
  })

  it('escapes quotes in titles', () => {
    expect(scripts.count('a"b')).toContain('a\\"b (Workspace)')
  })

  it('finds the CLI and the file to reveal', () => {
    expect(findCodeBinary((p) => p === '/usr/local/bin/code')).toBe('/usr/local/bin/code')
    expect(() => findCodeBinary(() => false)).toThrow(/not found/)
    expect(revealFile('/f', () => ['.git', 'src', 'package.json'])).toBe('/f/package.json')
    expect(revealFile('/f', () => ['.git', 'src'])).toBe('/f/src')
    expect(revealFile('/f', () => ['.git'])).toBeUndefined()
  })
})

describe('EditorController', () => {
  it('syncs the workspace, minimises the other WorkDesks first and opens its own window last', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-ec-'))
    const calls: string[] = []
    const windows: EditorWindows = {
      isOpen: async () => true,
      openEditor: async (d) => void calls.push(`open:${d}`),
      minimizeEditors: async (ids) => void calls.push(`minimize:${ids.join(',')}`),
      closeEditor: async (d) => void calls.push(`close:${d}`),
      focusFolder: async (d) => void calls.push(`focus:${d}`),
      openFile: async (d, _w, f, l) => void calls.push(`file:${d}:${f}:${l}`)
    }
    const c = new EditorController(root, windows, () => [], () => ['a', 'b', 'c'])
    await c.open('b')
    await c.focusFolder('a', '/x')
    await c.openFile('b', '/x/a.ts', 12)
    await c.close('a')
    expect(calls).toEqual(['minimize:a,c', 'open:b', 'minimize:b,c', 'focus:a', 'minimize:a,c', 'file:b:/x/a.ts:12', 'close:a'])
    await rm(root, { recursive: true, force: true })
  })
})

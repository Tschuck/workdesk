import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HookEvent } from '../domain/claude-events'
import { ClaudeSessions } from './sessions'
import { HOOK_MARKER, installHooks, isInstalled, uninstallHooks } from './installer'
import { HookServer } from './socket-server'

const run = promisify(execFile)
let tmp: string
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'workdesk-cl-')) })
afterEach(() => rm(tmp, { recursive: true, force: true }))

describe('hook installer', () => {
  const cli = '/app/cli/workdesk.mjs'
  const read = async (dir: string) => JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))

  it('adds our hooks next to existing settings and hooks, idempotently', async () => {
    const dir = join(tmp, 'c1')
    await import('node:fs/promises').then((fs) => fs.mkdir(dir))
    const existing = { theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }
    await writeFile(join(dir, 'settings.json'), JSON.stringify(existing))
    expect(await isInstalled(dir)).toBe(false)

    await installHooks(dir, cli)
    await installHooks(dir, cli)
    const s = await read(dir)
    expect(s.theme).toBe('dark')
    expect(s.hooks.Stop).toHaveLength(2)
    expect(s.hooks.Stop[0].hooks[0].command).toBe('say done')
    expect(Object.keys(s.hooks).sort()).toEqual(['Notification', 'SessionStart', 'Stop', 'UserPromptSubmit'])
    expect(s.hooks.Notification[0].hooks[0].command).toBe(`node "${cli}" hook Notification`)
    expect(await isInstalled(dir)).toBe(true)
  })

  it('uninstalls cleanly, restoring the original', async () => {
    const dir = join(tmp, 'c2')
    const existing = { theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }
    await import('node:fs/promises').then((fs) => fs.mkdir(dir))
    await writeFile(join(dir, 'settings.json'), JSON.stringify(existing))
    await installHooks(dir, cli)
    await uninstallHooks(dir)
    expect(await read(dir)).toEqual(existing)

    const empty = join(tmp, 'c3')
    await installHooks(empty, cli)
    await uninstallHooks(empty)
    expect(await read(empty)).toEqual({})
    expect(await isInstalled(empty)).toBe(false)
  })

  it('creates settings.json when missing and refuses invalid JSON without touching it', async () => {
    const fresh = join(tmp, 'c4')
    await installHooks(fresh, cli)
    expect(await isInstalled(fresh)).toBe(true)

    const bad = join(tmp, 'c5')
    await import('node:fs/promises').then((fs) => fs.mkdir(bad))
    await writeFile(join(bad, 'settings.json'), '{ nope')
    await expect(installHooks(bad, cli)).rejects.toThrow(/not valid JSON/)
    expect(await readFile(join(bad, 'settings.json'), 'utf8')).toBe('{ nope')
  })

  it('marks its commands by the CLI file name', () => {
    expect(cli).toContain(HOOK_MARKER)
  })
})

describe('hook CLI over the socket', () => {
  const cli = join(__dirname, '../../../cli/workdesk.mjs')
  const sock = () => join(tmp, 'h.sock')
  const call = (event: string, stdin: object, env: Record<string, string> = {}) =>
    new Promise<{ code: number | null }>((resolve) => {
      const child = execFile('node', [cli, 'hook', event], { env: { ...process.env, WORKDESK_SOCKET: sock(), TMUX_PANE: '', ...env } }, (err) =>
        resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0 })
      )
      child.stdin!.end(JSON.stringify(stdin))
    })

  it('delivers an event to the running app', async () => {
    const got: HookEvent[] = []
    const server = new HookServer(sock(), (e) => got.push(e))
    await server.start()
    const r = await call('Notification', { session_id: 'abc', cwd: '/r/d/api', message: 'needs you' })
    await new Promise((r) => setTimeout(r, 100))
    await server.stop()
    expect(r.code).toBe(0)
    expect(got).toEqual([expect.objectContaining({ event: 'Notification', sessionId: 'abc', cwd: '/r/d/api', message: 'needs you' })])
  })

  it('exits silently with 0 when the app is not running or input is garbage', async () => {
    expect((await call('Stop', { cwd: '/x' })).code).toBe(0)
    const { stdout, stderr } = await run('node', [cli, 'hook', 'Stop'], { env: { ...process.env, WORKDESK_SOCKET: sock() } }).catch((e) => e)
    expect(stdout ?? '').toBe('')
    expect(stderr ?? '').toBe('')
  })

  it('server ignores garbage and removes a stale socket file', async () => {
    await writeFile(sock(), 'stale')
    const got: HookEvent[] = []
    const server = new HookServer(sock(), (e) => got.push(e))
    await server.start()
    const { createConnection } = await import('node:net')
    await new Promise<void>((resolve) => {
      const c = createConnection(sock())
      c.on('connect', () => c.end('not json\n{"event":"Nope"}\n'))
      c.on('close', () => resolve())
    })
    await new Promise((r) => setTimeout(r, 50))
    await server.stop()
    expect(got).toEqual([])
  })
})

describe('Claude sessions', () => {
  it('records sessions per Pane and builds a resume command', async () => {
    const s = new ClaudeSessions(tmp)
    expect(await s.resumeCommand('d', 'p1')).toBeUndefined()
    await s.record('d', { sessionId: 'sess-1', paneId: 'p1', cwd: '/x' })
    await s.record('d', { sessionId: 'sess-2', paneId: 'p2', cwd: '/x', configDir: "/home/o'neil/.claude" })
    await s.record('d', { sessionId: 'sess-3', paneId: 'p1', cwd: '/x' })
    expect(await s.resumeCommand('d', 'p1')).toBe(`cd '/x' 2>/dev/null; claude --resume 'sess-3'; exec "$SHELL"`)
    expect(await s.resumeCommand('d', 'p2')).toBe(`cd '/x' 2>/dev/null; CLAUDE_CONFIG_DIR='/home/o'\\''neil/.claude' claude --resume 'sess-2'; exec "$SHELL"`)
    expect((await s.list('d')).map((x) => x.sessionId)).toEqual(['sess-2', 'sess-3'])
  })
})

describe('Claude config registry', () => {
  it('only installs into registered dirs, on request, and unregistering uninstalls', async () => {
    const { ClaudeConfig, defaultClaudeDirs } = await import('./config')
    const dir = join(tmp, 'claude-a')
    const cfg = new ClaudeConfig(join(tmp, 'dirs.json'), '/app/cli/workdesk.mjs')
    await expect(cfg.install(dir)).rejects.toThrow(/not a registered/)
    await cfg.add(dir)
    await cfg.add(dir)
    expect(await cfg.list()).toEqual([{ path: dir, installed: false }])
    await cfg.install(dir)
    expect(await cfg.list()).toEqual([{ path: dir, installed: true }])
    await cfg.uninstall(dir)
    await cfg.install(dir)
    await cfg.remove(dir)
    expect(await cfg.list()).toEqual([])
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toEqual({})
    expect(defaultClaudeDirs({ CLAUDE_CONFIG_DIR: '/nope' }, () => false)).toEqual([])
  })
})

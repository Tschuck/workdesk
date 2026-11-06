import { describe, expect, it } from 'vitest'
import { createClaudeAuth, firstUrl, parseAuthStatus, type Exec, type SpawnLogin } from './auth'

const LOGGED_IN = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', configDirectory: '/c', email: 'me@x.io', orgName: 'My Org', subscriptionType: 'pro' })
const LOGGED_OUT = JSON.stringify({ loggedIn: false, authMethod: 'none', configDirectory: '/c' })

describe('auth status', () => {
  it('parses logged in and logged out', () => {
    expect(parseAuthStatus(LOGGED_IN)).toEqual({ loggedIn: true, email: 'me@x.io', orgName: 'My Org', plan: 'pro', method: 'claude.ai', configDir: '/c' })
    expect(parseAuthStatus(LOGGED_OUT)).toMatchObject({ loggedIn: false, method: undefined })
    expect(parseAuthStatus('not json')).toMatchObject({ loggedIn: false, error: expect.stringContaining('unexpected output') })
  })

  it('finds a login URL in the output', () => {
    expect(firstUrl('Opening browser...\nIf it does not open, visit https://claude.ai/oauth/authorize?code=true&client_id=x')).toBe('https://claude.ai/oauth/authorize?code=true&client_id=x')
    expect(firstUrl('no link')).toBeUndefined()
  })
})

describe('claude auth commands', () => {
  const make = (over: { exec?: Exec; spawn?: SpawnLogin; binary?: string | undefined; dir?: string | undefined } = {}) =>
    createClaudeAuth({
      binary: () => ('binary' in over ? over.binary : '/bin/claude'),
      configDir: () => over.dir,
      exec: over.exec,
      spawnLogin: over.spawn,
      baseEnv: () => ({ PATH: '/p', CLAUDE_CONFIG_DIR: '/from-env' })
    })

  it('reads the status of the chosen config dir, also when it exits non-zero', async () => {
    const seen: { args: string[]; dir?: string }[] = []
    const exec: Exec = async (_f, args, env) => (seen.push({ args, dir: env['CLAUDE_CONFIG_DIR'] }), { stdout: LOGGED_OUT, code: 1 })
    expect((await make({ exec, dir: '/work' }).status()).loggedIn).toBe(false)
    expect(seen).toEqual([{ args: ['auth', 'status'], dir: '/work' }])
    // the default login must not inherit another account's directory
    await make({ exec }).status()
    expect(seen[1].dir).toBeUndefined()
  })

  it('says when claude is missing, instead of throwing', async () => {
    expect(await make({ binary: undefined }).status()).toMatchObject({ loggedIn: false, error: expect.stringContaining('claude not found') })
  })

  it('starts the login only when startLogin is called, and reports the URL once', async () => {
    const spawned: string[][] = []
    const spawn: SpawnLogin = (_f, args, _env, onOutput) => {
      spawned.push(args)
      setTimeout(() => { onOutput('Opening your browser'); onOutput('visit https://claude.ai/a'); onOutput('or https://claude.ai/b') }, 0)
      return { done: Promise.resolve(), cancel: () => undefined }
    }
    const auth = make({ spawn })
    await auth.status().catch(() => undefined)
    expect(spawned).toEqual([])
    const urls: string[] = []
    await auth.startLogin((u) => urls.push(u)).done
    await new Promise((r) => setTimeout(r, 10))
    expect(spawned).toEqual([['auth', 'login']])
    expect(urls).toEqual(['https://claude.ai/a'])
  })
})

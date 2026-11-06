import { execFile, spawn } from 'node:child_process'

/** What `claude auth status` says about the account of one Claude config directory. */
export interface AuthStatus {
  loggedIn: boolean
  email?: string
  orgName?: string
  /** e.g. pro, max */
  plan?: string
  /** e.g. claude.ai */
  method?: string
  configDir?: string
  /** why the status could not be read */
  error?: string
}

export function parseAuthStatus(stdout: string): AuthStatus {
  try {
    const j = JSON.parse(stdout) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)
    return {
      loggedIn: j['loggedIn'] === true,
      email: str(j['email']),
      orgName: str(j['orgName']),
      plan: str(j['subscriptionType']),
      method: j['authMethod'] === 'none' ? undefined : str(j['authMethod']),
      configDir: str(j['configDirectory'])
    }
  } catch {
    return { loggedIn: false, error: `unexpected output of \`claude auth status\`: ${stdout.trim().slice(0, 80) || 'nothing'}` }
  }
}

export type Exec = (file: string, args: string[], env: NodeJS.ProcessEnv) => Promise<{ stdout: string; code: number }>

export interface LoginProcess {
  /** resolves when the login finished, rejects when it failed */
  done: Promise<void>
  cancel(): void
}

export type SpawnLogin = (file: string, args: string[], env: NodeJS.ProcessEnv, onOutput: (chunk: string) => void) => LoginProcess

export const realExec: Exec = (file, args, env) =>
  new Promise((resolve) => {
    // a logged-out `claude auth status` exits with 1 but still prints its JSON
    execFile(file, args, { env, timeout: 20_000 }, (err, stdout) => resolve({ stdout, code: err ? ((err as { code?: number }).code ?? 1) : 0 }))
  })

export const realSpawnLogin: SpawnLogin = (file, args, env, onOutput) => {
  const child = spawn(file, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (c: Buffer) => onOutput(c.toString()))
  child.stderr.on('data', (c: Buffer) => onOutput(c.toString()))
  const timer = setTimeout(() => child.kill(), 5 * 60_000)
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (err) => (clearTimeout(timer), reject(err)))
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(signal ? 'Login was cancelled' : `claude auth login exited with ${code}`))
    })
  })
  return { done, cancel: () => child.kill() }
}

export interface ClaudeAuthDeps {
  binary: () => string | undefined
  /** CLAUDE_CONFIG_DIR of the account; empty = the default login */
  configDir: () => string | undefined
  exec?: Exec
  spawnLogin?: SpawnLogin
  baseEnv?: () => NodeJS.ProcessEnv
}

export const firstUrl = (text: string): string | undefined => /https?:\/\/[^\s"'<>)]+/.exec(text)?.[0]

/** Login state and explicit login/logout of one Claude account, through the `claude auth` commands. */
export function createClaudeAuth(d: ClaudeAuthDeps) {
  const exec = d.exec ?? realExec
  const spawnLogin = d.spawnLogin ?? realSpawnLogin
  const env = (): NodeJS.ProcessEnv => {
    const e = { ...(d.baseEnv?.() ?? process.env) }
    const dir = d.configDir()
    if (dir) e['CLAUDE_CONFIG_DIR'] = dir
    else delete e['CLAUDE_CONFIG_DIR']
    return e
  }
  const bin = (): string => {
    const b = d.binary()
    if (!b) throw new Error('claude not found (looked in the PATH and ~/.claude/local)')
    return b
  }
  return {
    /** Never opens anything: it only reads the stored login. */
    async status(): Promise<AuthStatus> {
      try {
        return parseAuthStatus((await exec(bin(), ['auth', 'status'], env())).stdout)
      } catch (err) {
        return { loggedIn: false, error: (err as Error).message }
      }
    },
    /** Only called when the user asks for it: Claude Code opens the browser and waits. */
    startLogin(onUrl: (url: string) => void): LoginProcess {
      let seen = false
      return spawnLogin(bin(), ['auth', 'login'], env(), (chunk) => {
        const url = !seen ? firstUrl(chunk) : undefined
        if (url) {
          seen = true
          onUrl(url)
        }
      })
    },
    async logout(): Promise<void> {
      await exec(bin(), ['auth', 'logout'], env())
    }
  }
}

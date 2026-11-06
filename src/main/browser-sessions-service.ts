import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanConfig, NO_SESSIONS, type BrowserSessionsConfig } from './domain/browser-sessions'

/** Which domains get a session of their own, in `browser-sessions.json` of the Status Repo. Read synchronously by the page guards, so it is kept in memory. */
export class BrowserSessionsService {
  private config: BrowserSessionsConfig = NO_SESSIONS

  constructor(
    private readonly statusDir: string,
    private readonly onWrite: () => void = () => undefined
  ) {}

  private get file(): string {
    return join(this.statusDir, 'browser-sessions.json')
  }

  get current(): BrowserSessionsConfig {
    return this.config
  }

  async load(): Promise<BrowserSessionsConfig> {
    try {
      this.config = cleanConfig(JSON.parse(await readFile(this.file, 'utf8')))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err
      this.config = NO_SESSIONS
    }
    return this.config
  }

  async set(input: unknown): Promise<BrowserSessionsConfig> {
    this.config = cleanConfig(input)
    await mkdir(this.statusDir, { recursive: true })
    await writeFile(this.file, JSON.stringify(this.config, null, 2) + '\n')
    this.onWrite()
    return this.config
  }
}

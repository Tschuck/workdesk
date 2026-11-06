import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { deskDir } from '../projects/layout'

export interface ClaudeSession {
  sessionId: string
  paneId: string
  cwd: string
  configDir?: string
}

const file = (root: string, deskId: string): string => join(deskDir(root, deskId), '.workdesk', 'claude-sessions.json')

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/** Claude sessions started in the tool's Panes, kept so they can be resumed after parking. */
export class ClaudeSessions {
  constructor(private readonly root: string) {}

  async list(deskId: string): Promise<ClaudeSession[]> {
    try {
      return JSON.parse(await readFile(file(this.root, deskId), 'utf8')) as ClaudeSession[]
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  /** Only sessions that run in one of our Panes are restorable. */
  async record(deskId: string, session: ClaudeSession): Promise<void> {
    const all = (await this.list(deskId)).filter((s) => s.paneId !== session.paneId && s.sessionId !== session.sessionId)
    await mkdir(dirname(file(this.root, deskId)), { recursive: true })
    await writeFile(file(this.root, deskId), JSON.stringify([...all, session], null, 2) + '\n')
  }

  /** The command that brings a Claude session back in the Pane that had it. */
  async resumeCommand(deskId: string, paneId: string): Promise<string | undefined> {
    const s = (await this.list(deskId)).find((x) => x.paneId === paneId)
    if (!s) return undefined
    const env = s.configDir ? `CLAUDE_CONFIG_DIR=${shellQuote(s.configDir)} ` : ''
    // Claude finds a session by the folder it ran in, so go there first (the Pane may start in the WorkDesk's folder).
    // If Claude ends or cannot resume, the Pane becomes a shell showing why, instead of a window that vanishes.
    return `cd ${shellQuote(s.cwd)} 2>/dev/null; ${env}claude --resume ${shellQuote(s.sessionId)}; exec "$SHELL"`
  }
}

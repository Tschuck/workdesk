import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ORCHESTRATOR_HANDBOOK } from './orchestrator-knowledge'

/** The tmux session and window of the orchestrator's Claude. The underscore keeps it from ever being a WorkDesk id. */
export const ORCHESTRATOR_DESK = '_orchestrator'
export const ORCHESTRATOR_PANE = 'orchestrator'

export const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/** What the orchestrator's Claude is told when it starts. */
export const ORCHESTRATOR_PROMPT = `You are the orchestrator of my WorkDesk app. Your handbook is CLAUDE.md in this folder (what WorkDesk is, every command, what you may do and never do): read it first.

For now: look, then tell me in a few lines where things stand and what you suggest (which WorkDesks need me, which could be parked, which could be cleared, what a worker could start). Wait for my OK before you start workers or clear anything. Parking a WorkDesk that is not worked in is fine, if you tell me.`

/** One thing the orchestrator did, kept as its history. */
export interface OrchestratorEntry {
  id: string
  /** epoch ms */
  at: number
  kind: 'spawn'
  deskId: string
  deskName: string
  tabId: string
  paneId: string
  /** what the Claude was told */
  prompt: string
}

const HISTORY_LIMIT = 300

/** the command of a worker: Claude with its prompt in the folder; when Claude ends, the window stays as a shell */
export const workerCommand = (cwd: string, prompt: string): string => `cd ${shellQuote(cwd)}; claude ${shellQuote(prompt)}; exec "$SHELL"`

interface Stored {
  accountId?: string
}

/** The orchestrator's own settings (the Claude Account it runs under), kept in the app's data folder, and the command that starts it. */
export class Orchestrator {
  private stored: Stored = {}
  private entries: OrchestratorEntry[] = []
  /** told when the history changed */
  onHistory?: (entries: OrchestratorEntry[]) => void

  constructor(
    private readonly file: string,
    /** the folder its Claude runs in */
    readonly folder: string
  ) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Stored
      if (parsed && typeof parsed.accountId === 'string' && parsed.accountId) this.stored = { accountId: parsed.accountId }
    } catch {
      // first start: the default Account
    }
    try {
      const parsed = JSON.parse(await readFile(this.historyFile, 'utf8')) as OrchestratorEntry[]
      if (Array.isArray(parsed)) this.entries = parsed
    } catch {
      // no history yet
    }
    await mkdir(this.folder, { recursive: true })
    // read by Claude Code at its start; written again every time, so it is always the handbook of this version
    await writeFile(join(this.folder, 'CLAUDE.md'), ORCHESTRATOR_HANDBOOK)
  }

  private get historyFile(): string {
    return this.file.replace(/\.json$/, '') + '-history.json'
  }

  /** newest first */
  history(): OrchestratorEntry[] {
    return [...this.entries].reverse()
  }

  async record(entry: Omit<OrchestratorEntry, 'id' | 'at'>, now = Date.now()): Promise<OrchestratorEntry> {
    const made = { ...entry, id: `${now}-${this.entries.length}`, at: now }
    this.entries = [...this.entries, made].slice(-HISTORY_LIMIT)
    await mkdir(dirname(this.historyFile), { recursive: true })
    await writeFile(this.historyFile, JSON.stringify(this.entries))
    this.onHistory?.(this.history())
    return made
  }

  /** the chosen Claude Account (none: the default one) */
  accountId(): string | undefined {
    return this.stored.accountId
  }

  async setAccount(id: string | null): Promise<void> {
    this.stored = id ? { accountId: id } : {}
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(this.stored))
  }

  /** typed into a new window: Claude with its instructions; when Claude ends, the window stays as a shell */
  command(): string {
    return `cd ${shellQuote(this.folder)}; claude ${shellQuote(ORCHESTRATOR_PROMPT)}; exec "$SHELL"`
  }
}

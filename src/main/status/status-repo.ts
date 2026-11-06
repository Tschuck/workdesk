import type { DeskTemplate } from '../domain/templates'
import type { Schedule } from '../domain/schedule'
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DeskEvent } from '../domain/events'
import { AutoCommitter, type AutoCommitOptions } from './autocommit'
import type { Git } from './git'
import type { ArchivedTodo, Stage, Todo, WorkDesk } from '../domain/types'

/** What is persisted of a WorkDesk; Signals are runtime only. */
export type StoredDesk = Omit<WorkDesk, 'signals'>

export interface ArchiveSummary {
  deskId: string
  clearedAt: string
  finalStage: Stage
  claudeSessionIds: string[]
}

export const STATUS_REPO_NAME = 'workdesk-status'

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw err
  }
}

/**
 * Reads and writes the `workdesk-status` repo inside the WorkDesk root:
 * todos.json, desks/<id>/{desk.json,notes/}, archive/<date>-<id>/.
 */
/**
 * Move a folder to a place that may have it already (a clear that stopped half way left its archive): nothing there is overwritten, an
 * entry of the same name that differs comes next to it with a number.
 */
async function moveInto(from: string, to: string): Promise<void> {
  if (!(await stat(to).catch(() => undefined))) return rename(from, to)
  for (const name of await readdir(from)) {
    const source = join(from, name)
    let dest = join(to, name)
    const there = await stat(dest).catch(() => undefined)
    if (there && (await stat(source)).isDirectory() && there.isDirectory()) {
      await moveInto(source, dest)
      continue
    }
    if (there && !(await stat(source)).isDirectory() && (await readFile(source)).equals(await readFile(dest).catch(() => Buffer.alloc(0)))) continue
    for (let n = 2; await stat(dest).catch(() => undefined); n++) dest = join(to, name.replace(/(\.[^.]*)?$/, `-${n}$1`))
    await rename(source, dest)
  }
  await rm(from, { recursive: true, force: true })
}

export class StatusRepo {
  readonly dir: string
  private readonly committer: AutoCommitter

  constructor(
    root: string,
    private readonly git: Git,
    options?: AutoCommitOptions,
    /** another folder than `<root>/workdesk-status` (a Status Repo a Profile points to) */
    dir?: string
  ) {
    this.dir = dir ?? join(root, STATUS_REPO_NAME)
    this.committer = new AutoCommitter(this.dir, git, options)
  }

  get autoCommit(): AutoCommitter {
    return this.committer
  }

  /** Create the folder layout and `git init` it when it is not a repo yet. */
  async ensure(): Promise<void> {
    for (const sub of ['desks', 'archive', 'sources', 'knowledge']) {
      await mkdir(join(this.dir, sub), { recursive: true })
    }
    if (!(await this.git.isRepo(this.dir))) await this.git.init(this.dir)
  }

  async remote(): Promise<string | undefined> {
    return this.git.remoteUrl(this.dir)
  }

  /**
   * Set (or, with an empty text, remove) the remote and push to it. The URL is checked first, so a typo
   * or missing access is reported and nothing is changed.
   */
  async setRemote(url: string): Promise<void> {
    const wanted = url.trim()
    if (wanted.startsWith('-')) throw new Error('That is not a repository URL.')
    if (wanted) await this.git.checkRemote(wanted)
    await this.git.setRemote(this.dir, wanted || undefined)
    if (wanted) await this.committer.syncNow()
  }

  /** `schedules.json`: the repeating WorkDesks. They live in the Status Repo, so they are backed up and move with it. */
  async readSchedules(): Promise<Schedule[]> {
    return readJson<Schedule[]>(join(this.dir, 'schedules.json'), [])
  }

  async writeSchedules(schedules: readonly Schedule[]): Promise<void> {
    await this.write(join(this.dir, 'schedules.json'), schedules)
  }

  /** `templates.json`: the user's own WorkDesk templates (the built-in ones are in the code). */
  async readTemplates(): Promise<DeskTemplate[]> {
    return readJson<DeskTemplate[]>(join(this.dir, 'templates.json'), [])
  }

  async writeTemplates(templates: readonly DeskTemplate[]): Promise<void> {
    await this.write(join(this.dir, 'templates.json'), templates)
  }

  async readTodos(): Promise<Todo[]> {
    return readJson<Todo[]>(join(this.dir, 'todos.json'), [])
  }

  async writeTodos(todos: readonly Todo[]): Promise<void> {
    await this.write(join(this.dir, 'todos.json'), todos)
  }

  /** `archive/todos.json`: resolved Todos that were put away. Their notes stay in `notes/`. */
  async readArchivedTodos(): Promise<ArchivedTodo[]> {
    return readJson<ArchivedTodo[]>(join(this.dir, 'archive', 'todos.json'), [])
  }

  async writeArchivedTodos(todos: readonly ArchivedTodo[]): Promise<void> {
    await this.write(join(this.dir, 'archive', 'todos.json'), todos)
  }

  /** `archive/migrated-todos.json`: Pull request and ticket Todos that became work items, so it can be undone. */
  async backupMigratedTodos(todos: readonly Todo[]): Promise<void> {
    const path = join(this.dir, 'archive', 'migrated-todos.json')
    const before = await readJson<Todo[]>(path, [])
    const fresh = todos.filter((t) => !before.some((b) => b.id === t.id))
    if (fresh.length > 0) await this.write(path, [...before, ...fresh])
  }

  /** Move a note to another name; an existing note there is never overwritten. */
  async moveNote(from: string, to: string): Promise<void> {
    const text = await this.readNote(from)
    if (text.trim() === '') return
    if ((await this.readNote(to)).trim() === '') await this.writeNote(to, text)
    await this.deleteNote(from)
  }

  private notePath(todoId: string): string {
    if (!/^[\w-]+$/.test(todoId)) throw new Error('Invalid Todo id')
    return join(this.dir, 'notes', `${todoId}.md`)
  }

  /** Markdown notes of a Todo, `notes/<id>.md`. */
  async readNote(todoId: string): Promise<string> {
    try {
      return await readFile(this.notePath(todoId), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw err
    }
  }

  async writeNote(todoId: string, text: string): Promise<void> {
    const path = this.notePath(todoId)
    if (text.trim() === '') return this.deleteNote(todoId)
    await this.write(path, text, true)
  }

  async deleteNote(todoId: string): Promise<void> {
    await rm(this.notePath(todoId), { force: true })
    this.committer.notifyChange()
  }

  notesDir(deskId: string): string {
    return join(this.dir, 'desks', deskId, 'notes')
  }

  async readDesks(): Promise<StoredDesk[]> {
    const root = join(this.dir, 'desks')
    let ids: string[]
    try {
      ids = await readdir(root)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    const desks: StoredDesk[] = []
    for (const id of ids.sort()) {
      const desk = await readJson<StoredDesk | null>(join(root, id, 'desk.json'), null)
      if (desk) desks.push(desk)
    }
    return desks
  }

  async writeDesk(desk: WorkDesk | StoredDesk): Promise<void> {
    const { signals: _signals, ...stored } = desk as WorkDesk
    await mkdir(this.notesDir(stored.id), { recursive: true })
    await this.write(join(this.dir, 'desks', stored.id, 'desk.json'), stored)
  }

  private eventsFile(deskId: string): string {
    return join(this.dir, 'desks', deskId, 'events.jsonl')
  }

  /** Add lines to the WorkDesk's event log (`desks/<id>/events.jsonl`, one JSON object per line); the log is cut to its last 500 entries when it grows large. */
  async appendEvents(deskId: string, events: readonly DeskEvent[]): Promise<void> {
    if (events.length === 0) return
    const file = this.eventsFile(deskId)
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    const size = (await stat(file)).size
    if (size > 256_000) await writeFile(file, (await this.readEvents(deskId, 500)).reverse().map((e) => JSON.stringify(e)).join('\n') + '\n')
    this.committer.notifyChange()
  }

  /** The newest `limit` entries of the event log, newest first. */
  async readEvents(deskId: string, limit: number): Promise<DeskEvent[]> {
    let text: string
    try {
      text = await readFile(this.eventsFile(deskId), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    const events: DeskEvent[] = []
    for (const line of text.split('\n').reverse()) {
      if (events.length >= limit) break
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line) as DeskEvent)
      } catch {
        // a half-written line is skipped
      }
    }
    return events
  }

  /** Move notes and the final Stage into archive/<date>-<id>/ and drop the live desk folder. */
  async archiveDesk(desk: StoredDesk, claudeSessionIds: string[], date: string): Promise<string> {
    const target = join(this.dir, 'archive', `${date}-${desk.id}`)
    await mkdir(target, { recursive: true })
    try {
      await moveInto(this.notesDir(desk.id), join(target, 'notes'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    try {
      await rename(this.eventsFile(desk.id), join(target, 'events.jsonl'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    // the note of the WorkDesk itself (`notes/desk-<id>.md`) goes along
    try {
      await rename(this.notePath(`desk-${desk.id}`), join(target, 'desk-note.md'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    const summary: ArchiveSummary = {
      deskId: desk.id,
      clearedAt: date,
      finalStage: desk.stage,
      claudeSessionIds
    }
    await this.write(join(target, 'summary.json'), summary)
    await rm(join(this.dir, 'desks', desk.id), { recursive: true, force: true })
    this.committer.notifyChange()
    return target
  }

  private async write(path: string, data: unknown, raw = false): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, raw ? String(data) : JSON.stringify(data, null, 2) + '\n')
    this.committer.notifyChange()
  }
}

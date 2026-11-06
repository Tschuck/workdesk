import type { DeskEvent } from '../domain/events'
import type { Schedule } from '../domain/schedule'
import type { DeskTemplate } from '../domain/templates'
import type { ArchivedTodo, Todo, WorkDesk } from '../domain/types'
import { DEFAULT_PROFILE_ID, HOME_REPO_ID, type RepoRef } from '../domain/profiles'
import type { AutoCommitOptions, AutoCommitter } from './autocommit'
import type { Git } from './git'
import { StatusRepo, type StoredDesk } from './status-repo'

/** Commits and pushes of every loaded Status Repo; `notifyChange` is for the home one (the settings shared by all Profiles live there). */
export class AutoCommitAll {
  constructor(private readonly home: () => AutoCommitter, private readonly all: () => AutoCommitter[]) {}
  notifyChange(): void {
    this.home().notifyChange()
  }
  flush(): Promise<void> {
    return Promise.all(this.all().map((c) => c.flush())).then(() => undefined)
  }
  dispose(): void {
    for (const c of this.all()) c.dispose()
  }
}

export interface ReposDeps {
  /** the registered Status Repos (the home one is always there) */
  repos: () => readonly RepoRef[]
  /** the Status Repo new things of a Profile are written to */
  repoIdFor: (profileId: string) => string
  /** the Profile in view (new notes of Pull requests and tickets go to its repo) */
  creationProfileId: () => string
}

/**
 * All the Status Repos the Profiles use, behind the interface of one. The service keeps every Todo and WorkDesk of every
 * loaded repo in memory (so reminders, schedules, Signals, the PR watch and time tracking run for all of them at once);
 * this routes each read and write to the repo the thing lives in. Where a thing lives is learned when it is loaded and
 * never changes by itself: pointing a Profile at another repo only decides where its NEW things go, nothing is moved.
 * Schedules, templates and the shared settings (Projects, sources, bookmarks, Claude folders) stay in the home repo.
 */
export class StatusRepos {
  readonly home: StatusRepo
  readonly autoCommit: AutoCommitAll
  private readonly loaded = new Map<string, StatusRepo>()
  private readonly todoRepo = new Map<string, string>()
  private readonly deskRepo = new Map<string, string>()
  private readonly archivedRepo = new Map<string, string>()
  private readonly lastTodos = new Map<string, string>()
  /** repos that could not be opened (folder gone, no access): the reason, so Settings can say it */
  readonly unavailable = new Map<string, string>()

  constructor(
    private readonly root: string,
    private readonly git: Git,
    private readonly deps: ReposDeps,
    private readonly options?: AutoCommitOptions
  ) {
    this.home = new StatusRepo(root, git, options)
    this.loaded.set(HOME_REPO_ID, this.home)
    this.autoCommit = new AutoCommitAll(() => this.home.autoCommit, () => [...this.loaded.values()].map((r) => r.autoCommit))
  }

  get dir(): string {
    return this.home.dir
  }

  /** The repos that are open now, home first. */
  openRepos(): { id: string; repo: StatusRepo }[] {
    return [...this.loaded].map(([id, repo]) => ({ id, repo }))
  }

  isLoaded(repoId: string): boolean {
    return this.loaded.has(repoId)
  }

  /** The repo something of this Profile is written to (untagged: Profile #1's); the home repo when its own is not available. */
  private repoIdFor(profileId?: string): string {
    const id = this.deps.repoIdFor(profileId ?? DEFAULT_PROFILE_ID)
    return this.loaded.has(id) ? id : HOME_REPO_ID
  }

  private creationRepo(): string {
    return this.repoIdFor(this.deps.creationProfileId())
  }

  private get(repoId: string): StatusRepo {
    return this.loaded.get(repoId) ?? this.home
  }

  /** Open the home repo and every registered one; one that cannot be opened is reported and left out, never fatal. */
  async ensure(): Promise<void> {
    await this.home.ensure()
    for (const ref of this.deps.repos()) await this.open(ref)
  }

  /** Open one registered repo (a no-op when it is open). */
  async open(ref: RepoRef): Promise<boolean> {
    if (ref.id === HOME_REPO_ID || this.loaded.has(ref.id)) return true
    if (!ref.path) return false
    try {
      const repo = new StatusRepo(this.root, this.git, this.options, ref.path)
      await repo.ensure()
      this.loaded.set(ref.id, repo)
      this.unavailable.delete(ref.id)
      return true
    } catch (err) {
      this.unavailable.set(ref.id, (err as Error).message)
      return false
    }
  }

  /** The Todos and WorkDesks of a repo that was just opened, for the service to merge in. */
  async readRepo(repoId: string): Promise<{ todos: Todo[]; desks: StoredDesk[] }> {
    const repo = this.get(repoId)
    const [todos, desks] = await Promise.all([repo.readTodos(), repo.readDesks()])
    for (const t of todos) this.todoRepo.set(t.id, repoId)
    for (const d of desks) this.deskRepo.set(d.id, repoId)
    this.lastTodos.set(repoId, JSON.stringify(todos))
    return { todos, desks }
  }

  /** How many Todos and WorkDesks live in a repo. */
  usage(repoId: string): { todos: number; desks: number } {
    const count = (m: Map<string, string>) => [...m.values()].filter((r) => r === repoId).length
    return { todos: count(this.todoRepo), desks: count(this.deskRepo) }
  }

  /** The folder of the Status Repo a WorkDesk lives in (or would be made in, for a new one of this Profile). */
  dirOfDesk(deskId: string, profileId?: string): string {
    return this.get(this.deskRepo.get(deskId) ?? this.repoIdFor(profileId)).dir
  }

  /** The folder of the Status Repo of a Profile: where its notes, knowledge and scratch files are. */
  dirOfProfile(profileId: string): string {
    return this.get(this.repoIdFor(profileId)).dir
  }

  dirOf(repoId: string): string {
    return this.get(repoId).dir
  }

  remoteOf(repoId: string): Promise<string | undefined> {
    return this.get(repoId).remote()
  }

  setRemoteOf(repoId: string, url: string): Promise<void> {
    return this.get(repoId).setRemote(url)
  }

  remote(): Promise<string | undefined> {
    return this.home.remote()
  }

  setRemote(url: string): Promise<void> {
    return this.home.setRemote(url)
  }

  // ── shared by all Profiles: the home repo

  readSchedules(): Promise<Schedule[]> {
    return this.home.readSchedules()
  }
  writeSchedules(s: readonly Schedule[]): Promise<void> {
    return this.home.writeSchedules(s)
  }
  readTemplates(): Promise<DeskTemplate[]> {
    return this.home.readTemplates()
  }
  writeTemplates(t: readonly DeskTemplate[]): Promise<void> {
    return this.home.writeTemplates(t)
  }
  backupMigratedTodos(todos: readonly Todo[]): Promise<void> {
    return this.home.backupMigratedTodos(todos)
  }

  // ── Todos

  async readTodos(): Promise<Todo[]> {
    const all: Todo[] = []
    for (const { id } of this.openRepos()) all.push(...(await this.readRepo(id).then((r) => r.todos)))
    return all
  }

  /** Writes each repo the Todos that live in it (and only the repos whose Todos changed). */
  async writeTodos(todos: readonly Todo[]): Promise<void> {
    const parts = new Map<string, Todo[]>([...this.loaded.keys()].map((id) => [id, []]))
    for (const t of todos) {
      const id = this.todoRepo.get(t.id) ?? this.repoIdFor(t.profileId)
      this.todoRepo.set(t.id, id)
      parts.get(id)!.push(t)
    }
    for (const [id, list] of parts) {
      const text = JSON.stringify(list)
      if (this.lastTodos.get(id) === text) continue
      await this.get(id).writeTodos(list)
      this.lastTodos.set(id, text)
    }
  }

  async readArchivedTodos(): Promise<ArchivedTodo[]> {
    const all: ArchivedTodo[] = []
    for (const { id, repo } of this.openRepos()) {
      for (const t of await repo.readArchivedTodos()) {
        this.archivedRepo.set(t.id, id)
        all.push(t)
      }
    }
    return all
  }

  async writeArchivedTodos(todos: readonly ArchivedTodo[]): Promise<void> {
    const parts = new Map<string, ArchivedTodo[]>([...this.loaded.keys()].map((id) => [id, []]))
    for (const t of todos) {
      const id = this.archivedRepo.get(t.id) ?? this.todoRepo.get(t.id) ?? this.repoIdFor(t.profileId)
      this.archivedRepo.set(t.id, id)
      parts.get(id)!.push(t)
    }
    // a repo with an archive file or something to put into it
    for (const [id, list] of parts) {
      const repo = this.get(id)
      if (list.length > 0 || (await repo.readArchivedTodos()).length > 0) await repo.writeArchivedTodos(list)
    }
  }

  // ── notes: of a Todo or WorkDesk (known), else wherever the note is, else in the repo of the Profile in view

  private noteRepoId(id: string): string | undefined {
    return this.todoRepo.get(id) ?? (id.startsWith('desk-') ? this.deskRepo.get(id.slice(5)) : undefined)
  }

  private async findNote(id: string): Promise<string | undefined> {
    const known = this.noteRepoId(id)
    if (known) return known
    for (const { id: repoId, repo } of this.openRepos()) if ((await repo.readNote(id)).trim() !== '') return repoId
    return undefined
  }

  async readNote(id: string): Promise<string> {
    const at = await this.findNote(id)
    return at ? this.get(at).readNote(id) : ''
  }

  async writeNote(id: string, text: string): Promise<void> {
    const at = (await this.findNote(id)) ?? this.creationRepo()
    return this.get(at).writeNote(id, text)
  }

  async deleteNote(id: string): Promise<void> {
    const at = await this.findNote(id)
    if (at) await this.get(at).deleteNote(id)
  }

  async moveNote(from: string, to: string): Promise<void> {
    const at = (await this.findNote(from)) ?? this.creationRepo()
    await this.get(at).moveNote(from, to)
  }

  notesDir(deskId: string): string {
    return this.get(this.deskRepo.get(deskId) ?? this.creationRepo()).notesDir(deskId)
  }

  // ── WorkDesks

  async readDesks(): Promise<StoredDesk[]> {
    const all: StoredDesk[] = []
    for (const { id } of this.openRepos()) all.push(...(await this.readRepo(id).then((r) => r.desks)))
    return all
  }

  async writeDesk(desk: WorkDesk | StoredDesk): Promise<void> {
    const id = this.deskRepo.get(desk.id) ?? this.repoIdFor(desk.profileId)
    this.deskRepo.set(desk.id, id)
    await this.get(id).writeDesk(desk)
  }

  private deskRepoOf(deskId: string): StatusRepo {
    return this.get(this.deskRepo.get(deskId) ?? HOME_REPO_ID)
  }

  appendEvents(deskId: string, events: readonly DeskEvent[]): Promise<void> {
    return this.deskRepoOf(deskId).appendEvents(deskId, events)
  }

  readEvents(deskId: string, limit: number): Promise<DeskEvent[]> {
    return this.deskRepoOf(deskId).readEvents(deskId, limit)
  }

  async archiveDesk(desk: StoredDesk, claudeSessionIds: string[], date: string): Promise<string> {
    const target = await this.deskRepoOf(desk.id).archiveDesk(desk, claudeSessionIds, date)
    this.deskRepo.delete(desk.id)
    return target
  }
}


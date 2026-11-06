import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { AppState } from '../shared/api'
import * as todoOps from './domain/todos'
import type { ArchivedTodo, DeskItem, Stage, Todo, TodoList, WorkDesk } from './domain/types'
import { applyHookEvent, type HookEvent } from './domain/claude-events'
import { activityAfter, activityKey, type ClaudeActivity } from './domain/claude-overview'
import { matchCwd } from './domain/match'
import { acknowledgeOnOpen, acknowledgePane, addSignal, markRead, oldestOpenSignal } from './domain/signal'
import { moveBefore } from './domain/order'
import { activate, park, postpone, reactivate } from './domain/presence'
import { migrateToItems } from './domain/migrate-items'
import { deriveDeskStage } from './domain/review'
import { unifyDesk } from './domain/migrate-unify'
import { clearOverride, initialStage, setStageByHand } from './domain/stage'
import { placeInDesk, stepInDesk, deskNoteId } from './domain/desk-todos'
import { setRepeat, spawnNext, type Repeat } from './domain/recurrence'
import { advance, createSchedule, dueSchedules, pause, resume, retarget, type Schedule } from './domain/schedule'
import { allTemplates, fromTemplate, templateById, type DeskTemplate } from './domain/templates'
import { USER_PREFIX, captureTemplate, deleteTemplate, duplicateTemplate, editTemplate, moveTemplate, pauseMissingTemplates } from './domain/user-templates'
import type { DeskLayout } from './domain/layout'
import type { Stage as StageType } from './domain/types'
import { dueReminders, markReminded, setDue, snoozeTodo } from './domain/reminders'
import { slugify } from './projects/layout'
import { ensureDeskFolder } from './projects/worktrees'
import { ClaudeSessions } from './claude/sessions'
import { writeDeskGuide } from './desk-guide'
import { addRef, cleanRefInput, removeRef } from './domain/page-refs'
import { describeDeskChange, type RecentEvent, describeSignal, describeTodoChanges, type DeskEvent, type NewEvent } from './domain/events'
import type { Git } from './status/git'
import { StatusRepos } from './status/status-repos'
import { DEFAULT_PROFILE_ID, HOME_REPO_ID, creationProfileId, defaultConfig, effectiveClaudeAccountId, profileIdOf, retag, stampNew } from './domain/profiles'
import type { ProfilesHost } from './profiles-service'

/** Application state of the main process: Todos and WorkDesks on top of the Status Repo. */
export class WorkDeskService {
  readonly status: StatusRepos
  private todos: Todo[] = []
  private desks: WorkDesk[] = []
  private schedules: Schedule[] = []
  /** the user's own templates (the built-in ones are in `domain/templates.ts`) */
  private userTemplates: DeskTemplate[] = []
  readonly claudeSessions: ClaudeSessions
  /** what each Claude session in a Pane did last (from its hooks); lives while the app runs */
  readonly claudeActivity = new Map<string, ClaudeActivity>()
  /** called whenever state changes without a request from the UI (Signals) */
  onStateChanged: (state: AppState) => void = () => undefined

  constructor(
    readonly root: string,
    git: Git,
    private readonly now: () => number = Date.now,
    /** the Profiles: what new Todos and WorkDesks are tagged with. Without one there is only the Default Profile. */
    private readonly profiles: ProfilesHost = { config: defaultConfig }
  ) {
    this.status = new StatusRepos(root, git, {
      repos: () => profiles.config().repos,
      repoIdFor: (pid) => profiles.config().profiles.find((p) => p.id === pid)?.repoId ?? HOME_REPO_ID,
      creationProfileId: () => creationProfileId(profiles.config())
    })
    this.claudeSessions = new ClaudeSessions(root)
  }

  async load(): Promise<void> {
    await this.status.ensure()
    this.todos = todoOps.migrateTodoTitles(todoOps.migrateTopics(await this.status.readTodos()))
    // WorkDesks from before they were all alike: no type, a list of pull requests (the files are written again when a WorkDesk is saved)
    this.desks = (await this.status.readDesks()).map((d) => ({ ...unifyDesk(d), signals: [] }))
    this.userTemplates = await this.status.readTemplates()
    this.schedules = await this.status.readSchedules()
    // a schedule whose template is gone is paused, with the reason
    const checked = pauseMissingTemplates(this.schedules, allTemplates(this.userTemplates))
    if (checked.some((s, i) => s !== this.schedules[i])) await this.saveSchedules(checked)
    await this.migrateResolvedDates()
    await this.migrateToWorkItems()
    await this.archiveResolved()
    // WorkDesks from before the guide existed get theirs
    await this.syncGuides()
  }

  state(): AppState {
    return { todos: this.todos, desks: this.desks }
  }

  async addTodo(input: { title: string; topics: string[]; list: TodoList }): Promise<AppState> {
    return this.saveTodos([...this.todos, todoOps.createTodo(randomUUID(), input, this.now())])
  }

  async setTodoResolved(id: string, resolved: boolean): Promise<AppState> {
    const before = this.todos.find((t) => t.id === id)
    const todos = todoOps.setResolved(this.todos, id, resolved, this.now())
    // a repeating Todo starts the next one, in the same WorkDesk; the resolved one keeps no repeat
    const next = before && resolved && !before.resolved ? spawnNext(before, randomUUID(), this.now()) : undefined
    if (!next) return this.saveTodos(todos)
    const done = todos.map((t) => (t.id === id ? { ...t, repeat: undefined } : t))
    const desk = next.deskId ? this.desks.find((d) => d.id === next.deskId) : undefined
    if (!desk) return this.saveTodos([...done, next])
    const withDesk = { ...desk, todoIds: [...desk.todoIds, next.id] }
    await this.status.writeDesk(withDesk)
    this.desks = this.desks.map((d) => (d.id === desk.id ? withDesk : d))
    return this.saveTodos([...done, next])
  }

  listSchedules(): Schedule[] {
    return this.schedules
  }

  private async saveSchedules(schedules: Schedule[]): Promise<Schedule[]> {
    await this.status.writeSchedules(schedules)
    this.schedules = schedules
    return schedules
  }

  async addSchedule(input: { templateId: string; name: string; repeat: Repeat; time: string }): Promise<Schedule[]> {
    templateById(input.templateId, this.userTemplates)
    return this.saveSchedules([...this.schedules, stampNew(createSchedule(randomUUID(), input, this.now()), creationProfileId(this.profiles.config()))])
  }

  async setSchedulePaused(id: string, paused: boolean): Promise<Schedule[]> {
    if (!this.schedules.some((s) => s.id === id)) throw new Error(`Unknown schedule ${id}`)
    const found = this.schedules.find((s) => s.id === id)
    if (found && !paused) templateById(found.templateId, this.userTemplates) // its template must exist to resume
    return this.saveSchedules(this.schedules.map((s) => (s.id === id ? (paused ? pause(s) : resume(s, this.now())) : s)))
  }

  /** Point a schedule at another template, e.g. after its own was deleted (resume it afterwards). */
  async setScheduleTemplate(id: string, templateId: string): Promise<Schedule[]> {
    templateById(templateId, this.userTemplates)
    if (!this.schedules.some((s) => s.id === id)) throw new Error(`Unknown schedule ${id}`)
    return this.saveSchedules(this.schedules.map((s) => (s.id === id ? retarget(s, templateId) : s)))
  }

  /** Built-in templates, then the user's own. */
  listTemplates(): DeskTemplate[] {
    return allTemplates(this.userTemplates)
  }

  template(id: string): DeskTemplate {
    return templateById(id, this.userTemplates)
  }

  private async saveTemplates(list: DeskTemplate[]): Promise<DeskTemplate[]> {
    await this.status.writeTemplates(list)
    this.userTemplates = list
    return this.listTemplates()
  }

  /** Save a WorkDesk as a template: its Stage, open Todos and Tabs (`layout`), with or without the pages and files. */
  async saveTemplate(deskId: string, name: string, layout: DeskLayout, kindsOnly: boolean): Promise<DeskTemplate[]> {
    const desk = this.desks.find((d) => d.id === deskId)
    if (!desk) throw new Error(`Unknown WorkDesk ${deskId}`)
    const t = captureTemplate(USER_PREFIX + randomUUID(), name, desk, this.todos, layout, kindsOnly)
    return this.saveTemplates([...this.userTemplates, t])
  }

  async editTemplate(id: string, patch: { name?: string; stage?: StageType; todos?: string[] }): Promise<DeskTemplate[]> {
    return this.saveTemplates(editTemplate(this.userTemplates, id, patch))
  }

  async duplicateTemplate(id: string): Promise<DeskTemplate[]> {
    return this.saveTemplates(duplicateTemplate(this.userTemplates, id, USER_PREFIX + randomUUID()))
  }

  async moveTemplate(id: string, delta: -1 | 1): Promise<DeskTemplate[]> {
    return this.saveTemplates(moveTemplate(this.userTemplates, id, delta))
  }

  /** Deleting a template pauses the schedules that use it, and says why. WorkDesks made from it are not touched. */
  async deleteTemplate(id: string): Promise<DeskTemplate[]> {
    const list = await this.saveTemplates(deleteTemplate(this.userTemplates, id))
    await this.saveSchedules(pauseMissingTemplates(this.schedules, list))
    return list
  }

  /** The WorkDesks it made stay; they are ordinary WorkDesks that no schedule watches any more. */
  async deleteSchedule(id: string): Promise<Schedule[]> {
    const freed = this.desks.filter((d) => d.scheduleId === id).map((d) => ({ ...d, scheduleId: undefined }))
    for (const d of freed) await this.status.writeDesk(d)
    this.desks = this.desks.map((d) => freed.find((f) => f.id === d.id) ?? d)
    return this.saveSchedules(this.schedules.filter((s) => s.id !== id))
  }

  /**
   * Make a planned WorkDesk for every schedule whose time has come and that has none open. Missed runs make one,
   * not several: the next run is the next occurrence after now. Returns the new WorkDesks.
   */
  async runSchedules(): Promise<WorkDesk[]> {
    if (this.schedulesRunning) return []
    this.schedulesRunning = true
    try {
      return await this.runDueSchedules()
    } finally {
      this.schedulesRunning = false
    }
  }

  private schedulesRunning = false

  private async runDueSchedules(): Promise<WorkDesk[]> {
    const now = this.now()
    const due = dueSchedules(this.schedules, this.desks, now)
    const made: WorkDesk[] = []
    for (const s of due) {
      const before = this.desks.length
      await this.startTemplateDesk(s.templateId, s.name, s)
      if (this.desks.length > before) made.push(this.desks[this.desks.length - 1])
      await this.saveSchedules(this.schedules.map((x) => (x.id === s.id ? advance(x, now) : x)))
    }
    if (made.length > 0) this.onStateChanged(this.state())
    return made
  }

  /** Repeat a Todo (needs a due time), or `null` to stop. */
  async setTodoRepeat(id: string, repeat: Repeat | null): Promise<AppState> {
    return this.saveTodos(setRepeat(this.todos, id, repeat ?? undefined))
  }

  /** A Plain WorkDesk with the Todos and Stage of a template. Its Panes are added by the caller (see `LayoutService`). */
  async startTemplateDesk(templateId: string, name: string, schedule?: Schedule): Promise<AppState> {
    const template = templateById(templateId, this.userTemplates)
    const title = name.trim() || template.name
    const id = todoOps.uniqueDeskId(title, this.desks.map((d) => d.id), slugify)
    const made = fromTemplate(template, this.desks, id, title, () => randomUUID(), this.now())
    // from a schedule it is only planned: nothing runs and no folder is made until it is opened
    const desk: WorkDesk = this.stampDesk(schedule ? { ...made.desk, presence: 'planned', scheduleId: schedule.id } : made.desk, schedule && this.profileOf(schedule))
    if (!schedule) await ensureDeskFolder(this.root, id, this.status.dirOfDesk(id, desk.profileId))
    await this.status.writeDesk(desk)
    this.desks = [...this.desks, desk]
    await this.record(id, [{ type: 'started', text: schedule ? `Planned by the schedule "${schedule.name}" from the template "${template.name}"` : `Plain WorkDesk started from the template "${template.name}"` }])
    return this.saveTodos([...this.todos, ...made.todos])
  }

  /** Pull requests and tickets are work items, not Todos: see `migrateToItems`. The Todos are kept in a backup. */
  private async migrateToWorkItems(): Promise<void> {
    const m = migrateToItems(this.todos, this.desks)
    if (m.removed.length === 0) return
    await this.status.backupMigratedTodos(m.removed)
    for (const n of m.notes) await this.status.moveNote(n.from, n.to)
    for (const d of m.desks) if (d !== this.desks.find((o) => o.id === d.id) && JSON.stringify(d) !== JSON.stringify(this.desks.find((o) => o.id === d.id))) await this.status.writeDesk(d)
    this.desks = m.desks
    await this.saveTodos(m.todos)
  }

  /**
   * Todos resolved before the date was kept have none: they count as resolved now, so they are not hidden at
   * once. Todos an earlier version archived for lack of a date, today, come back with the day they were archived.
   */
  private async migrateResolvedDates(): Promise<void> {
    const now = this.now()
    let todos = this.todos.map((t) => (t.resolved && t.resolvedAt === undefined ? { ...t, resolvedAt: now } : t))
    const archived = await this.status.readArchivedTodos()
    const back = archived.filter((t) => t.resolvedAt === undefined && t.archivedAt >= todoOps.startOfDay(now))
    if (back.length > 0) {
      await this.status.writeArchivedTodos(archived.filter((t) => !back.includes(t)))
      todos = [...todos, ...back.map(({ archivedAt, ...t }) => ({ ...t, resolvedAt: archivedAt }))]
    }
    if (back.length > 0 || todos.some((t, i) => t !== this.todos[i])) await this.saveTodos(todos)
  }

  /**
   * Put resolved Todos into the archive: those resolved on an earlier day, or all of them. Todos in a WorkDesk
   * stay with it. Does nothing (and writes nothing) when there is none.
   */
  async archiveResolved(all = false): Promise<AppState> {
    const moving = todoOps.archivable(this.todos, this.now(), all)
    if (moving.length === 0) return this.state()
    const at = this.now()
    // the archive first: a crash in between duplicates a Todo, it never loses one
    await this.status.writeArchivedTodos([...(await this.status.readArchivedTodos()), ...moving.map((t) => ({ ...t, archivedAt: at }))])
    const gone = new Set(moving.map((t) => t.id))
    return this.saveTodos(this.todos.filter((t) => !gone.has(t.id)))
  }

  archivedTodos(): Promise<ArchivedTodo[]> {
    return this.status.readArchivedTodos()
  }

  /** Bring an archived Todo back, open, into the Backlog. */
  async restoreTodo(id: string): Promise<AppState> {
    const archived = await this.status.readArchivedTodos()
    const found = archived.find((t) => t.id === id)
    if (!found) throw new Error(`Unknown archived Todo ${id}`)
    const { archivedAt: _at, ...todo } = found
    await this.saveTodos([...this.todos.filter((t) => t.id !== id), { ...todo, profileId: todo.profileId ?? DEFAULT_PROFILE_ID, resolved: false, resolvedAt: undefined, list: 'backlog', postponedUntil: undefined }])
    await this.status.writeArchivedTodos(archived.filter((t) => t.id !== id))
    return this.state()
  }

  async deleteTodo(id: string): Promise<AppState> {
    const state = await this.saveTodos(todoOps.deleteTodo(this.todos, id))
    await this.status.deleteNote(id)
    return state
  }

  async editTodo(id: string, patch: { title?: string; topics?: string[] }): Promise<AppState> {
    return this.saveTodos(todoOps.editTodo(this.todos, id, patch))
  }

  /** Put an existing Todo into an open WorkDesk. */
  async addTodoToDesk(deskId: string, todoId: string): Promise<AppState> {
    const next = todoOps.attachTodo(this.todos, this.desks, todoId, deskId)
    return this.saveDeskTodos(next, deskId)
  }

  /** Take a Todo out of its WorkDesk. */
  async removeTodoFromDesk(todoId: string): Promise<AppState> {
    const deskId = this.todos.find((t) => t.id === todoId)?.deskId
    const next = todoOps.detachTodo(this.todos, this.desks, todoId)
    return this.saveDeskTodos(next, deskId)
  }

  /** A new Todo, made straight in an open WorkDesk. */
  async createTodoInDesk(deskId: string, title: string): Promise<AppState> {
    if (!this.desks.some((d) => d.id === deskId)) throw new Error(`Unknown WorkDesk ${deskId}`)
    const added = await this.addTodo({ title, topics: [], list: 'today' })
    return this.addTodoToDesk(deskId, added.todos[added.todos.length - 1].id)
  }

  /** Capture a Todo for a WorkDesk (a new Todo in its checklist), or, without one, a loose Todo for Today. */
  async captureTodo(deskId: string | undefined, title: string): Promise<AppState> {
    return deskId ? this.createTodoInDesk(deskId, title) : this.addTodo({ title, topics: [], list: 'today' })
  }

  /** Reorder the checklist of a WorkDesk: put a Todo right before or after another one. */
  async placeDeskTodo(deskId: string, todoId: string, refId: string, after: boolean): Promise<AppState> {
    return this.reorderDeskTodos(deskId, (d) => placeInDesk(d, todoId, refId, after))
  }

  /** The same, one step up (-1) or down (1). */
  async stepDeskTodo(deskId: string, todoId: string, delta: -1 | 1): Promise<AppState> {
    return this.reorderDeskTodos(deskId, (d) => stepInDesk(d, todoId, delta))
  }

  private async reorderDeskTodos(deskId: string, fn: (d: WorkDesk) => WorkDesk): Promise<AppState> {
    const desk = this.desks.find((d) => d.id === deskId)
    if (!desk) throw new Error(`Unknown WorkDesk ${deskId}`)
    const next = fn(desk)
    if (next === desk) return this.state()
    await this.status.writeDesk(next)
    this.desks = this.desks.map((d) => (d.id === deskId ? next : d))
    return this.state()
  }

  /** Set (or with `null` remove) the due time of a Todo; a reminder raises a Signal then. */
  async setTodoDue(id: string, dueAt: number | null): Promise<AppState> {
    return this.saveTodos(setDue(this.todos, id, dueAt ?? undefined))
  }

  /** Remind again at `until`. */
  async snoozeTodo(id: string, until: number): Promise<AppState> {
    return this.saveTodos(snoozeTodo(this.todos, id, until, this.now()))
  }

  /**
   * Raise the reminders that are due: a Signal in the Todo's WorkDesk; Todos in no WorkDesk are returned,
   * so the caller can show a system notification instead. Each reminder fires once per due or snooze time.
   */
  async checkReminders(): Promise<Todo[]> {
    const now = this.now()
    const due = dueReminders(this.todos, now)
    if (due.length === 0) return []
    await this.saveTodos(markReminded(this.todos, due.map((t) => t.id), now))
    const loose: Todo[] = []
    for (const t of due) {
      if (t.deskId && this.desks.some((d) => d.id === t.deskId)) this.raiseDeskSignal(t.deskId, 'todo-due', t.title)
      else loose.push(t)
    }
    this.onStateChanged(this.state())
    return loose
  }

  /** Move a Todo to another WorkDesk, or out of its WorkDesk (`undefined`), in one step: if it cannot go there, nothing changes. */
  async assignTodoToDesk(todoId: string, deskId?: string): Promise<AppState> {
    const todo = this.todos.find((t) => t.id === todoId)
    if (!todo) throw new Error(`Unknown Todo ${todoId}`)
    if (todo.deskId === deskId) return this.state()
    let next: todoOps.TodosAndDesks = { todos: this.todos, desks: this.desks }
    if (todo.deskId) next = todoOps.detachTodo(next.todos, next.desks, todoId)
    if (deskId) next = todoOps.attachTodo(next.todos, next.desks, todoId, deskId)
    return this.saveDeskTodos(next, todo.deskId, deskId)
  }

  private async saveDeskTodos(next: todoOps.TodosAndDesks, ...deskIds: (string | undefined)[]): Promise<AppState> {
    for (const id of new Set(deskIds)) {
      const desk = next.desks.find((d) => d.id === id)
      if (desk) await this.status.writeDesk(desk)
    }
    this.desks = next.desks
    return this.saveTodos(next.todos)
  }

  /** Topics that follow from what is done with a Todo, e.g. starting a review. */
  async addTopic(id: string, topic: string): Promise<AppState> {
    return this.saveTodos(todoOps.addTopic(this.todos, id, topic))
  }

  async placeTodo(id: string, refId: string, after: boolean): Promise<AppState> {
    return this.saveTodos(todoOps.placeTodo(this.todos, id, refId, after))
  }

  async readNotes(id: string): Promise<string> {
    this.requireTodo(id)
    return this.status.readNote(id)
  }

  async saveNotes(id: string, text: string): Promise<void> {
    this.requireTodo(id)
    await this.status.writeNote(id, text)
  }

  /** Notes belong to a Todo, or to a Pull request or ticket (`pr-…`, `ticket-…`), in a WorkDesk or not. */
  private requireTodo(id: string): void {
    if (/^(pr|ticket)-[\w-]+$/.test(id)) return
    if (id.startsWith('desk-') && this.desks.some((d) => deskNoteId(d.id) === id)) return
    if (!this.todos.some((t) => t.id === id)) throw new Error(`Unknown Todo ${id}`)
  }

  /** A Todo that came from a Source. */
  addSourceTodo(input: { title: string; list: TodoList; topics?: string[]; source: NonNullable<Todo['source']> }): Promise<AppState> {
    const todo = { ...todoOps.createTodo(randomUUID(), { title: input.title, list: input.list, topics: input.topics }, this.now()), source: input.source }
    return this.saveTodos([...this.todos, todo])
  }

  getState(): AppState {
    return this.state()
  }

  uniqueDeskId(name: string): string {
    return todoOps.uniqueDeskId(name, this.desks.map((d) => d.id), slugify)
  }

  /** Add a WorkDesk that was built elsewhere (Review, Ticket) and put the Todo into it. */
  async registerDesk(desk: Omit<WorkDesk, 'priority'>, todoId: string): Promise<AppState> {
    const todo = this.todos.find((t) => t.id === todoId)
    if (!todo) throw new Error(`Unknown Todo ${todoId}`)
    if (todo.deskId) throw new Error(`"${todo.title}" is already in a WorkDesk`)
    const full: WorkDesk = this.stampDesk({ ...desk, priority: this.desks.length === 0 ? 0 : Math.max(...this.desks.map((d) => d.priority)) + 1 }, this.profileOf(todo))
    await this.status.writeDesk(full)
    this.desks = [...this.desks, full]
    await this.record(full.id, [{ type: 'started', text: 'WorkDesk started' }])
    // a Todo that gets a WorkDesk is being worked on: it is in Today
    return this.saveTodos(this.todos.map((t) => (t.id === todoId ? { ...t, deskId: full.id, list: 'today' as const, postponedUntil: undefined } : t)))
  }

  /** Add a WorkDesk built from work items; the Todos among them move into it (and into Today). */
  async registerItemsDesk(desk: Omit<WorkDesk, 'priority'>, todoIds: string[]): Promise<AppState> {
    for (const id of todoIds) {
      const todo = this.todos.find((t) => t.id === id)
      if (!todo) throw new Error(`Unknown Todo ${id}`)
      if (todo.deskId) throw new Error(`"${todo.title}" is already in a WorkDesk`)
    }
    const full: WorkDesk = this.stampDesk({ ...desk, priority: this.desks.length === 0 ? 0 : Math.max(...this.desks.map((d) => d.priority)) + 1 }, this.todoProfile(todoIds[0]))
    // a planned WorkDesk gets its folder when it is started
    if (full.presence !== 'planned') await ensureDeskFolder(this.root, full.id, this.status.dirOfDesk(full.id, full.profileId))
    await this.status.writeDesk(full)
    this.desks = [...this.desks, full]
    await this.record(full.id, [{ type: 'started', text: 'WorkDesk started' }])
    return this.saveTodos(this.todos.map((t) => (todoIds.includes(t.id) ? { ...t, deskId: full.id, list: 'today' as const, postponedUntil: undefined } : t)))
  }

  /** Put a Pull request or ticket into an open WorkDesk; one that another WorkDesk has, or a second one for a Review WorkDesk, is refused. */
  async addDeskItem(deskId: string, item: DeskItem): Promise<AppState> {
    const desk = this.desks.find((d) => d.id === deskId)
    if (!desk) throw new Error(`Unknown WorkDesk ${deskId}`)
    const holder = this.desks.find((d) => (d.items ?? []).some((i) => i.kind === item.kind && i.id === item.id))
    if (holder) throw new Error(holder.id === deskId ? `"${item.title}" is in this WorkDesk already` : `"${item.title}" is already in the WorkDesk "${holder.name}"`)
    await this.updateDesk(deskId, (d) => ({ ...d, items: [...(d.items ?? []), item] }))
    return this.state()
  }

  /** Take a Pull request or ticket out of a WorkDesk; it is offered on the dashboard again. */
  async removeDeskItem(deskId: string, kind: 'pr' | 'ticket', id: string): Promise<AppState> {
    await this.updateDesk(deskId, (d) => ({ ...d, items: (d.items ?? []).filter((i) => !(i.kind === kind && i.id === id)) }))
    return this.state()
  }

  /** Attach a web page to a WorkDesk or a Todo (kept with it in the Status Repo); a page that is attached already is refreshed. */
  async addPageRef(target: { kind: 'desk' | 'todo'; id: string }, input: unknown): Promise<AppState> {
    const clean = cleanRefInput(input)
    if (target.kind === 'desk') {
      if (!this.desks.some((d) => d.id === target.id)) throw new Error(`Unknown WorkDesk ${target.id}`)
      await this.updateDesk(target.id, (d) => ({ ...d, refs: addRef(d.refs, clean, randomUUID(), this.now()) }))
      return this.state()
    }
    if (!this.todos.some((t) => t.id === target.id)) throw new Error(`Unknown Todo ${target.id}`)
    return this.saveTodos(this.todos.map((t) => (t.id === target.id ? { ...t, refs: addRef(t.refs, clean, randomUUID(), this.now()) } : t)))
  }

  /** Detach a page from a WorkDesk or a Todo. */
  async removePageRef(target: { kind: 'desk' | 'todo'; id: string }, refId: string): Promise<AppState> {
    if (target.kind === 'desk') {
      await this.updateDesk(target.id, (d) => ({ ...d, refs: removeRef(d.refs, refId) }))
      return this.state()
    }
    return this.saveTodos(this.todos.map((t) => (t.id === target.id ? { ...t, refs: removeRef(t.refs, refId) } : t)))
  }

  /** Change a WorkDesk from outside the UI (polling) and tell the UI. */
  async updateDesk(id: string, fn: (d: WorkDesk) => WorkDesk): Promise<void> {
    const desk = this.desks.find((d) => d.id === id)
    if (!desk) return
    const next = fn(desk)
    this.desks = this.desks.map((d) => (d.id === id ? next : d))
    await this.status.writeDesk(next)
    await this.record(id, describeDeskChange(desk, next))
    await this.syncGuides()
    this.onStateChanged(this.state())
  }

  async startPlainDesk(todoIds: string[], name: string): Promise<AppState> {
    const title = name.trim() || this.todos.find((t) => t.id === todoIds[0])?.title || 'WorkDesk'
    const id = todoOps.uniqueDeskId(title, this.desks.map((d) => d.id), slugify)
    const started = todoOps.startPlainDesk(this.todos, this.desks, todoIds, id, title, this.now())
    const desk = this.stampDesk(started.desk, this.todoProfile(todoIds[0]))
    await ensureDeskFolder(this.root, id, this.status.dirOfDesk(id, desk.profileId))
    await this.status.writeDesk(desk)
    this.desks = [...this.desks, desk]
    await this.record(id, [{ type: 'started', text: 'Plain WorkDesk started' }])
    return this.saveTodos(started.todos)
  }

  async activateDesk(id: string): Promise<AppState> {
    if (this.desks.find((d) => d.id === id)?.presence === 'planned') await ensureDeskFolder(this.root, id, this.status.dirOfDesk(id))
    // opening a WorkDesk clears the Signals that are not tied to a Pane
    const opened = activate(this.desks, id).map((d) => (d.id === id ? { ...d, signals: acknowledgeOnOpen(d.signals) } : d))
    return this.saveDesks(opened)
  }

  /** Set the Stage by hand, or give it back to the tool (`auto`). */
  async setDeskStage(id: string, stage: Stage | 'auto'): Promise<AppState> {
    const desk = this.desks.find((d) => d.id === id)
    if (!desk) throw new Error(`Unknown WorkDesk ${id}`)
    const next =
      stage === 'auto'
        ? clearOverride(deriveDeskStage(desk.reviews ?? []) ?? desk.stage)
        : setStageByHand(stage)
    await this.updateDesk(id, (d) => ({ ...d, ...next }))
    return this.state()
  }

  async renameDesk(id: string, name: string): Promise<AppState> {
    const clean = name.trim()
    if (!clean) throw new Error('A WorkDesk needs a name')
    if (!this.desks.some((d) => d.id === id)) throw new Error(`Unknown WorkDesk ${id}`)
    await this.updateDesk(id, (d) => ({ ...d, name: clean }))
    return this.state()
  }

  /** The WorkDesk is gone (its files were archived): its Todos stay, but are in no WorkDesk any more. */
  async removeDesk(id: string): Promise<AppState> {
    if (!this.desks.some((d) => d.id === id)) throw new Error(`Unknown WorkDesk ${id}`)
    this.desks = this.desks.filter((d) => d.id !== id)
    return this.saveTodos(this.todos.map((t) => (t.deskId === id ? { ...t, deskId: undefined } : t)))
  }

  /** Explicitly shut a WorkDesk down; its state stays on disk. */
  async parkDesk(id: string): Promise<AppState> {
    const desk = this.desks.find((d) => d.id === id)
    if (!desk) throw new Error(`Unknown WorkDesk ${id}`)
    if (desk.presence === 'parked' || desk.presence === 'planned') return this.state()
    return this.saveDesks(this.desks.map((d) => (d.id === id ? park(d) : d)))
  }

  /** Put a WorkDesk out of the way until then (ms since the epoch), or bring it back now (`null`). Nothing is shut down: it can be parked as well. */
  async postponeDesk(id: string, until: number | null): Promise<AppState> {
    if (!this.desks.some((d) => d.id === id)) throw new Error(`Unknown WorkDesk ${id}`)
    if (until !== null && !(until > Date.now())) throw new Error('Postpone until a time that is still to come')
    return this.saveDesks(this.desks.map((d) => (d.id === id ? postpone(d, until ?? undefined) : d)))
  }

  /** Whether the list of tabs of a WorkDesk is grouped by branch (a setting of the WorkDesk; off is the default and is not stored). */
  async setDeskGroupByBranch(id: string, on: boolean): Promise<AppState> {
    if (!this.desks.some((d) => d.id === id)) throw new Error(`Unknown WorkDesk ${id}`)
    return this.saveDesks(
      this.desks.map((d) => {
        if (d.id !== id) return d
        const { groupTabsByBranch: _, ...rest } = d
        return on ? { ...rest, groupTabsByBranch: true } : rest
      })
    )
  }

  /** Which Claude Account the terminals of a WorkDesk run `claude` under (`null`: the default one). New terminals only: running shells keep their environment. */
  async setDeskClaudeAccount(id: string, accountId: string | null): Promise<AppState> {
    if (!this.desks.some((d) => d.id === id)) throw new Error(`Unknown WorkDesk ${id}`)
    return this.saveDesks(
      this.desks.map((d) => {
        if (d.id !== id) return d
        const { claudeAccountId: _, ...rest } = d
        return accountId ? { ...rest, claudeAccountId: accountId } : rest
      })
    )
  }

  /** A parked WorkDesk becomes inactive again; its Tabs and Panes come back when it is opened. */
  async reactivateDesk(id: string): Promise<AppState> {
    return this.saveDesks(this.desks.map((d) => (d.id === id ? reactivate(d) : d)))
  }

  /** Oldest open Signal of a WorkDesk: where opening it should jump to. */
  oldestSignal(deskId: string) {
    const desk = this.desks.find((d) => d.id === deskId)
    return desk ? oldestOpenSignal(desk) : undefined
  }

  markSignalRead(deskId: string, signalId: string): AppState {
    return this.updateSignals(deskId, (s) => markRead(s, signalId))
  }

  /** The Pane has been visible and focused long enough. */
  acknowledgePane(deskId: string, paneId: string): void {
    // a terminal that is no WorkDesk's (the orchestrator's) or one of a WorkDesk that was cleared meanwhile has no Signals
    if (!this.desks.some((d) => d.id === deskId)) return
    this.updateSignals(deskId, (s) => acknowledgePane(s, paneId), true)
  }

  raiseSignal(deskId: string, type: 'command-finished' | 'tests-finished', paneId: string, message?: string): void {
    this.updateSignals(deskId, (s) => addSignal(s, { id: randomUUID(), type, at: this.now(), paneId, message }), true)
  }

  /** Route a Claude hook event to its WorkDesk by working directory. */
  async handleHook(e: HookEvent): Promise<void> {
    let match = matchCwd(this.root, this.desks, e.cwd)
    if (!match) {
      // Claude may report the symlink-resolved path (/private/var…): map it back under our root
      const [realCwd, realRoot] = await Promise.all([realpath(e.cwd).catch(() => e.cwd), realpath(this.root).catch(() => this.root)])
      if (realCwd.startsWith(realRoot + sep)) match = matchCwd(this.root, this.desks, join(this.root, realCwd.slice(realRoot.length)))
    }
    if (!match) return
    this.updateSignals(match.deskId, (s) => applyHookEvent(s, e, randomUUID(), this.now(), match.branchPath), true)
    if (e.paneId) this.claudeActivity.set(activityKey(match.deskId, e.paneId), activityAfter(e, this.now()))
    if (e.paneId && e.sessionId !== 'unknown') {
      await this.claudeSessions.record(match.deskId, { sessionId: e.sessionId, paneId: e.paneId, cwd: e.cwd, configDir: e.configDir })
    }
  }

  /** A Signal that is not tied to a Pane: it clears when the WorkDesk is opened. */
  raiseDeskSignal(deskId: string, type: 'ready-to-merge' | 'marked-unread' | 'todo-due' | 'review-received' | 'new-review-comments', message?: string): void {
    this.updateSignals(deskId, (s) => addSignal(s, { id: randomUUID(), type, at: this.now(), message }), true)
  }

  /** The user's own reminder: the WorkDesk shows as unread (a Signal) until it is opened or marked as read. */
  markUnread(deskId: string): AppState {
    if (!this.desks.some((d) => d.id === deskId)) throw new Error(`Unknown WorkDesk ${deskId}`)
    this.raiseDeskSignal(deskId, 'marked-unread')
    return this.state()
  }

  private updateSignals(deskId: string, fn: (s: WorkDesk['signals']) => WorkDesk['signals'], push = false): AppState {
    const desk = this.desks.find((d) => d.id === deskId)
    if (!desk) throw new Error(`Unknown WorkDesk ${deskId}`)
    const signals = fn(desk.signals)
    if (signals === desk.signals) return this.state()
    this.desks = this.desks.map((d) => (d.id === deskId ? { ...d, signals } : d))
    const known = new Set(desk.signals.map((x) => x.id))
    void this.record(deskId, signals.filter((x) => !known.has(x.id)).map(describeSignal))
    if (push) this.onStateChanged(this.state())
    return this.state()
  }

  async moveDesk(id: string, targetId: string): Promise<AppState> {
    return this.saveDesks(moveBefore(this.desks, id, targetId))
  }

  /** Dev only: in-memory WorkDesks with Signals, Stages and Stacks to look at the sidebar rules. */
  seedDemo(): void {
    const now = this.now()
    const min = 60_000
    const b = (project: string, branch: string, index = 1, base?: string) => ({
      project, branch, base, index, path: `${this.root}/demo/${project}-${index}`
    })
    const desk = (id: string, over: Partial<WorkDesk>): WorkDesk => ({
      id, name: id, stage: initialStage(), stageOverridden: false,
      priority: this.desks.length, presence: 'inactive', todoIds: [], branches: [], signals: [],
      createdAt: now, ...over
    })
    const signal = (id: string, ago: number, type: 'claude-finished' | 'ci-finished' = 'claude-finished') =>
      ({ id, type, at: now - ago * min, read: false })
    const todo = (id: string, title: string, list: TodoList, topics: string[], deskId?: string): Todo =>
      ({ ...todoOps.createTodo(`demo-${id}`, { title, topics, list }, now), deskId, createdAt: now - 60 * min })
    this.desks = [
      ...this.desks,
      desk('demo-first', {
        name: 'Rate limiting for the public API',
        branches: [b('api', 'feature/rate-limit'), b('api', 'feature/rate-limit-headers', 2, 'feature/rate-limit'), b('api', 'feature/rate-limit-docs', 3, 'feature/rate-limit-headers'), b('web', 'feature/rate-limit-banner')],
        todoIds: ['demo-t1', 'demo-t2']
      }),
      desk('demo-second', { name: 'Review: fix login redirect loop', stage: 'to-review', branches: [b('web', 'fix/login-redirect')], todoIds: ['demo-t3'] }),
      desk('demo-waiting', { name: 'Upgrade dependencies', stage: 'waiting', branches: [b('api', 'chore/deps')], todoIds: ['demo-t4'] }),
      desk('demo-newer-signal', { name: 'WEB-212 Checkout address form', signals: [signal('s1', 5)], todoIds: ['demo-t5'] }),
      desk('demo-older-signal', { name: 'Flaky invoice export test', signals: [signal('s2', 30), signal('s3', 2, 'ci-finished')], todoIds: ['demo-t6'] })
    ]
    this.todos = [
      ...this.todos,
      todo('t1', 'Token bucket per API key', 'today', ['api'], 'demo-first'),
      todo('t2', 'Show a banner when a client is throttled', 'today', ['web'], 'demo-first'),
      todo('t3', 'Review: fix login redirect loop', 'today', ['review'], 'demo-second'),
      todo('t4', 'Bump the framework and fix the deprecations', 'today', ['chore'], 'demo-waiting'),
      todo('t5', 'WEB-212 Checkout address form', 'today', ['ticket'], 'demo-newer-signal'),
      todo('t6', 'Find out why the invoice export test is flaky', 'today', ['bug'], 'demo-older-signal'),
      todo('t7', 'Answer the security questionnaire', 'today', ['admin']),
      todo('t8', 'Write the release notes for 2.4', 'today', ['docs']),
      todo('t9', 'Look into slow dashboard queries', 'backlog', ['api', 'perf']),
      todo('t10', 'Replace the old date picker', 'backlog', ['web']),
      todo('t11', 'Draft the on-call handover template', 'backlog', ['docs'])
    ]
  }

  private async saveDesks(desks: WorkDesk[]): Promise<AppState> {
    const changed = desks.filter((d, i) => JSON.stringify({ ...d, signals: 0 }) !== JSON.stringify({ ...this.desks[i], signals: 0 }))
    const before = new Map(this.desks.map((d) => [d.id, d]))
    this.desks = desks
    for (const d of changed) {
      if (d.id.startsWith('demo-') || d.presence === 'planned') continue
      await this.status.writeDesk(d)
      const old = before.get(d.id)
      if (old) await this.record(d.id, describeDeskChange(old, d))
    }
    await this.syncGuides()
    return this.state()
  }

  /** A new WorkDesk belongs to the Profile of its first Todo, else to the one in view (Profile #1 while all are in view). */
  private stampDesk(desk: WorkDesk, fromProfile?: string): WorkDesk {
    return stampNew(desk, fromProfile ?? creationProfileId(this.profiles.config()))
  }

  /** New Todos belong to the Profile of their WorkDesk, else to the one in view. */
  private stampTodos(todos: Todo[]): Todo[] {
    const known = new Set(this.todos.map((t) => t.id))
    const fallback = creationProfileId(this.profiles.config())
    return todos.map((t) => (known.has(t.id) || t.profileId ? t : stampNew(t, (t.deskId && this.desks.find((d) => d.id === t.deskId)?.profileId) || fallback)))
  }

  /** Give everything of a Profile that is removed to another one (nothing is deleted). */
  async retagProfile(from: string, to: string): Promise<AppState> {
    const desks = retag(this.desks, from, to)
    for (const d of desks) if (d !== this.desks.find((o) => o.id === d.id)) await this.status.writeDesk(d)
    this.desks = desks
    const schedules = retag(this.schedules, from, to)
    if (schedules.some((s, i) => s !== this.schedules[i])) await this.saveSchedules(schedules)
    return this.saveTodos(retag(this.todos, from, to))
  }

  private todoProfile(todoId: string | undefined): string | undefined {
    const t = this.todos.find((x) => x.id === todoId)
    return t && this.profileOf(t)
  }

  /**
   * Take in the Todos and WorkDesks of Status Repos that were registered while the app runs (a Profile was pointed at a
   * new repo). Everything of them is live from then on, like the repos loaded at the start.
   */
  async attachRepos(): Promise<AppState> {
    let changed = false
    for (const ref of this.profiles.config().repos) {
      if (this.status.isLoaded(ref.id) || !(await this.status.open(ref))) continue
      const { todos, desks } = await this.status.readRepo(ref.id)
      const have = new Set(this.todos.map((t) => t.id))
      const haveDesks = new Set(this.desks.map((d) => d.id))
      this.todos = [...this.todos, ...todos.filter((t) => !have.has(t.id))]
      this.desks = [...this.desks, ...desks.filter((d) => !haveDesks.has(d.id)).map((d) => ({ ...d, signals: [] }))]
      changed = true
    }
    if (changed) this.onStateChanged(this.state())
    return this.state()
  }

  /** The WorkDesks with the Claude Account they run under filled in: their own, else their Profile's, else none (the default Account). */
  desksWithClaudeAccount(): WorkDesk[] {
    const cfg = this.profiles.config()
    return this.desks.map((d) => {
      const claudeAccountId = effectiveClaudeAccountId(d, cfg)
      return claudeAccountId === d.claudeAccountId ? d : { ...d, claudeAccountId }
    })
  }

  /** The Profile a WorkDesk or Todo belongs to (Profile #1 without a tag). */
  profileOf(item: { profileId?: string }): string {
    return profileIdOf(item, this.profiles.config())
  }

  private async saveTodos(todos: Todo[]): Promise<AppState> {
    todos = this.stampTodos(todos)
    await this.status.writeTodos(todos.filter((t) => !t.id.startsWith('demo-')))
    const before = this.todos
    this.todos = todos
    for (const d of this.desks) await this.record(d.id, describeTodoChanges(d.id, before, todos))
    await this.syncGuides()
    return this.state()
  }

  /** Add lines to a WorkDesk's event log. The log is a convenience: a failing write never blocks the change itself. */
  private async record(deskId: string, events: readonly NewEvent[]): Promise<void> {
    if (events.length === 0 || deskId.startsWith('demo-')) return
    const at = this.now()
    try {
      await this.status.appendEvents(deskId, events.map((e): DeskEvent => ({ at, ...e })))
    } catch {
      // see above
    }
  }

  /** The newest events of all WorkDesks together, newest first, each with the WorkDesk it happened in. */
  async recentEvents(limit = 8): Promise<RecentEvent[]> {
    const n = Math.max(1, Math.min(limit, 50))
    const perDesk = await Promise.all(this.desks.map(async (d) => (await this.status.readEvents(d.id, n)).map((e): RecentEvent => ({ ...e, deskId: d.id, deskName: d.name }))))
    return perDesk.flat().sort((a, b) => b.at - a.at).slice(0, n)
  }

  /** The newest entries of a WorkDesk's event log, newest first. */
  deskEvents(deskId: string, limit = 20): Promise<DeskEvent[]> {
    return this.status.readEvents(deskId, Math.max(1, Math.min(limit, 200)))
  }

  /** Keep `<desk>/CLAUDE.md` current (name, Todos, branches); a failing write never blocks the change itself. */
  private async syncGuides(): Promise<void> {
    for (const d of this.desks) {
      if (d.id.startsWith('demo-') || d.presence === 'planned') continue
      try {
        await writeDeskGuide(this.root, d, this.todos)
      } catch {
        // the guide is a convenience: the next change writes it again
      }
    }
  }
}

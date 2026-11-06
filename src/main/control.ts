import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { matchCwd } from './domain/match'
import { filterByPreset, type ReviewPreset } from './domain/review-presets'
import type { Todo, WorkDesk } from './domain/types'
import { openSignals } from './domain/signal'
import { dayKey, type TimeLog } from './domain/time-tracking'
import type { ClaudeRow } from './domain/claude-overview'

/** What `workdesk desk|branch|todo|review …` sends over the socket: a command, where it was typed, and its arguments. */
export interface ControlRequest {
  control: string
  cwd?: string
  args?: Record<string, unknown>
}

export type ControlReply = { ok: true; data: unknown } | { ok: false; error: string }

export interface ControlDeps {
  root: string
  desks(): WorkDesk[]
  todos(): Todo[]
  activate(id: string): Promise<unknown>
  combine(targetId: string, otherIds: string[]): Promise<unknown>
  startPlain(todoIds: string[], name: string): Promise<{ id: string }>
  park(id: string): Promise<unknown>
  /** WorkDesks whose pull requests are all merged or closed and whose Todos are done: clearing is worth suggesting */
  closable?(): ReadonlySet<string>
  /** time spent per day and WorkDesk */
  timeLog?(): TimeLog
  /** the Claude sessions running in WorkDesks, with their state */
  claudeRows?(): Promise<ClaudeRow[]>
  /** what a terminal Pane of the WorkDesk shows (target: a Pane id or the name of its Tab); the last `lines` lines */
  readPane?(deskId: string, target: string, lines: number): Promise<{ paneId: string; tab?: string; text: string }>
  /** type into a terminal Pane of the WorkDesk, as if by hand */
  sendToPane?(deskId: string, target: string, text: string, enter: boolean): Promise<{ paneId: string; tab?: string }>
  /** a new Terminal Tab in the WorkDesk that runs Claude with this prompt */
  spawnClaude(deskId: string, prompt: string, name?: string): Promise<{ tabId: string; paneId: string }>
  clearIssues(id: string): Promise<unknown[]>
  clear(id: string): Promise<unknown>
  addBranch(deskId: string, project: string, branch: string, base?: string): Promise<unknown>
  removeBranch(deskId: string, project: string, branch: string): Promise<unknown>
  newTodo(deskId: string, title: string): Promise<unknown>
  resolveTodo(id: string, resolved: boolean): Promise<unknown>
  reviewState(deskId: string, root: string): Promise<{ base?: string; mergeBase?: string; message?: string; entries: unknown[]; comments: unknown[] }>
  addComment(deskId: string, root: string, file: string, line: number, text: string): Promise<unknown>
  addNote(deskId: string, root: string, text: string): Promise<unknown>
  presets(deskId: string): unknown[]
  savePreset(deskId: string, preset: { name?: unknown; description?: unknown; include?: unknown; exclude?: unknown; files?: unknown }): unknown
  removePreset(deskId: string, id: string): void
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)

const summary = (d: WorkDesk, todos: Todo[]) => ({
  id: d.id,
  name: d.name,
  reviews: (d.reviews ?? []).map((r) => `${r.owner}/${r.repo}#${r.number}`),
  stage: d.stage,
  presence: d.presence,
  branches: d.branches.map((b) => ({ project: b.project, branch: b.branch, path: b.path })),
  todos: d.todoIds.map((id) => todos.find((t) => t.id === id)).filter((t): t is Todo => !!t).map((t) => ({ id: t.id, title: t.title, resolved: t.resolved }))
})

/** The commands a Claude session (or you) in a WorkDesk terminal can give the app. By default they act on the WorkDesk the working directory belongs to. */
export function createControl(d: ControlDeps): (req: ControlRequest) => Promise<ControlReply> {
  const fromCwd = async (cwd?: string) => {
    if (!cwd) return undefined
    let m = matchCwd(d.root, d.desks(), cwd)
    if (!m) {
      const [real, realRoot] = await Promise.all([realpath(cwd).catch(() => cwd), realpath(d.root).catch(() => d.root)])
      if (real.startsWith(realRoot + '/')) m = matchCwd(d.root, d.desks(), resolve(d.root, real.slice(realRoot.length + 1)))
    }
    return m
  }
  /** a WorkDesk by `--desk` (id, or a name that is unique), else the one the terminal is in */
  const deskOf = async (req: ControlRequest): Promise<WorkDesk> => {
    const want = str(req.args?.desk)
    const desks = d.desks()
    if (want) {
      const hit = desks.find((x) => x.id === want) ?? (desks.filter((x) => x.name.toLowerCase() === want.toLowerCase()).length === 1 ? desks.find((x) => x.name.toLowerCase() === want.toLowerCase()) : undefined)
      if (!hit) throw new Error(`No WorkDesk "${want}" (or more than one with that name; use its id)`)
      return hit
    }
    const m = await fromCwd(req.cwd)
    const hit = m && desks.find((x) => x.id === m.deskId)
    if (!hit) throw new Error('This folder is not in a WorkDesk; run it in a WorkDesk terminal or pass --desk <id>')
    return hit
  }
  /** the Branch folder to review: `--root`, else the one the terminal is in, else the only one */
  const rootOf = async (desk: WorkDesk, req: ControlRequest): Promise<string> => {
    const given = str(req.args?.root)
    if (given) {
      const hit = desk.branches.find((b) => b.path === given || b.project === given || `${b.project}/${b.branch}` === given)
      if (!hit) throw new Error(`"${given}" is not a Branch folder of ${desk.name}`)
      return hit.path
    }
    const m = await fromCwd(req.cwd)
    if (m?.deskId === desk.id && m.branchPath) return m.branchPath
    if (desk.branches.length === 1) return desk.branches[0].path
    throw new Error(`${desk.name} has ${desk.branches.length} Branch folders; pass --root <project or path>`)
  }

  return async (req) => {
    try {
      const todos = d.todos()
      const a = req.args ?? {}
      switch (req.control) {
        case 'desk.list': {
          // what the orchestrator needs to decide: who needs the user, what runs, what was worked in today, what could be parked or cleared
          const closable = d.closable?.() ?? new Set<string>()
          const log = d.timeLog?.() ?? {}
          const now = Date.now()
          const today = dayKey(now)
          const yesterday = dayKey(now - 86_400_000)
          const claude = (await d.claudeRows?.().catch(() => [])) ?? []
          return {
            ok: true,
            data: d.desks().map((x) => ({
              ...summary(x, todos),
              openSignals: openSignals(x).map((s) => ({ type: s.type, message: s.message, at: new Date(s.at).toISOString() })),
              postponedUntil: x.postponedUntil && x.postponedUntil > now ? new Date(x.postponedUntil).toISOString() : undefined,
              canBeCleared: closable.has(x.id),
              minutesWorked: { today: Math.round((log[today]?.[x.id] ?? 0) / 60), yesterday: Math.round((log[yesterday]?.[x.id] ?? 0) / 60) },
              claudeSessions: claude.filter((c) => c.deskId === x.id).map((c) => ({ pane: c.paneId, tab: c.tabName, state: c.state, since: c.since ? new Date(c.since).toISOString() : undefined, message: c.message }))
            }))
          }
        }
        case 'desk.current':
          return { ok: true, data: summary(await deskOf(req), todos) }
        case 'desk.open': {
          const desk = await deskOf(req)
          await d.activate(desk.id)
          return { ok: true, data: summary(desk, todos) }
        }
        case 'desk.combine': {
          const desk = await deskOf(req)
          const wanted = Array.isArray(a.others) ? a.others.map(String) : [str(a.other) ?? '']
          const hits = wanted.map((w) => d.desks().find((x) => x.id === w || x.name.toLowerCase() === w.toLowerCase()))
          const missing = wanted.filter((_, i) => !hits[i])
          if (missing.length > 0 || hits.length === 0) throw new Error(`No WorkDesk "${missing[0] ?? ''}" to take in`)
          await d.combine(desk.id, hits.map((h) => h!.id))
          return { ok: true, data: { combined: hits.map((h) => h!.id), into: desk.id } }
        }
        case 'desk.start': {
          const title = str(a.title)
          const ids = Array.isArray(a.todos) ? a.todos.map(String) : []
          if (!title && ids.length === 0) throw new Error('Give the WorkDesk a title (or Todo ids)')
          const made = await d.startPlain(ids, title ?? '')
          return { ok: true, data: { id: made.id } }
        }
        case 'pane.read': {
          const desk = await deskOf(req)
          const target = str(a.target)
          if (!target) throw new Error('Give the Pane id or the name of its Tab (`desk list` shows them under claudeSessions)')
          if (!d.readPane) throw new Error('Reading Panes is not available')
          const n = typeof a.lines === 'number' && a.lines > 0 ? Math.min(a.lines, 2000) : 200
          return { ok: true, data: { desk: desk.id, ...(await d.readPane(desk.id, target, n)) } }
        }
        case 'pane.send': {
          const desk = await deskOf(req)
          const target = str(a.target)
          const text = typeof a.text === 'string' ? a.text : ''
          if (!target) throw new Error('Give the Pane id or the name of its Tab')
          if (text === '' && a.enter === false) throw new Error('Nothing to send')
          if (!d.sendToPane) throw new Error('Sending to Panes is not available')
          return { ok: true, data: { desk: desk.id, sent: text, ...(await d.sendToPane(desk.id, target, text, a.enter !== false)) } }
        }
        case 'desk.claude': {
          const desk = await deskOf(req)
          const prompt = str(a.prompt)
          if (!prompt) throw new Error('Give Claude a prompt')
          const made = await d.spawnClaude(desk.id, prompt, str(a.name))
          return { ok: true, data: { desk: desk.id, ...made } }
        }
        case 'desk.park': {
          const desk = await deskOf(req)
          await d.park(desk.id)
          return { ok: true, data: { parked: desk.id } }
        }
        case 'desk.clear': {
          const desk = await deskOf(req)
          const issues = await d.clearIssues(desk.id)
          // clearing removes the folders: it only happens with --yes, after the issues were shown
          if (a.confirm !== true) return { ok: true, data: { cleared: false, needsConfirm: true, issues } }
          await d.clear(desk.id)
          return { ok: true, data: { cleared: true, id: desk.id } }
        }
        case 'branch.add': {
          const desk = await deskOf(req)
          const project = str(a.project)
          const branch = str(a.branch)
          if (!project || !branch) throw new Error('Give a project and a branch name')
          await d.addBranch(desk.id, project, branch, str(a.base))
          return { ok: true, data: { added: `${project}/${branch}`, desk: desk.id } }
        }
        case 'branch.remove': {
          const desk = await deskOf(req)
          const project = str(a.project)
          const branch = str(a.branch)
          if (!project || !branch) throw new Error('Give a project and a branch name')
          await d.removeBranch(desk.id, project, branch)
          return { ok: true, data: { removed: `${project}/${branch}`, desk: desk.id } }
        }
        case 'todo.list':
          return { ok: true, data: summary(await deskOf(req), todos).todos }
        case 'todo.add': {
          const desk = await deskOf(req)
          const title = str(a.title)
          if (!title) throw new Error('A Todo needs a title')
          await d.newTodo(desk.id, title)
          return { ok: true, data: { added: title, desk: desk.id } }
        }
        case 'todo.resolve': {
          const desk = await deskOf(req)
          const id = str(a.id)
          if (!id || !desk.todoIds.includes(id)) throw new Error('That Todo is not in this WorkDesk')
          await d.resolveTodo(id, a.resolved !== false)
          return { ok: true, data: { id, resolved: a.resolved !== false } }
        }
        case 'review.state': {
          const desk = await deskOf(req)
          const root = await rootOf(desk, req)
          const state = await d.reviewState(desk.id, root)
          const want = str(a.preset)
          if (!want) return { ok: true, data: { root, ...state } }
          // only the changed files of a Review preset
          const preset = (d.presets(desk.id) as ReviewPreset[]).find((p) => p.id === want || p.name.toLowerCase() === want.toLowerCase())
          if (!preset) throw new Error(`No preset "${want}"; see review preset list`)
          return { ok: true, data: { root, ...state, preset: preset.name, entries: filterByPreset(state.entries as { path: string }[], preset) } }
        }
        case 'review.comment': {
          const desk = await deskOf(req)
          const root = await rootOf(desk, req)
          const file = str(a.file)
          const text = str(a.text)
          if (!file || !text) throw new Error('Give a file, a line and a text')
          return { ok: true, data: await d.addComment(desk.id, root, file, Number(a.line), text) }
        }
        case 'review.note': {
          const desk = await deskOf(req)
          const root = await rootOf(desk, req)
          const text = str(a.text)
          if (!text) throw new Error('Give the comment a text')
          return { ok: true, data: await d.addNote(desk.id, root, text) }
        }
        case 'review.preset': {
          const desk = await deskOf(req)
          const action = str(a.action) ?? 'list'
          if (action === 'list') return { ok: true, data: d.presets(desk.id) }
          if (action === 'add') return { ok: true, data: d.savePreset(desk.id, { name: a.name, description: a.description, include: a.include, exclude: a.exclude, files: a.files }) }
          if (action === 'remove') {
            const id = str(a.name)
            if (!id) throw new Error('Give the name of the preset')
            const hit = d.presets(desk.id).find((p) => { const x = p as { id: string; name: string }; return x.id === id || x.name.toLowerCase() === id.toLowerCase() }) as { id: string } | undefined
            if (!hit) throw new Error(`No preset "${id}"`)
            d.removePreset(desk.id, hit.id)
            return { ok: true, data: { removed: hit.id } }
          }
          throw new Error('Use: review preset list | add <name> … | remove <name>')
        }
        default:
          return { ok: false, error: `Unknown command ${req.control}` }
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

export function parseControlRequest(raw: unknown): ControlRequest | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.control !== 'string' || !r.control) return undefined
  return {
    control: r.control,
    cwd: typeof r.cwd === 'string' ? r.cwd : undefined,
    args: typeof r.args === 'object' && r.args !== null ? (r.args as Record<string, unknown>) : {}
  }
}

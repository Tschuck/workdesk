import { initialStage } from './stage'
import type { Todo, TodoList, WorkDesk } from './types'

export interface NewTodo {
  title: string
  topics?: string[]
  list?: TodoList
}

export function normalizeTopics(topics: readonly string[]): string[] {
  return [...new Set(topics.map((t) => t.trim().toLowerCase()).filter(Boolean))]
}

export function createTodo(id: string, input: NewTodo, now: number): Todo {
  const title = input.title.trim()
  if (!title) throw new Error('A Todo needs a title')
  return { id, title, topics: normalizeTopics(input.topics ?? []), list: input.list ?? 'backlog', resolved: false, createdAt: now }
}

function update(todos: readonly Todo[], id: string, fn: (t: Todo) => Todo): Todo[] {
  if (!todos.some((t) => t.id === id)) throw new Error(`Unknown Todo ${id}`)
  return todos.map((t) => (t.id === id ? fn(t) : t))
}

/** Local calendar date (YYYY-MM-DD) of an epoch-ms timestamp, optionally some days later. */
export function localDateString(ms: number, offsetDays = 0): string {
  const d = new Date(ms)
  d.setDate(d.getDate() + offsetDays)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function editTodo(todos: readonly Todo[], id: string, patch: { title?: string; topics?: string[] }): Todo[] {
  return update(todos, id, (t) => {
    const title = patch.title === undefined ? t.title : patch.title.trim()
    if (!title) throw new Error('A Todo needs a title')
    return { ...t, title, topics: patch.topics === undefined ? t.topics : normalizeTopics(patch.topics) }
  })
}

/** Resolving a Todo never touches its WorkDesk or Branches. */
export const setResolved = (todos: readonly Todo[], id: string, resolved: boolean, now = Date.now()): Todo[] =>
  update(todos, id, (t) => ({ ...t, resolved, resolvedAt: resolved ? now : undefined }))

/** Midnight (local time) of the day `ms` is on. */
export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Resolved on an earlier day: Today and the Backlog do not show it any more. A Todo without a date counts as old. */
export const resolvedEarlier = (t: Pick<Todo, 'resolved' | 'resolvedAt'>, now: number): boolean => t.resolved && (t.resolvedAt ?? 0) < startOfDay(now)

/**
 * Resolved Todos to put into the archive: those resolved earlier, or all of them. A Todo in a WorkDesk stays
 * with it, as the record of what was done there.
 */
export const archivable = (todos: readonly Todo[], now: number, all = false): Todo[] =>
  todos.filter((t) => !t.deskId && t.resolved && (all || resolvedEarlier(t, now)))

export function deleteTodo(todos: readonly Todo[], id: string): Todo[] {
  const todo = todos.find((t) => t.id === id)
  if (!todo) throw new Error(`Unknown Todo ${id}`)
  if (todo.deskId) throw new Error('Move the Todo out of its WorkDesk before deleting it')
  return todos.filter((t) => t.id !== id)
}

/** Topics are filter tags only: a Todo matches when it has all the selected ones. */
export function filterByTopics(todos: readonly Todo[], topics: readonly string[]): Todo[] {
  return todos.filter((t) => topics.every((topic) => t.topics.includes(topic)))
}

export function allTopics(todos: readonly Todo[]): string[] {
  return [...new Set(todos.flatMap((t) => t.topics))].sort()
}

export function uniqueDeskId(name: string, takenIds: readonly string[], slug: (s: string) => string): string {
  const base = slug(name) || 'workdesk'
  let id = base
  for (let n = 2; takenIds.includes(id); n++) id = `${base}-${n}`
  return id
}

export interface StartedDesk {
  todos: Todo[]
  desk: WorkDesk
}

/** Start a Plain WorkDesk from selected Todos; each Todo is in at most one WorkDesk. */
export function startPlainDesk(
  todos: readonly Todo[],
  desks: readonly WorkDesk[],
  todoIds: readonly string[],
  deskId: string,
  name: string,
  now: number
): StartedDesk {
  for (const id of todoIds) {
    const todo = todos.find((t) => t.id === id)
    if (!todo) throw new Error(`Unknown Todo ${id}`)
    if (todo.deskId) throw new Error(`"${todo.title}" is already in a WorkDesk`)
  }
  const desk: WorkDesk = {
    id: deskId,
    name,
    stage: initialStage(),
    stageOverridden: false,
    priority: desks.length === 0 ? 0 : Math.max(...desks.map((d) => d.priority)) + 1,
    presence: 'inactive',
    todoIds: [...todoIds],
    branches: [],
    signals: [],
    createdAt: now
  }
  return {
    desk,
    todos: todos.map((t) => (todoIds.includes(t.id) ? { ...t, deskId } : t))
  }
}

/** Topics set automatically by actions: a Pull Request review, a ticket. */
export const REVIEW_TOPIC = 'review'
export const TICKET_TOPIC = 'ticket'

/** Add a Topic unless the Todo has it already. */
export function addTopic(todos: readonly Todo[], id: string, topic: string): Todo[] {
  return update(todos, id, (t) => (t.topics.includes(topic) ? t : { ...t, topics: [...t.topics, topic] }))
}

/** A small label next to a Todo's title. */
export interface Pill {
  label: string
  type: 'kind' | 'project' | 'topic'
  /** `review` or `ticket`, for colouring */
  kind?: 'review' | 'ticket'
  hint?: string
}

/**
 * Kind and project of a Todo come from where it came from (a Pull Request, a ticket), so its title can be
 * just the name. The topics that only repeat the kind are left out.
 */
export function todoPills(t: Pick<Todo, 'topics' | 'source'>): Pill[] {
  const pills: Pill[] = []
  const src = t.source
  if (src?.sourceId === 'github-prs') {
    const m = /^(.+)\/([^/#]+)#(\d+)$/.exec(src.externalId)
    pills.push({ label: m ? `review #${m[3]}` : 'review', type: 'kind', kind: 'review', hint: 'A Pull Request to review' })
    if (m) pills.push({ label: m[2], type: 'project', hint: `${m[1]}/${m[2]}` })
  } else if (src?.sourceId === 'notion-tickets' || src?.ticketKey) {
    pills.push({ label: src.ticketKey ? `ticket ${src.ticketKey}` : 'ticket', type: 'kind', kind: 'ticket', hint: 'A ticket' })
  }
  const represented = new Set(pills.flatMap((p) => (p.kind ? [p.kind] : [])))
  for (const topic of t.topics) if (!represented.has(topic as 'review' | 'ticket')) pills.push({ label: topic, type: 'topic' })
  return pills
}

/** Todos made from Pull Requests and tickets used to start with `repo #n` or the ticket key; the pills show those now. */
export function migrateTodoTitles(todos: readonly Todo[]): Todo[] {
  return todos.map((t) => {
    const src = t.source
    if (!src) return t
    let prefix: RegExp | undefined
    if (src.sourceId === 'github-prs') {
      const m = /^(.+)\/([^/#]+)#(\d+)$/.exec(src.externalId)
      if (m) prefix = new RegExp(`^(?:${escapeRe(m[1])}/)?${escapeRe(m[2])}\\s*#${m[3]}\\s+`)
    } else if (src.ticketKey) prefix = new RegExp(`^${escapeRe(src.ticketKey)}\\s+`)
    const title = prefix ? t.title.replace(prefix, '') : t.title
    return title && title !== t.title ? { ...t, title } : t
  })
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Earlier versions used the plural names (as before); keep one spelling. */
export function migrateTopics(todos: readonly Todo[]): Todo[] {
  const rename: Record<string, string> = { reviews: REVIEW_TOPIC, tickets: TICKET_TOPIC }
  return todos.map((t) =>
    t.source && t.topics.some((x) => x in rename) ? { ...t, topics: [...new Set(t.topics.map((x) => rename[x] ?? x))] } : t
  )
}

/** Put a Todo right before or after another one; the order of the array is the order everywhere. */
export function placeTodo(todos: readonly Todo[], id: string, refId: string, after: boolean): Todo[] {
  const moved = todos.find((t) => t.id === id)
  if (!moved || !todos.some((t) => t.id === refId)) throw new Error('Unknown Todo')
  if (id === refId) return [...todos]
  const rest = todos.filter((t) => t.id !== id)
  const at = rest.findIndex((t) => t.id === refId) + (after ? 1 : 0)
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

export interface TodosAndDesks {
  todos: Todo[]
  desks: WorkDesk[]
}

/**
 * Put a Todo into an open WorkDesk. A Todo is in at most one WorkDesk; it moves to Today, because
 * it is being worked on now. A Review WorkDesk covers exactly one Pull Request, so no second one.
 */
export function attachTodo(todos: readonly Todo[], desks: readonly WorkDesk[], todoId: string, deskId: string): TodosAndDesks {
  const todo = todos.find((t) => t.id === todoId)
  const desk = desks.find((d) => d.id === deskId)
  if (!todo) throw new Error(`Unknown Todo ${todoId}`)
  if (!desk) throw new Error(`Unknown WorkDesk ${deskId}`)
  if (todo.deskId) throw new Error(`"${todo.title}" is already in a WorkDesk`)
  return {
    todos: todos.map((t) => (t.id === todoId ? { ...t, deskId, list: 'today', postponedUntil: undefined } : t)),
    desks: desks.map((d) => (d.id === deskId ? { ...d, todoIds: [...d.todoIds, todoId] } : d))
  }
}

/** Take a Todo out of its WorkDesk again; it stays in Today and the WorkDesk stays open, also when it was the last one. */
export function detachTodo(todos: readonly Todo[], desks: readonly WorkDesk[], todoId: string): TodosAndDesks {
  const todo = todos.find((t) => t.id === todoId)
  if (!todo) throw new Error(`Unknown Todo ${todoId}`)
  if (!todo.deskId) throw new Error(`"${todo.title}" is in no WorkDesk`)
  return {
    todos: todos.map((t) => (t.id === todoId ? { ...t, deskId: undefined } : t)),
    desks: desks.map((d) => (d.id === todo.deskId ? { ...d, todoIds: d.todoIds.filter((id) => id !== todoId) } : d))
  }
}

export const NO_TOPIC = 'No topic'

/** Todos grouped by Topic (sorted, "No topic" last); a Todo with several Topics is in each group. */
export function groupByTopic<T extends { topics: string[] }>(todos: readonly T[]): { topic: string; items: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const t of todos) for (const topic of t.topics.length > 0 ? t.topics : [NO_TOPIC]) groups.set(topic, [...(groups.get(topic) ?? []), t])
  return [...groups.entries()]
    .sort(([a], [b]) => (a === NO_TOPIC ? 1 : b === NO_TOPIC ? -1 : a.localeCompare(b)))
    .map(([topic, items]) => ({ topic, items }))
}

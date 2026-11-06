/** Which Notion properties the sprint board uses; the defaults match the usual task board. */
export interface NotionConfig {
  /** the tasks database */
  databaseId: string
  /** relation to the Sprints database; leave empty to skip the sprint filter */
  sprintProperty: string
  /** people property */
  assigneeProperty: string
  statusProperty: string
  tagsProperty: string
  /** relation to the Epics database; leave empty to skip the epics */
  epicProperty: string
  /** sprint status that marks the active sprint */
  currentSprintStatus: string
  /** tickets in these statuses are not offered */
  closedStatuses: string[]
  /** statuses of tickets that are not in the sprint yet; each is a tab on the Notion page */
  pipelineStatuses: string[]
}

export const DEFAULT_NOTION_CONFIG: NotionConfig = {
  databaseId: '',
  sprintProperty: 'Sprint',
  assigneeProperty: 'Assignee',
  statusProperty: 'Status',
  tagsProperty: 'Tags',
  epicProperty: 'Epic',
  currentSprintStatus: 'Current',
  closedStatuses: ['Done', 'Cancelled'],
  pipelineStatuses: ['Ready for refinement', 'Refined', 'Backlog']
}

export interface NotionTicket {
  /** Notion page id */
  id: string
  title: string
  /** ticket key such as ACME-1226 */
  ticketKey?: string
  status?: string
  url: string
  tags: string[]
  /** page ids of the epics it belongs to */
  epicIds: string[]
  /** titles of those epics, once looked up */
  epics: string[]
  /** the connected user is among the assignees */
  mine: boolean
  /** nobody is assigned */
  unassigned: boolean
  /** names of the assignees, for tickets that are somebody else's */
  assignees: string[]
  /** the status is one of the closed ones */
  closed: boolean
}

/** Needs an action from the user: open, and theirs or nobody's. */
export const isActionable = (t: Pick<NotionTicket, 'mine' | 'unassigned' | 'closed'>): boolean => !t.closed && (t.mine || t.unassigned)

type Obj = Record<string, any>

const plain = (rich: Obj[] | undefined): string => (rich ?? []).map((r) => r.plain_text ?? '').join('')

/** Database id behind the tasks database's Sprint relation. */
export function sprintDatabaseId(schema: Obj, sprintProperty: string): string | undefined {
  const p = schema?.properties?.[sprintProperty]
  return p?.type === 'relation' ? p.relation?.database_id : undefined
}

/** The Sprints property that says whether a sprint is current: a status or select with an option of that name. */
export function currentProperty(sprintSchema: Obj, current: string): { name: string; type: 'status' | 'select' } | undefined {
  const props: Obj = sprintSchema?.properties ?? {}
  for (const name of Object.keys(props).sort()) {
    const p = props[name]
    if ((p.type === 'status' || p.type === 'select') && (p[p.type]?.options ?? []).some((o: Obj) => o.name === current)) {
      return { name, type: p.type }
    }
  }
  return undefined
}

export const currentSprintsQuery = (prop: { name: string; type: string }, current: string): Obj => ({
  filter: { property: prop.name, [prop.type]: { equals: current } },
  page_size: 20
})

export const pageIds = (result: Obj): string[] => (result?.results ?? []).map((p: Obj) => p.id).filter((id: unknown) => typeof id === 'string')

/**
 * Tickets of the active sprints. With a sprint filter that is all of them (the page grays out what
 * needs no action); without one the query is narrowed to the user's or unassigned, open tickets,
 * because a whole database can be large.
 */
export function ticketsQuery(config: NotionConfig, sprintIds: string[] | undefined, userId: string): Obj {
  const all: Obj[] = []
  if (sprintIds) {
    const inSprint = sprintIds.map((id) => ({ property: config.sprintProperty, relation: { contains: id } }))
    all.push(inSprint.length === 1 ? inSprint[0] : { or: inSprint })
    return { filter: all[0], page_size: 100 }
  }
  all.push({
    or: [
      { property: config.assigneeProperty, people: { contains: userId } },
      { property: config.assigneeProperty, people: { is_empty: true } }
    ]
  })
  for (const s of config.closedStatuses) all.push({ property: config.statusProperty, status: { does_not_equal: s } })
  return { filter: { and: all }, page_size: 100 }
}

/** The tab that is not one status: everything that waits without being refined and sits in no sprint. */
export const isBacklogTab = (status: string): boolean => status.trim().toLowerCase() === 'backlog'

/**
 * All tickets in one status, whatever the sprint. The Backlog tab is different: it has no status of its own, it is every
 * ticket that is in no sprint and not in a status that has a tab (Ready for refinement, Refined) or is closed
 * (Done, Cancelled), so what is left is "Not started", "Proposed cancellation" and the like.
 */
export function statusQuery(config: NotionConfig, status: string): Obj {
  if (!isBacklogTab(status)) return { filter: { property: config.statusProperty, status: { equals: status } }, page_size: 100 }
  const and: Obj[] = []
  if (config.sprintProperty) and.push({ property: config.sprintProperty, relation: { is_empty: true } })
  for (const s of [...config.pipelineStatuses.filter((p) => !isBacklogTab(p)), ...config.closedStatuses]) {
    and.push({ property: config.statusProperty, status: { does_not_equal: s } })
  }
  return and.length === 0 ? { page_size: 100 } : { filter: and.length === 1 ? and[0] : { and }, page_size: 100 }
}

/** One page of the tasks database; undefined when it has no title. */
export function parseTicket(page: Obj, userId: string, config: NotionConfig): NotionTicket | undefined {
  if (!page?.properties || typeof page.id !== 'string' || typeof page.url !== 'string') return undefined
  let title = ''
  let ticketKey: string | undefined
  let status: string | undefined
  const tags: string[] = []
  const epicIds: string[] = []
  const assignees: string[] = []
  const names: string[] = []
  for (const [name, p] of Object.entries<Obj>(page.properties)) {
    if (p.type === 'title') title = plain(p.title)
    else if (p.type === 'unique_id' && p.unique_id?.number !== undefined) {
      ticketKey = `${p.unique_id.prefix ? p.unique_id.prefix + '-' : ''}${Math.floor(p.unique_id.number)}`
    } else if (name === config.statusProperty && p.type === 'status') status = p.status?.name
    else if (name === config.tagsProperty && p.type === 'multi_select') tags.push(...(p.multi_select ?? []).map((o: Obj) => o.name))
    else if (config.epicProperty && name === config.epicProperty && p.type === 'relation') epicIds.push(...(p.relation ?? []).map((r: Obj) => r.id))
    else if (name === config.assigneeProperty && p.type === 'people') {
      assignees.push(...(p.people ?? []).map((u: Obj) => u.id))
      names.push(...(p.people ?? []).map((u: Obj) => u.name ?? 'someone'))
    }
  }
  if (!title) return undefined
  return {
    id: page.id, title, ticketKey, status, url: page.url, tags: tags.sort(), epicIds, epics: [],
    mine: assignees.includes(userId), unassigned: assignees.length === 0, assignees: names,
    closed: !!status && config.closedStatuses.includes(status)
  }
}

export const parseTickets = (result: Obj, userId: string, config: NotionConfig): NotionTicket[] =>
  (result?.results ?? []).flatMap((p: Obj) => parseTicket(p, userId, config) ?? [])

/** PATCH body that makes the user the only assignee. */
export const claimBody = (config: NotionConfig, userId: string): Obj => ({ properties: { [config.assigneeProperty]: { people: [{ id: userId }] } } })

/** Group by status, in the given order (unknown ones after, no status last). */
export function groupByStatus<T extends { status?: string }>(tickets: readonly T[], order: readonly string[] = []): { status: string; items: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const t of tickets) groups.set(t.status ?? NO_STATUS, [...(groups.get(t.status ?? NO_STATUS) ?? []), t])
  const rank = (s: string): number => (s === NO_STATUS ? 2e9 : order.includes(s) ? order.indexOf(s) : 1e9)
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([status, items]) => ({ status, items }))
}

export const NO_STATUS = 'No status'
export const NO_TAG = 'No tag'

/** Group by tag (sorted, "No tag" last); a ticket with several tags is in each group. */
export function groupByTag<T extends { tags: string[] }>(tickets: readonly T[]): { tag: string; items: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const t of tickets) for (const tag of t.tags.length > 0 ? t.tags : [NO_TAG]) groups.set(tag, [...(groups.get(tag) ?? []), t])
  return [...groups.entries()]
    .sort(([a], [b]) => (a === NO_TAG ? 1 : b === NO_TAG ? -1 : a.localeCompare(b)))
    .map(([tag, items]) => ({ tag, items }))
}

export const NO_EPIC = 'No epic'

/** Group by epic (sorted, "No epic" last); a ticket in several epics is in each group. */
export function groupByEpic<T extends { epics: string[] }>(tickets: readonly T[]): { epic: string; items: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const t of tickets) for (const e of t.epics.length > 0 ? t.epics : [NO_EPIC]) groups.set(e, [...(groups.get(e) ?? []), t])
  return [...groups.entries()]
    .sort(([a], [b]) => (a === NO_EPIC ? 1 : b === NO_EPIC ? -1 : a.localeCompare(b)))
    .map(([epic, items]) => ({ epic, items }))
}

/** The title of a page of the Epics database. */
export function pageTitle(page: Obj): string {
  for (const p of Object.values<Obj>(page?.properties ?? {})) if (p.type === 'title') return plain(p.title)
  return ''
}

/** Candidate/Todo title: "ACME-1226 Remove mocked search results". */
export const ticketTitle = (t: Pick<NotionTicket, 'ticketKey' | 'title'>): string => (t.ticketKey ? `${t.ticketKey} ${t.title}` : t.title)

/** What a ticket page says, as plain lines: the text of its first blocks. */
export function blockLines(result: Obj, max = 60): string[] {
  const lines: string[] = []
  for (const b of (result?.results ?? []) as Obj[]) {
    const text = plain(b[b.type]?.rich_text)
    if (!text) continue
    const mark = b.type === 'bulleted_list_item' || b.type === 'numbered_list_item' ? '• ' : b.type === 'to_do' ? (b.to_do?.checked ? '☑ ' : '☐ ') : b.type.startsWith('heading') ? '# ' : ''
    lines.push(mark + text)
    if (lines.length >= max) break
  }
  return lines
}

import type { Candidate } from '../sources/source'
import type { DeskItem, Todo, WorkDesk } from './types'

export type WorkItemKind = 'todo' | 'pr' | 'ticket'

/** Why a Pull request is offered: someone asked for the user's review, or the user's own needs work. */
export type PrRole = 'review' | 'mine'

/** One thing to work on, whatever it came from: a Todo, a Pull Request, a ticket or a branch. */
export interface WorkItem {
  /** `todo:<id>`, `pr:owner/repo#12`, `ticket:<page id>` */
  key: string
  kind: WorkItemKind
  title: string
  subtitle?: string
  url?: string
  ticketKey?: string
  /** why the item wants attention, e.g. "review requested" */
  hint?: string
  /** the WorkDesk that has it already */
  deskId?: string
  /** Pull requests only */
  role?: PrRole
  /** Pull requests: who opened it */
  author?: string
}

export const GITHUB_PRS = 'github-prs'
export const NOTION_TICKETS = 'notion-tickets'

export const itemKey = (kind: WorkItemKind, id: string): string => `${kind}:${id}`

/** Where the notes of a Pull request or ticket are kept (`notes/<id>.md`), a name safe for a file. */
export const itemNotesId = (kind: 'pr' | 'ticket', id: string): string => `${kind}-${id.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}`

export const KIND_LABEL: Record<WorkItemKind, string> = { todo: 'Todo', pr: 'Pull request', ticket: 'Ticket' }

export function todoItem(t: Todo, deskName?: string): WorkItem {
  return {
    key: itemKey('todo', t.id),
    kind: 'todo',
    title: t.title,
    deskId: t.deskId,
    subtitle: deskName ?? (t.topics.length > 0 ? t.topics.join(', ') : undefined)
  }
}

export function prItem(c: Candidate, role: PrRole = 'review', hint?: string): WorkItem {
  return { key: itemKey('pr', c.id), kind: 'pr', title: c.name ?? c.title, subtitle: c.subtitle, url: c.url, role, hint: hint ?? (role === 'review' ? 'review requested' : 'needs work'), ...(c.author ? { author: c.author } : {}) }
}

export function ticketItem(c: Candidate): WorkItem {
  return { key: itemKey('ticket', c.id), kind: 'ticket', title: c.name ?? c.title, subtitle: c.subtitle, url: c.url, ticketKey: c.ticketKey }
}

/** The kind of an old Todo that came from a Pull request or a ticket (they were migrated to items), or nothing for a free-form one. */
export const legacyKind = (t: Pick<Todo, 'source'>): 'pr' | 'ticket' | undefined =>
  t.source?.sourceId === GITHUB_PRS ? 'pr' : t.source?.sourceId === NOTION_TICKETS ? 'ticket' : undefined

/** What a Pull Request or ticket becomes inside a WorkDesk. */
export function deskItemOf(i: WorkItem): DeskItem | undefined {
  if (i.kind !== 'pr' && i.kind !== 'ticket') return undefined
  return { kind: i.kind, id: i.key.slice(i.kind.length + 1), title: i.title, url: i.url, subtitle: i.subtitle, ticketKey: i.ticketKey, ...(i.kind === 'pr' && i.role ? { role: i.role } : {}), ...(i.kind === 'pr' && i.author ? { author: i.author } : {}) }
}

export function itemOfDesk(d: DeskItem): WorkItem {
  return { key: itemKey(d.kind, d.id), kind: d.kind, title: d.title, url: d.url, subtitle: d.subtitle, ticketKey: d.ticketKey, ...(d.role ? { role: d.role } : {}), ...(d.author ? { author: d.author } : {}) }
}

/** Keys of the Pull Requests and tickets that a WorkDesk has already. */
export function claimedKeys(desks: readonly WorkDesk[]): Set<string> {
  return new Set(desks.flatMap((d) => (d.items ?? []).map((i) => itemKey(i.kind, i.id))))
}

const ORDER: Record<WorkItemKind, number> = { todo: 0, pr: 1, ticket: 2 }

/** Items for the start list: Todos first, then Pull requests and tickets; items in a WorkDesk are left out. */
export function startList(items: readonly WorkItem[]): WorkItem[] {
  return items
    .filter((i) => !i.deskId)
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map((x) => x.item)
}

const rank = (i: WorkItem): number => ORDER[i.kind]

/** Case-insensitive match on title, subtitle, ticket key and kind; every word has to match. */
export function searchItems(items: readonly WorkItem[], query: string): WorkItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...items]
  return items.filter((i) => {
    const hay = [i.title, i.subtitle, i.ticketKey, KIND_LABEL[i.kind]].filter(Boolean).join(' ').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/** The name a WorkDesk gets when it is started from these items. */
export function suggestName(items: readonly WorkItem[]): string {
  const first = items[0]
  if (!first) return ''
  const base = first.ticketKey ? `${first.ticketKey} ${first.title}` : first.title
  return items.length > 1 ? `${base} +${items.length - 1}` : base
}

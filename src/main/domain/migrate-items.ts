import { legacyKind, itemNotesId } from './work-items'
import type { DeskItem, Todo, WorkDesk } from './types'

export interface ItemMigration {
  todos: Todo[]
  desks: WorkDesk[]
  /** the Todos that were replaced by work items; kept as a backup so it can be undone */
  removed: Todo[]
  /** notes to move: `notes/<from>.md` to `notes/<to>.md` */
  notes: { from: string; to: string }[]
}

const itemOf = (t: Todo, kind: 'pr' | 'ticket'): DeskItem => ({
  kind,
  id: t.source!.externalId,
  title: t.title,
  url: t.source!.url,
  ticketKey: t.source!.ticketKey,
  subtitle: kind === 'pr' ? t.source!.externalId.replace(/#\d+$/, '') : undefined
})

/**
 * Pull requests and tickets are work items now, not Todos. A Todo that came from one becomes an item of its
 * WorkDesk; one in no WorkDesk is dropped, because the dashboard offers the Pull request or ticket itself while it
 * applies. A resolved one in no WorkDesk is history and stays in the archive. Notes move to the item.
 */
export function migrateToItems(todos: readonly Todo[], desks: readonly WorkDesk[]): ItemMigration {
  const removed: Todo[] = []
  const notes: { from: string; to: string }[] = []
  let next = desks.map((d) => ({ ...d }))
  for (const t of todos) {
    const kind = legacyKind(t)
    if (!kind || !t.source) continue
    const desk = t.deskId ? next.find((d) => d.id === t.deskId) : undefined
    if (!desk && t.resolved) continue
    if (desk) {
      const item = itemOf(t, kind)
      const items = desk.items ?? []
      next = next.map((d) => (d.id === desk.id ? { ...d, items: items.some((i) => i.kind === kind && i.id === item.id) ? items : [...items, item], todoIds: d.todoIds.filter((id) => id !== t.id) } : d))
    }
    removed.push(t)
    notes.push({ from: t.id, to: itemNotesId(kind, t.source.externalId) })
  }
  const gone = new Set(removed.map((t) => t.id))
  return { todos: todos.filter((t) => !gone.has(t.id)), desks: removed.length === 0 ? [...desks] : next, removed, notes }
}

import type { Todo, WorkDesk } from './types'

/** The Todos of a WorkDesk in the order of its checklist (`todoIds`); ids without a Todo are left out. */
export function deskChecklist(desk: Pick<WorkDesk, 'todoIds'>, todos: readonly Todo[]): Todo[] {
  const byId = new Map(todos.map((t) => [t.id, t]))
  return desk.todoIds.flatMap((id) => byId.get(id) ?? [])
}

/** Done and total of a checklist. */
export const progress = (list: readonly Todo[]): { done: number; total: number } => ({ done: list.filter((t) => t.resolved).length, total: list.length })

/** Put a Todo of the checklist right before or after another one. */
export function placeInDesk(desk: WorkDesk, id: string, refId: string, after: boolean): WorkDesk {
  if (!desk.todoIds.includes(id) || !desk.todoIds.includes(refId)) throw new Error('Unknown Todo in this WorkDesk')
  if (id === refId) return desk
  const rest = desk.todoIds.filter((x) => x !== id)
  const at = rest.indexOf(refId) + (after ? 1 : 0)
  return { ...desk, todoIds: [...rest.slice(0, at), id, ...rest.slice(at)] }
}

/** Move one step up (-1) or down (1); at the ends nothing changes. */
export function stepInDesk(desk: WorkDesk, id: string, delta: -1 | 1): WorkDesk {
  const i = desk.todoIds.indexOf(id)
  if (i < 0) throw new Error('Unknown Todo in this WorkDesk')
  const j = i + delta
  if (j < 0 || j >= desk.todoIds.length) return desk
  const ids = [...desk.todoIds]
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  return { ...desk, todoIds: ids }
}

/** Id of the note of a WorkDesk's own scratch note (Todo notes use the Todo's id). */
export const deskNoteId = (deskId: string): string => `desk-${deskId}`

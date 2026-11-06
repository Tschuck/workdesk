import type { PrTodoState } from './prs'
import type { Todo, WorkDesk } from './types'

/**
 * The WorkDesks that can be cleared: they have pull requests, every one of them is merged or closed, and their Todos are resolved.
 * A pull request whose state is not known (yet) keeps a WorkDesk out. Tickets and the pull requests of branches that are not work items
 * are not looked at here (that needs more questions than the sidebar can ask: the Details page of a WorkDesk does that); a planned
 * WorkDesk has nothing to clear.
 */
export function closableDeskIds(desks: readonly WorkDesk[], todos: readonly Todo[], prs: Readonly<Record<string, Pick<PrTodoState, 'state'> | undefined>>): Set<string> {
  const out = new Set<string>()
  for (const d of desks) {
    if (d.presence === 'planned') continue
    const ids = [...new Set([...(d.items ?? []).filter((i) => i.kind === 'pr').map((i) => i.id), ...(d.reviews ?? []).map((r) => `${r.owner}/${r.repo}#${r.number}`)])]
    if (ids.length === 0) continue
    // a pull request that was merged or closed is known from what the review last saw, when the watcher has not read it
    const seenDone = new Map((d.reviews ?? []).map((r) => [`${r.owner}/${r.repo}#${r.number}`, r.snapshot && r.snapshot.state !== 'open']))
    if (!ids.every((id) => (prs[id] ? prs[id]!.state !== 'open' : seenDone.get(id) === true))) continue
    if (todos.some((t) => t.deskId === d.id && !t.resolved)) continue
    out.add(d.id)
  }
  return out
}

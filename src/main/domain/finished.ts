/** What is known about the work of a WorkDesk. `undefined` means not known (yet), which never counts as finished. */
export interface DeskFacts {
  /** its Todos, resolved or not */
  todos: boolean[]
  /** the state of each Pull request item (and of the review's own Pull request) */
  prs: (('open' | 'merged' | 'closed') | undefined)[]
  /** whether each ticket is in a done status */
  tickets: (boolean | undefined)[]
  /** open Pull requests of the WorkDesk's branches; `undefined` while not asked */
  openBranchPrs: number | undefined
}

/** Why a WorkDesk is not finished, or `undefined` when it is: every item is done and its branches have no open Pull request. */
export function unfinishedReason(f: DeskFacts): string | undefined {
  if (f.todos.length + f.prs.length + f.tickets.length === 0) return 'it has no work items'
  if (f.todos.some((resolved) => !resolved)) return 'a Todo is open'
  if (f.prs.some((s) => s === undefined)) return 'a pull request is not known yet'
  if (f.prs.some((s) => s === 'open')) return 'a pull request is open'
  if (f.tickets.some((done) => done !== true)) return 'a ticket is not done'
  if (f.openBranchPrs === undefined) return 'its branches were not checked yet'
  if (f.openBranchPrs > 0) return 'a branch has an open pull request'
  return undefined
}

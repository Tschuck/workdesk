import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { prReadiness, READINESS_LABEL, type PrTodoState, type Readiness, type ReadinessInput } from '../main/domain/prs'
import type { Todo } from '../main/domain/types'
import type { PrTodoStates } from '../main/sources/pr-watch'

const Ctx = createContext<PrTodoStates>({})

/** Live state of the pull requests the WorkDesks are about, kept current by the main process (for a component that sits above the provider). */
export function useLivePrStates(): PrTodoStates {
  const [states, setStates] = useState<PrTodoStates>({})
  useEffect(() => {
    void window.workdesk.prTodoStates().then(setStates)
    return window.workdesk.onPrTodoStates(setStates)
  }, [])
  return states
}

/** Live state of the Pull Requests behind review Todos, kept current by the main process. */
export function PrStatesProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={useLivePrStates()}>{children}</Ctx.Provider>
}

export const usePrStates = (): PrTodoStates => useContext(Ctx)

export function usePrState(todo: Pick<Todo, 'source'>): PrTodoState | undefined {
  const states = useContext(Ctx)
  return todo.source?.sourceId === 'github-prs' ? states[todo.source.externalId] : undefined
}

export const READINESS_CLASS: Record<Readiness, string> = {
  ready: 'ready',
  merged: 'merged',
  closed: 'closed',
  draft: 'draft',
  'ci-running': 'running',
  'ci-failed': 'failed',
  'changes-requested': 'failed',
  conflicts: 'failed',
  behind: 'running',
  'needs-review': 'waiting'
}

/** Where the Pull Request behind a review Todo stands: your verdict, the checks and "ready to merge". */
export function PrChips({ todo }: { todo: Pick<Todo, 'source'> }) {
  return <PrStateChips state={usePrState(todo)} />
}

/** The same chips for a Pull Request by its id (`owner/repo#number`), e.g. the one a review WorkDesk is about. */
export function PrChipsFor({ id, approvals }: { id: string; approvals?: boolean }) {
  return <PrStateChips state={useContext(Ctx)[id]} showApprovals={approvals} />
}

/** Where a Pull Request stands (checks running, ready to merge, …): one chip, whichever screen shows it. */
export function ReadinessChip({ s }: { s: ReadinessInput }) {
  const readiness = prReadiness(s)
  return (
    <span className={'chip small readiness readiness-' + READINESS_CLASS[readiness]} title={`Checks: ${s.ci}; mergeable state: ${s.mergeable}`}>
      {readiness === 'ready' ? '✓ ' : readiness === 'ci-running' ? '… ' : ''}
      {READINESS_LABEL[readiness]}
    </span>
  )
}

function PrStateChips({ state: s, showApprovals }: { state?: PrTodoState; showApprovals?: boolean }) {
  if (!s) return null
  return (
    <>
      {showApprovals && s.state === 'open' && s.approvals > 0 && <span className="chip small rs-approved" title="Reviewers who approved this Pull Request">✓ {s.approvals} approved</span>}
      {s.state === 'open' && s.myReview === 'APPROVED' && <span className="chip small rs-approved" title="You approved this Pull Request">✓ approved</span>}
      {s.state === 'open' && s.myReview === 'CHANGES_REQUESTED' && <span className="chip small rs-changes" title="You requested changes">✗ changes</span>}
      <ReadinessChip s={s} />
    </>
  )
}

import { untilLabel } from './postpone'
import { stageLabel } from './stage'
import type { Signal, Todo, WorkDesk } from './types'

export type DeskEventType = 'started' | 'name' | 'stage' | 'presence' | 'branch' | 'todo' | 'pull-request' | 'signal'

/** One line of a WorkDesk's event log. */
export interface DeskEvent {
  /** epoch ms */
  at: number
  type: DeskEventType
  text: string
}

/** An event with the WorkDesk it happened in, for the activity list. */
export interface RecentEvent extends DeskEvent {
  deskId: string
  deskName: string
}

export type NewEvent = Pick<DeskEvent, 'type' | 'text'>

const SIGNAL_TEXT: Record<Signal['type'], string> = {
  'claude-needs-input': 'Claude needs input',
  'claude-finished': 'Claude finished',
  're-review-requested': 'Re-review requested',
  'new-review-comments': 'New review comments',
  'review-received': 'Review received',
  'ci-finished': 'CI finished',
  'ready-to-merge': 'Ready to merge',
  'marked-unread': 'Marked as unread',
  'tests-finished': 'Tests finished',
  'command-finished': 'A command finished',
  'todo-due': 'Todo due'
}

export function describeSignal(s: Pick<Signal, 'type' | 'message'>): NewEvent {
  return { type: 'signal', text: s.message ? `${SIGNAL_TEXT[s.type]}: ${s.message}` : SIGNAL_TEXT[s.type] }
}

const key = (b: { project: string; branch: string }): string => `${b.project} · ${b.branch}`

/** What changed in a WorkDesk between two states, as log lines. Signals and Todos are logged where they change. */
export function describeDeskChange(prev: WorkDesk, next: WorkDesk): NewEvent[] {
  const out: NewEvent[] = []
  if (prev.name !== next.name) out.push({ type: 'name', text: `Renamed to "${next.name}"` })
  if (prev.stage !== next.stage) {
    out.push({ type: 'stage', text: `Stage: ${stageLabel(prev.stage)} → ${stageLabel(next.stage)}${next.stageOverridden ? ' (set by hand)' : ''}` })
  }
  if (prev.presence !== next.presence) {
    if (next.presence === 'parked') out.push({ type: 'presence', text: 'Parked: terminals and editor shut down' })
    else if (prev.presence === 'parked') out.push({ type: 'presence', text: 'Reactivated' })
    else if (prev.presence === 'planned') out.push({ type: 'presence', text: 'Started' })
  }
  if (prev.postponedUntil !== next.postponedUntil) {
    out.push({ type: 'presence', text: next.postponedUntil ? `Postponed until ${untilLabel(next.postponedUntil)}` : 'Postponement ended' })
  }
  if (!!prev.groupTabsByBranch !== !!next.groupTabsByBranch) out.push({ type: 'presence', text: next.groupTabsByBranch ? 'Tabs grouped by branch' : 'Tabs no longer grouped by branch' })
  const before = new Set(prev.branches.map(key))
  const after = new Set(next.branches.map(key))
  for (const b of next.branches) if (!before.has(key(b))) out.push({ type: 'branch', text: `Branch added: ${key(b)}${b.base ? ` (on top of ${b.base})` : ''}` })
  for (const b of prev.branches) if (!after.has(key(b))) out.push({ type: 'branch', text: `Branch removed: ${key(b)}` })

  // one entry per pull request that is reviewed here; with several, each says which
  const many = (next.reviews?.length ?? 0) > 1
  for (const r of next.reviews ?? []) {
    const old = (prev.reviews ?? []).find((x) => x.owner === r.owner && x.repo === r.repo && x.number === r.number)
    const a = old?.snapshot
    const b = r.snapshot
    if (!a || !b) continue
    const who = many ? ` (#${r.number})` : ''
    if (a.state !== b.state) out.push({ type: 'pull-request', text: `Pull request${who} ${b.state === 'open' ? 'reopened' : b.state}` })
    if (a.ci !== b.ci) out.push({ type: 'pull-request', text: `Checks${who}: ${a.ci} → ${b.ci}` })
    if (!a.reviewRequested && b.reviewRequested) out.push({ type: 'pull-request', text: `Review requested again${who}` })
    if (b.commentCount > a.commentCount) out.push({ type: 'pull-request', text: `${b.commentCount - a.commentCount} new comment(s)${who}` })
    if (a.headSha !== b.headSha) out.push({ type: 'pull-request', text: `New commits pushed${who}` })
  }
  return out
}

/** Todos of one WorkDesk that were added to it, resolved or reopened between two saves. */
export function describeTodoChanges(deskId: string, prev: readonly Todo[], next: readonly Todo[]): NewEvent[] {
  const out: NewEvent[] = []
  for (const t of next) {
    if (t.deskId !== deskId) continue
    const old = prev.find((o) => o.id === t.id)
    if (!old || old.deskId !== deskId) out.push({ type: 'todo', text: `Todo added: ${t.title}` })
    else if (old.resolved !== t.resolved) out.push({ type: 'todo', text: `Todo ${t.resolved ? 'resolved' : 'reopened'}: ${t.title}` })
  }
  return out
}

import type { PageRef } from './page-refs'

export type ReviewStage = 'to-review' | 'reviewed-waiting' | 're-review' | 'done'
export type WorkStage = 'implement' | 'testing' | 'in-review' | 'waiting'
export type Stage = ReviewStage | WorkStage

/** `planned`: chosen for today, not started: nothing runs and nothing is checked out until it is opened */
export type Presence = 'active' | 'inactive' | 'parked' | 'planned'

export type SignalType =
  | 'claude-needs-input'
  | 'claude-finished'
  | 're-review-requested'
  | 'new-review-comments'
  | 'review-received'
  | 'ci-finished'
  | 'ready-to-merge'
  | 'marked-unread'
  | 'tests-finished'
  | 'command-finished'
  | 'todo-due'

export interface Signal {
  id: string
  type: SignalType
  /** epoch ms */
  at: number
  /** Pane the Signal is tied to; Signals without one clear when the WorkDesk is opened */
  paneId?: string
  /** Claude Code session that raised it, so a later event of the same session can clear it */
  sessionId?: string
  /** worktree folder the event came from */
  branchPath?: string
  message?: string
  read: boolean
}

export interface BranchWorktree {
  project: string
  branch: string
  /** absolute path of the worktree folder */
  path: string
  /** 1 for the first Branch of the Project in this WorkDesk */
  index: number
  /** the Pull Request (`owner/repo#12`) this folder is the checkout of, when it is one */
  pr?: string
  /** Branch this one is based on; builds the Stack */
  base?: string
}

/** Where a Todo came from, so it is not offered as a Candidate again. */
export interface TodoSource {
  sourceId: string
  externalId: string
  url?: string
  /** ticket key such as ENG-123; names the Branch of a Ticket WorkDesk */
  ticketKey?: string
}

export type CiState = 'none' | 'pending' | 'success' | 'failure'

/** The parts of a Pull Request the Review WorkDesk reacts to. */
export interface PrSnapshot {
  state: 'open' | 'closed' | 'merged'
  headSha: string
  /** the user is (again) asked to review */
  reviewRequested: boolean
  /** the user's latest review */
  myReview?: { state: string; commitId: string }
  /** comments by other people */
  commentCount: number
  /** who asked for changes (their latest verdict), and who is asked to review (again) now: a pull request whose changes were answered is asked of them again */
  changesBy?: string[]
  requested?: string[]
  /** the author answered since the user's review: every comment thread the user started is resolved or has a reply, so it is to be reviewed again even when nobody asked */
  answered?: boolean
  ci: CiState
}

export interface ReviewInfo {
  owner: string
  repo: string
  number: number
  url: string
  snapshot?: PrSnapshot
}

/** A Pull Request or ticket worked on in a WorkDesk. Kept as a snapshot, so it shows without asking GitHub or Notion. */
export interface DeskItem {
  kind: 'pr' | 'ticket'
  /** `owner/repo#12` for a Pull Request, the Notion page id for a ticket */
  id: string
  title: string
  url?: string
  subtitle?: string
  ticketKey?: string
  /** Pull Requests: `review` when it is somebody else's and you review it, `mine` when it is yours; none: yours, unless it is in `reviews` */
  role?: 'review' | 'mine'
  /** a pull request of yours: where it stood when it was last looked at, to tell what is new (reviews, comments) */
  seen?: { approvals: number; changesRequested: number; commentCount: number }
}

export interface WorkDesk {
  id: string
  name: string
  stage: Stage
  /** true when the Stage was set by hand and must not be overwritten by derivation */
  stageOverridden: boolean
  /** manual priority, lower comes first */
  priority: number
  presence: Presence
  /** postponed until then (ms since the epoch): listed apart, comes back by itself, and at once on a new Signal */
  postponedUntil?: number
  /** the list of tabs is in runs per branch (a setting of the WorkDesk, off by default) */
  groupTabsByBranch?: boolean
  /** the Claude Account its terminals run `claude` under (id); none: the default Account */
  claudeAccountId?: string
  /** the Profile it belongs to; none = Profile #1 (data from before Profiles) */
  profileId?: string
  /** made by this repeating-WorkDesk schedule; while it is open, the schedule makes no other */
  scheduleId?: string
  todoIds: string[]
  /** Pull Requests and tickets of this WorkDesk (work items); Todos are in `todoIds`, branches in `branches` */
  items?: DeskItem[]
  /** pages attached from the browser (a PR, a ticket, a CI run, any page) */
  refs?: PageRef[]
  branches: BranchWorktree[]
  /** the Pull Requests of this WorkDesk that you review: each with what GitHub last said, from which the Stage is worked out */
  reviews?: ReviewInfo[]
  /** runtime only, never written to the Status Repo */
  signals: Signal[]
  createdAt: number
}

export type TodoList = 'backlog' | 'today'

/** A resolved Todo that was put away: kept in `archive/todos.json`, searchable, can be restored. */
export type ArchivedTodo = Todo & { archivedAt: number }

export interface Todo {
  id: string
  title: string
  /** Topics are only filter tags for picking Todos */
  topics: string[]
  list: TodoList
  /** a Todo is in at most one WorkDesk */
  deskId?: string
  resolved: boolean
  /** when it was resolved (epoch ms); older Todos have none */
  resolvedAt?: number
  /** hidden from Today until a later local date (YYYY-MM-DD) */
  postponedUntil?: string
  /** due time (epoch ms): a reminder raises a Signal then */
  dueAt?: number
  /** snoozed: the reminder comes again at this time (epoch ms) instead of at `dueAt` */
  snoozedUntil?: number
  /** repeats: resolving it starts the next one, due at the next such day (needs `dueAt`) */
  repeat?: 'daily' | 'weekdays' | 'weekly'
  /** when the last reminder was raised (epoch ms); a reminder fires once per due or snooze time */
  remindedAt?: number
  source?: TodoSource
  /** the Profile it belongs to; none = Profile #1 (data from before Profiles) */
  profileId?: string
  /** pages attached from the browser */
  refs?: PageRef[]
  createdAt: number
}

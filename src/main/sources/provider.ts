import type { BranchPrStatus, PrItem, PrTodoState } from '../domain/prs'
import type { Candidate } from './source'

/**
 * One provider interface for every system the tool reads work from. The shapes it returns are the ones the rest of the
 * app already works on (PrItem, BranchPrStatus, PrTodoState, Candidate): a GitLab merge request is a "change request"
 * that looks exactly like a GitHub Pull Request to the readiness rule, the chips and the review polling.
 */

export type ProviderKind = 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'jira'

/** A repository on a host, as the git remote says it. `path` is `owner/name` (GitLab: `group/sub/project`). */
export interface RepoRef {
  host: string
  path: string
}

/** One CI check or pipeline job of a change request. */
export interface CiCheck {
  name: string
  state: 'pending' | 'success' | 'failure' | 'skipped'
  url?: string
}

/** Pull requests / merge requests, their CI and review state. */
export interface ChangeRequestProvider {
  /** the login name of the connected user */
  me(): Promise<string>
  /** open change requests of a repository with the user's review state */
  openChangeRequests(repo: string, me: string): Promise<PrItem[]>
  /** change requests whose source is `branch` (newest first, at most three) */
  branchChangeRequests(repo: string, branch: string): Promise<BranchPrStatus[]>
  /** one change request as the readiness rule sees it */
  changeRequestState(repo: string, number: number, me: string, now: number): Promise<PrTodoState>
  /** the checks / pipeline jobs of a change request */
  ciChecks(repo: string, number: number): Promise<CiCheck[]>
  /** open change requests where the user is asked for a review */
  reviewRequested(): Promise<Candidate[]>
}

export interface Ticket {
  key: string
  title: string
  url: string
  /** the status as the tracker names it, e.g. "In Review" */
  status: string
  /** the tracker's coarse category, so a board can colour it without knowing every workflow */
  category: 'todo' | 'doing' | 'done' | 'unknown'
  assignee?: string
}

export interface TicketTransition {
  id: string
  name: string
  /** the status it leads to */
  to: string
}

/** Tickets / work items and their workflow. */
export interface TicketProvider {
  me(): Promise<string>
  ticket(key: string): Promise<Ticket>
  transitions(key: string): Promise<TicketTransition[]>
  /** move a ticket along; throws when the id is not one of its transitions */
  transition(key: string, transitionId: string): Promise<void>
  /** open tickets assigned to the user */
  assigned(): Promise<Candidate[]>
  /** a ticket key found in text such as a branch name or a title */
  keyIn(text: string): string | undefined
}

/** What a provider can do; a missing part is simply not offered (Jira has no pull requests, GitLab tickets are not used). */
export interface Provider {
  kind: ProviderKind
  name: string
  /** not confirmed against a real account yet; shown in the UI and the README */
  untested: boolean
  changeRequests?: ChangeRequestProvider
  tickets?: TicketProvider
  /** a cheap authenticated call; resolves with the user's name or throws with a readable reason */
  testConnection(): Promise<string>
}

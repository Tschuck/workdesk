/** An item a Source offers that is not a Todo yet. */
export interface Candidate {
  /** stable id within the Source, e.g. `owner/repo#12` */
  id: string
  title: string
  /** the name alone, without a ticket key or repository; what a Todo made from it is called */
  name?: string
  url: string
  /** short context line, e.g. repository and author */
  subtitle?: string
  ticketKey?: string
  /** "chore(deps): …" style updates; hidden by default where Pull Requests are listed */
  dependencyUpdate?: boolean
  draft?: boolean
  /** why it is offered, e.g. "changes requested" */
  hint?: string
  /** Pull requests: the branch they come from */
  branch?: string
}

/** A system the tool reads work items from (GitHub Pull Requests, a Notion database, …). */
export interface Source {
  id: string
  name: string
  fetchCandidates(): Promise<Candidate[]>
}

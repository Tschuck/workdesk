import type { WorkDeskService } from '../../service'
import type { Candidate, Source } from '../source'
import { RemoteCache } from '../../remote-cache'
import type { SourceStore } from '../store'
import {
  blockLines, claimBody, currentProperty, currentSprintsQuery, DEFAULT_NOTION_CONFIG, pageIds, pageTitle, parseTickets, sprintDatabaseId, statusQuery, ticketsQuery, ticketTitle,
  type NotionConfig, type NotionTicket
} from './board'
import type { NotionAuth, NotionAuthStatus, NotionResponse } from './oauth'
import { githubRelations, prPageQueries, ticketKeysIn, uniqueIdProperty, urlProperty } from './pr-link'

export const NOTION_SOURCE_ID = 'notion-tickets'

export interface NotionState {
  status: NotionAuthStatus
  config: NotionConfig
  tickets: NotionTicket[]
  fetchedAt: number | null
  /** tickets by pipeline status (Ready for refinement, Refined, Backlog…), fetched when its tab opens */
  pipeline: Record<string, NotionTicket[]>
}

/** Friendly text for a failed Notion call. */
function apiError(r: NotionResponse): Error {
  if (r.status === 401) return new Error('Notion session expired; connect again')
  if (String(r.data.message ?? '').includes('data sources accessible')) {
    return new Error('The Notion connection cannot see the board: open the board page in Notion, ••• → Connections, and add this connection (or reconnect and tick the board)')
  }
  return new Error(`Notion: ${r.data.message ?? `HTTP ${r.status}`}`)
}

/** The sprint board of a Notion workspace: open tickets of the active sprint for you or nobody. */
export class NotionService {
  private tickets: NotionTicket[] = []
  private fetchedAt: number | null = null
  private pipeline: Record<string, NotionTicket[]> = {}
  /** titles of epics already looked up, by page id */
  private epicTitles = new Map<string, string>()

  constructor(
    private readonly d: { auth: NotionAuth; store: SourceStore; service: WorkDeskService; now?: () => number; remote?: RemoteCache }
  ) {
    this.remote = d.remote ?? new RemoteCache({ ttlMs: 0 })
  }
  private readonly remote: RemoteCache

  config(): Promise<NotionConfig> {
    return this.d.store.config<NotionConfig>(NOTION_SOURCE_ID, DEFAULT_NOTION_CONFIG).then((c) => ({ ...DEFAULT_NOTION_CONFIG, ...c }))
  }

  async setConfig(config: NotionConfig): Promise<NotionConfig> {
    const clean = { ...config, databaseId: config.databaseId.trim().replace(/-/g, ''), closedStatuses: config.closedStatuses.map((s) => s.trim()).filter(Boolean), pipelineStatuses: config.pipelineStatuses.map((s) => s.trim()).filter(Boolean) }
    await this.d.store.setConfig(NOTION_SOURCE_ID, clean)
    this.tickets = []
    this.pipeline = {}
    this.epicTitles.clear()
    this.fetchedAt = null
    return clean
  }

  async state(): Promise<NotionState> {
    return { status: await this.d.auth.status(), config: await this.config(), tickets: this.tickets, fetchedAt: this.fetchedAt, pipeline: this.pipeline }
  }

  /** Query the board. */
  async refresh(): Promise<NotionState> {
    const { auth } = this.d
    const config = await this.config()
    if (!config.databaseId) throw new Error('Set the tasks database id first')
    const userId = await auth.userId()
    if (!userId) throw new Error('Connect Notion again (user unknown)')
    const ok = async (p: Promise<NotionResponse>): Promise<Record<string, any>> => {
      const r = await p
      if (r.status !== 200) throw apiError(r)
      return r.data
    }

    let sprintIds: string[] | undefined
    if (config.sprintProperty) {
      const schema = await ok(auth.request('GET', `/databases/${config.databaseId}`))
      const sprintDb = sprintDatabaseId(schema, config.sprintProperty)
      if (!sprintDb) throw new Error(`No '${config.sprintProperty}' relation visible: share the Sprints database with the Notion connection too (or the whole project page)`)
      const prop = currentProperty(await ok(auth.request('GET', `/databases/${sprintDb}`)), config.currentSprintStatus)
      if (!prop) throw new Error(`No sprint status '${config.currentSprintStatus}' found in the Sprints database`)
      sprintIds = pageIds(await ok(auth.request('POST', `/databases/${sprintDb}/query`, currentSprintsQuery(prop, config.currentSprintStatus))))
    }
    if (sprintIds && sprintIds.length === 0) this.tickets = []
    else {
      // follow the pages of a long sprint, up to 500 tickets
      const body = ticketsQuery(config, sprintIds, userId)
      const results: Record<string, any>[] = []
      let cursor: string | undefined
      for (let round = 0; round < 5; round++) {
        const data = await ok(auth.request('POST', `/databases/${config.databaseId}/query`, cursor ? { ...body, start_cursor: cursor } : body))
        results.push(...data.results)
        if (!data.has_more) break
        cursor = data.next_cursor
      }
      this.tickets = await this.withEpics(parseTickets({ results }, userId, config))
    }
    this.fetchedAt = (this.d.now ?? Date.now)()
    return this.state()
  }

  /** Fill in the titles of the epics of the tickets: one lookup per epic, kept. An epic that cannot be read shows nothing. */
  private async withEpics(tickets: NotionTicket[]): Promise<NotionTicket[]> {
    const unknown = [...new Set(tickets.flatMap((t) => t.epicIds))].filter((id) => !this.epicTitles.has(id))
    await Promise.all(
      unknown.map(async (id) => {
        try {
          const r = await this.d.auth.request('GET', `/pages/${id}`)
          this.epicTitles.set(id, r.status === 200 ? pageTitle(r.data) : '')
        } catch {
          this.epicTitles.set(id, '')
        }
      })
    )
    return tickets.map((t) => ({ ...t, epics: t.epicIds.map((id) => this.epicTitles.get(id) ?? '').filter(Boolean) }))
  }

  /** Tickets in one pipeline status, whoever has them and whatever the sprint. */
  async refreshStatus(status: string): Promise<NotionState> {
    const config = await this.config()
    if (!config.databaseId) throw new Error('Set the tasks database id first')
    if (!config.pipelineStatuses.includes(status)) throw new Error(`'${status}' is not a configured status`)
    const userId = await this.d.auth.userId()
    if (!userId) throw new Error('Connect Notion again (user unknown)')
    const body = statusQuery(config, status)
    const results: Record<string, any>[] = []
    let cursor: string | undefined
    for (let round = 0; round < 5; round++) {
      const r = await this.d.auth.request('POST', `/databases/${config.databaseId}/query`, cursor ? { ...body, start_cursor: cursor } : body)
      if (r.status !== 200) throw apiError(r)
      results.push(...r.data.results)
      if (!r.data.has_more) break
      cursor = r.data.next_cursor
    }
    this.pipeline = { ...this.pipeline, [status]: await this.withEpics(parseTickets({ results }, userId, config)) }
    return this.state()
  }

  /** One ticket as it is now (status, tags, assignees) and the text of its page. */
  ticketDetails(pageId: string, refresh = false): Promise<{ ticket: NotionTicket; lines: string[] }> {
    return this.remote.get(`notion:ticket:${pageId}`, () => this.readTicket(pageId), { refresh })
  }

  private async readTicket(pageId: string): Promise<{ ticket: NotionTicket; lines: string[] }> {
    const config = await this.config()
    const userId = await this.d.auth.userId()
    if (!userId) throw new Error('Connect Notion again (user unknown)')
    const page = await this.d.auth.request('GET', `/pages/${pageId}`)
    if (page.status !== 200) throw apiError(page)
    const ticket = parseTickets({ results: [page.data] }, userId, config)[0]
    if (!ticket) throw new Error('That ticket cannot be read')
    const blocks = await this.d.auth.request('GET', `/blocks/${pageId}/children?page_size=100`)
    return { ticket, lines: blocks.status === 200 ? blockLines(blocks.data) : [] }
  }

  /**
   * The ticket of a pull request. First what Notion itself links: the GitHub relation of the tasks database points to a page of the pull request
   * (found by its address), and the ticket is the one that has that page related. Else the ticket key in the branch and the title (`ACME-1205`),
   * looked up by the auto-number of the tasks database. Nothing found, or Notion not set up: undefined.
   */
  async ticketForPr(pr: { owner: string; repo: string; number: number; url: string; title?: string; branch?: string }): Promise<NotionTicket | undefined> {
    try {
      const config = await this.config()
      if (!config.databaseId || !(await this.d.auth.status()).connected) return undefined
      const userId = (await this.d.auth.userId()) ?? ''
      const get = async (path: string): Promise<Record<string, any> | undefined> => {
        const r = await this.d.auth.request('GET', path)
        return r.status === 200 ? r.data : undefined
      }
      const query = async (db: string, body: unknown): Promise<Record<string, any> | undefined> => {
        const r = await this.d.auth.request('POST', `/databases/${db}/query`, body)
        return r.status === 200 ? r.data : undefined
      }
      const schema = (await get(`/databases/${config.databaseId}`)) ?? {}
      for (const rel of githubRelations(schema)) {
        const urlProp = urlProperty((await get(`/databases/${rel.databaseId}`)) ?? {})
        if (!urlProp) continue
        for (const q of prPageQueries(urlProp, pr.url, pr.owner, pr.repo, pr.number)) {
          const pageId = (await query(rel.databaseId, q))?.results?.[0]?.id
          if (typeof pageId !== 'string') continue
          const ticket = parseTickets((await query(config.databaseId, { filter: { property: rel.name, relation: { contains: pageId } }, page_size: 1 })) ?? {}, userId, config)[0]
          if (ticket) return ticket
        }
      }
      const uid = uniqueIdProperty(schema)
      if (uid) {
        for (const k of ticketKeysIn(pr.branch, pr.title)) {
          if (uid.prefix && uid.prefix.toUpperCase() !== k.prefix) continue
          const ticket = parseTickets((await query(config.databaseId, { filter: { property: uid.name, unique_id: { equals: k.number } }, page_size: 1 })) ?? {}, userId, config)[0]
          if (ticket) return ticket
        }
      }
    } catch {
      // Notion cannot be asked: no ticket is shown
    }
    return undefined
  }

  /** The only write to Notion: make the user the assignee. */
  async claim(pageId: string): Promise<NotionState> {
    const userId = await this.d.auth.userId()
    if (!userId) throw new Error('Connect Notion again (user unknown)')
    const r = await this.d.auth.request('PATCH', `/pages/${pageId}`, claimBody(await this.config(), userId))
    if (r.status !== 200) throw apiError(r)
    const claimed = (t: NotionTicket): NotionTicket => (t.id === pageId ? { ...t, mine: true, unassigned: false, assignees: [] } : t)
    this.tickets = this.tickets.map(claimed)
    this.pipeline = Object.fromEntries(Object.entries(this.pipeline).map(([k, v]) => [k, v.map(claimed)]))
    return this.state()
  }

  asSource(): Source {
    return {
      id: NOTION_SOURCE_ID,
      name: 'Notion tickets',
      fetchCandidates: async (): Promise<Candidate[]> => {
        // called when the cached answer is old or the user refreshes: read the board again
        const { tickets } = await this.refresh()
        // the Dashboard offers your own open tickets; unassigned and other people's ones are on the Notion page
        return tickets.filter((t) => t.mine && !t.closed).map((t) => ({
          id: t.id,
          title: ticketTitle(t),
          name: t.title,
          url: t.url,
          subtitle: [t.status, t.unassigned ? 'unassigned' : undefined, ...t.tags].filter(Boolean).join(' · ') || undefined,
          ticketKey: t.ticketKey
        }))
      }
    }
  }
}

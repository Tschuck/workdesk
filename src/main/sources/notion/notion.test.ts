import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemorySecrets } from '../../secrets'
import { WorkDeskService } from '../../service'
import { FakeGit } from '../../status/fake-git'
import { SourceStore } from '../store'
import {
  blockLines, claimBody, currentProperty, DEFAULT_NOTION_CONFIG, groupByEpic, groupByStatus, groupByTag, isActionable, isBacklogTab, statusQuery, parseTicket, parseTickets, sprintDatabaseId, ticketsQuery, ticketTitle
} from './board'
import { NOTION_CREDS_KEY, NotionAuth, type NotionCreds } from './oauth'
import { NotionService } from './service'

const cfg = { ...DEFAULT_NOTION_CONFIG, databaseId: 'db1' }
const page = (id: string, title: string, n: number, over: Record<string, unknown> = {}) => ({
  id, url: `https://notion.so/${id}`,
  properties: {
    Name: { type: 'title', title: [{ plain_text: title }] },
    ID: { type: 'unique_id', unique_id: { prefix: 'ACME', number: n } },
    Status: { type: 'status', status: { name: 'In progress' } },
    Tags: { type: 'multi_select', multi_select: [{ name: 'web' }, { name: 'api' }] },
    Assignee: { type: 'people', people: [{ id: 'me' }] },
    ...over
  }
})

describe('board logic', () => {
  it('finds the Sprint database and the "Current" property', () => {
    expect(sprintDatabaseId({ properties: { Sprint: { type: 'relation', relation: { database_id: 'sdb' } } } }, 'Sprint')).toBe('sdb')
    expect(sprintDatabaseId({ properties: {} }, 'Sprint')).toBeUndefined()
    const schema = { properties: { Name: { type: 'title' }, State: { type: 'status', status: { options: [{ name: 'Planned' }, { name: 'Current' }] } } } }
    expect(currentProperty(schema, 'Current')).toEqual({ name: 'State', type: 'status' })
    expect(currentProperty(schema, 'Nope')).toBeUndefined()
  })

  it('builds the tickets query: sprint, me or nobody, not closed', () => {
    // with a sprint filter every ticket of the sprint comes back; the page grays out the rest
    expect((ticketsQuery(cfg, ['s1', 's2'], 'me') as any).filter).toEqual({ or: [{ property: 'Sprint', relation: { contains: 's1' } }, { property: 'Sprint', relation: { contains: 's2' } }] })
    expect((ticketsQuery(cfg, ['s1'], 'me') as any).filter).toEqual({ property: 'Sprint', relation: { contains: 's1' } })
    // without one it is narrowed: me or nobody, not closed
    const q = ticketsQuery(cfg, undefined, 'me') as { filter: { and: any[] } }
    expect(q.filter.and[0]).toEqual({ or: [{ property: 'Assignee', people: { contains: 'me' } }, { property: 'Assignee', people: { is_empty: true } }] })
    expect(q.filter.and.slice(1)).toEqual([{ property: 'Status', status: { does_not_equal: 'Done' } }, { property: 'Status', status: { does_not_equal: 'Cancelled' } }])
  })

  it('parses tickets, mine and unassigned, and groups by tag', () => {
    expect(parseTicket(page('p1', 'Fix it', 1226), 'me', cfg)).toEqual({
      id: 'p1', title: 'Fix it', ticketKey: 'ACME-1226', status: 'In progress', url: 'https://notion.so/p1', tags: ['api', 'web'], epicIds: [], epics: [], mine: true, unassigned: false, assignees: ['someone'], closed: false
    })
    const other = parseTicket(page('p4', 'Theirs', 4, { Assignee: { type: 'people', people: [{ id: 'x', name: 'Zoe' }] }, Status: { type: 'status', status: { name: 'Done' } } }), 'me', cfg)!
    expect(other).toMatchObject({ mine: false, unassigned: false, assignees: ['Zoe'], closed: true })
    expect([isActionable(other), isActionable(parseTicket(page('p1', 'A', 1), 'me', cfg)!)]).toEqual([false, true])
    const free = parseTicket(page('p2', 'Free', 2, { Assignee: { type: 'people', people: [] }, Tags: { type: 'multi_select', multi_select: [] } }), 'me', cfg)!
    expect(free).toMatchObject({ mine: false, unassigned: true, tags: [] })
    expect(parseTicket(page('p3', '', 3), 'me', cfg)).toBeUndefined()
    const all = parseTickets({ results: [page('p1', 'A', 1), { id: 'x' }, page('p2', 'B', 2, { Tags: { type: 'multi_select', multi_select: [] } })] }, 'me', cfg)
    expect(groupByTag(all).map((g) => [g.tag, g.items.length])).toEqual([['api', 1], ['web', 1], ['No tag', 1]])
    expect(ticketTitle(all[0])).toBe('ACME-1 A')
    expect(claimBody(cfg, 'me')).toEqual({ properties: { Assignee: { people: [{ id: 'me' }] } } })
  })
})

describe('grouping by status', () => {
  it('follows the given order, then the rest, no status last', () => {
    const t = (status?: string) => ({ status })
    const groups = groupByStatus([t('Backlog'), t(), t('Zeta'), t('Refined'), t('Backlog')], ['Refined', 'Backlog'])
    expect(groups.map((g) => [g.status, g.items.length])).toEqual([['Refined', 1], ['Backlog', 2], ['Zeta', 1], ['No status', 1]])
  })
})

describe('OAuth with the own client', () => {
  const realFetch = globalThis.fetch
  let secrets: MemorySecrets
  let tokenCalls: { auth?: string; body: any }[]
  let consent: URL | undefined
  let callbackExtra: string
  let makeAuth: (over?: Partial<ConstructorParameters<typeof NotionAuth>[1]>) => NotionAuth

  const fake: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body))
    tokenCalls.push({ auth: (init?.headers as Record<string, string>).Authorization, body })
    const ok = body.grant_type === 'authorization_code' || body.refresh_token === 'r1'
    return new Response(
      JSON.stringify(ok ? { access_token: body.grant_type === 'refresh_token' ? 'a2' : 'a1', refresh_token: 'r1', owner: { user: { id: 'u1' } } } : { error: 'invalid_grant' }),
      { status: ok ? 200 : 400 }
    ) as Response
  }

  beforeEach(() => {
    secrets = new MemorySecrets()
    tokenCalls = []
    consent = undefined
    callbackExtra = ''
    makeAuth = (over = {}) =>
      new NotionAuth(secrets, {
        fetch: fake,
        port: 0,
        uuid: () => 'state1',
        openUrl: async (u) => {
          consent = new URL(u)
          const redirect = consent.searchParams.get('redirect_uri')!
          setTimeout(() => void realFetch(`${redirect}?state=state1${callbackExtra || '&code=abc'}`), 20)
        },
        ...over
      })
  })

  it('needs the client first, then connects through the browser', async () => {
    const auth = makeAuth()
    await expect(auth.connect()).rejects.toThrow(/client id and client secret/)
    await expect(auth.saveClient(' ', 'x')).rejects.toThrow()
    await auth.saveClient(' cid ', ' sec ')
    expect(await auth.status()).toMatchObject({ configured: true, connected: false })
    expect((await new NotionAuth(secrets, { openUrl: async () => undefined }).status()).redirectUri).toBe('http://localhost:8765/notion/callback')

    await auth.connect()
    expect(consent!.origin + consent!.pathname).toBe('https://api.notion.com/v1/oauth/authorize')
    expect(Object.fromEntries(consent!.searchParams)).toMatchObject({ client_id: 'cid', response_type: 'code', owner: 'user', state: 'state1' })
    expect(tokenCalls[0].auth).toBe('Basic ' + Buffer.from('cid:sec').toString('base64'))
    expect(tokenCalls[0].body).toMatchObject({ grant_type: 'authorization_code', code: 'abc', redirect_uri: consent!.searchParams.get('redirect_uri') })
    expect(await auth.status()).toMatchObject({ configured: true, connected: true })
    expect(await auth.userId()).toBe('u1')
    expect(JSON.parse((await secrets.get(NOTION_CREDS_KEY))!)).toMatchObject({ accessToken: 'a1', refreshToken: 'r1', clientSecret: 'sec' })
  })

  it('rejects a denied consent and a wrong state, then disconnects but keeps the client', async () => {
    const auth = makeAuth()
    await auth.saveClient('cid', 'sec')
    callbackExtra = '&error=access_denied'
    await expect(auth.connect()).rejects.toThrow(/access_denied/)

    // a callback with a different state is ignored; connect only ends by timeout
    const wrong = makeAuth({
      timeoutMs: 300,
      openUrl: async (u) => void setTimeout(() => void realFetch(`${new URL(u).searchParams.get('redirect_uri')}?state=evil&code=abc`), 20)
    })
    await expect(wrong.connect()).rejects.toThrow(/timed out/)
    expect(tokenCalls).toEqual([])

    callbackExtra = '&code=abc'
    await auth.connect()
    await auth.disconnect()
    expect(await auth.status()).toMatchObject({ configured: true, connected: false })
    await auth.forget()
    expect(await auth.status()).toMatchObject({ configured: false })
  })

  it('refreshes an expired token once and retries', async () => {
    const creds: NotionCreds = { clientId: 'c', clientSecret: 's', accessToken: 'old', refreshToken: 'r1', userId: 'u1' }
    await secrets.set(NOTION_CREDS_KEY, JSON.stringify(creds))
    const seen: string[] = []
    const api: typeof fetch = async (url, init) => {
      if (String(url).endsWith('/oauth/token')) return fake(url, init)
      seen.push((init?.headers as Record<string, string>).Authorization)
      return new Response(JSON.stringify(seen.length === 1 ? { message: 'expired' } : { ok: true }), { status: seen.length === 1 ? 401 : 200 }) as Response
    }
    const auth = makeAuth({ fetch: api })
    const r = await auth.request('GET', '/users/me')
    expect(r).toEqual({ status: 200, data: { ok: true } })
    expect(seen).toEqual(['Bearer old', 'Bearer a2'])
    expect(JSON.parse((await secrets.get(NOTION_CREDS_KEY))!).accessToken).toBe('a2')
  })

  it('reports a failed refresh as an expired session', async () => {
    await secrets.set(NOTION_CREDS_KEY, JSON.stringify({ clientId: 'c', clientSecret: 's', accessToken: 'old', refreshToken: 'bad' }))
    const api: typeof fetch = async (url, init) =>
      String(url).endsWith('/oauth/token') ? fake(url, init) : (new Response('{}', { status: 401 }) as Response)
    await expect(makeAuth({ fetch: api }).request('GET', '/x')).rejects.toThrow(/expired/)
  })
})

describe('NotionService', () => {
  let tmp: string
  let service: WorkDeskService
  let notion: NotionService
  let calls: { method: string; path: string; body?: any }[]
  let sprints: unknown[]
  let status: number

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'workdesk-nt-'))
    service = new WorkDeskService(join(tmp, 'root'), new FakeGit())
    await service.load()
    const secrets = new MemorySecrets()
    await secrets.set(NOTION_CREDS_KEY, JSON.stringify({ clientId: 'c', clientSecret: 's', accessToken: 'a', refreshToken: 'r', userId: 'me' }))
    calls = []
    sprints = [{ id: 'sp1' }]
    status = 200
    const api: typeof fetch = async (url, init) => {
      const path = String(url).replace('https://api.notion.com/v1', '')
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method: String(init?.method), path, body })
      const reply = (data: unknown, st = 200) => new Response(JSON.stringify(data), { status: st }) as Response
      if (status !== 200) return reply({ message: 'boom' }, status)
      if (path === '/databases/db1') return reply({ properties: { Sprint: { type: 'relation', relation: { database_id: 'sdb' } } } })
      if (path === '/databases/sdb') return reply({ properties: { Status: { type: 'status', status: { options: [{ name: 'Current' }] } } } })
      if (path === '/databases/sdb/query') return reply({ results: sprints })
      if (path === '/databases/db1/query') {
        if (body?.start_cursor === 'c2') return reply({ results: [page('p4', 'Done one', 4, { Status: { type: 'status', status: { name: 'Done' } } })], has_more: false })
        return reply({
          results: [
            page('p1', 'Mine', 1),
            page('p2', 'Free', 2, { Assignee: { type: 'people', people: [] } }),
            page('p3', 'Theirs', 3, { Assignee: { type: 'people', people: [{ id: 'x', name: 'Zoe' }] } })
          ],
          has_more: true,
          next_cursor: 'c2'
        })
      }
      if (path === '/pages/p2') return reply({})
      return reply({ message: 'unexpected ' + path }, 404)
    }
    notion = new NotionService({
      auth: new NotionAuth(secrets, { fetch: api, openUrl: async () => undefined }),
      store: new SourceStore(service.status.dir),
      service,
      now: () => 99
    })
    await notion.setConfig({ ...cfg, databaseId: 'db-1' })
  })
  afterEach(async () => {
    service.status.autoCommit.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  it('reads the current sprint, then the tickets for me or nobody', async () => {
    const s = await notion.refresh()
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /databases/db1', 'GET /databases/sdb', 'POST /databases/sdb/query', 'POST /databases/db1/query', 'POST /databases/db1/query'])
    expect(calls[2].body.filter).toEqual({ property: 'Status', status: { equals: 'Current' } })
    expect(calls[3].body.filter).toEqual({ property: 'Sprint', relation: { contains: 'sp1' } })
    expect(calls[4].body.start_cursor).toBe('c2')
    expect(s.tickets.map((t) => [t.ticketKey, t.mine, t.unassigned, t.closed])).toEqual([
      ['ACME-1', true, false, false], ['ACME-2', false, true, false], ['ACME-3', false, false, false], ['ACME-4', true, false, true]
    ])
    expect(s.fetchedAt).toBe(99)
  })

  it('has no tickets without a current sprint, and explains problems', async () => {
    sprints = []
    expect((await notion.refresh()).tickets).toEqual([])
    status = 404
    await expect(notion.refresh()).rejects.toThrow('Notion: boom')
    status = 401
    await expect(notion.refresh()).rejects.toThrow(/expired|connect again/i)
    await notion.setConfig({ ...cfg, databaseId: '' })
    await expect(notion.refresh()).rejects.toThrow(/database id/)
  })

  it('works without a sprint relation when none is configured', async () => {
    await notion.setConfig({ ...cfg, databaseId: 'db1', sprintProperty: '' })
    await notion.refresh()
    expect(calls.map((c) => c.path)).toEqual(['/databases/db1/query', '/databases/db1/query'])
    // without a sprint filter the query itself is narrowed to me or nobody, not closed
    expect(calls[0].body.filter.and).toHaveLength(3)
  })

  it('claims a ticket', async () => {
    await notion.refresh()
    const claimed = await notion.claim('p2')
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/pages/p2', body: { properties: { Assignee: { people: [{ id: 'me' }] } } } })
    expect(claimed.tickets.find((t) => t.id === 'p2')).toMatchObject({ mine: true, unassigned: false })
  })

  it('fetches the tickets of a pipeline status, whoever has them, and keeps them apart from the sprint', async () => {
    const s = await notion.refreshStatus('Refined')
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /databases/db1/query', 'POST /databases/db1/query'])
    expect(calls[0].body.filter).toEqual({ property: 'Status', status: { equals: 'Refined' } })
    expect(s.tickets).toEqual([])
    expect(s.pipeline.Refined.map((t) => t.ticketKey)).toEqual(['ACME-1', 'ACME-2', 'ACME-3', 'ACME-4'])
    await expect(notion.refreshStatus('Nope')).rejects.toThrow(/not a configured status/)

    // such a ticket can be claimed like a sprint one
    expect((await notion.claim('p2')).pipeline.Refined.find((t) => t.id === 'p2')).toMatchObject({ mine: true })
  })

  it('serves the Dashboard as a Source: only your own open tickets', async () => {
    expect((await notion.config()).databaseId).toBe('db1')
    const cands = await notion.asSource().fetchCandidates()
    // not the unassigned one (p2), somebody else's (p3) or the closed one (p4)
    expect(cands.map((c) => [c.id, c.title, c.ticketKey])).toEqual([['p1', 'ACME-1 Mine', 'ACME-1']])
    expect(cands[0].subtitle).toBe('In progress · api · web')
  })
})

describe('ticket page text', () => {
  const block = (type: string, text: string, extra: object = {}) => ({ type, [type]: { rich_text: [{ plain_text: text }], ...extra } })

  it('turns the first blocks into plain lines, with marks for headings and lists, and skips empty ones', () => {
    const lines = blockLines({ results: [block('heading_2', 'Goal'), block('paragraph', ''), block('paragraph', 'Export as CSV'), block('bulleted_list_item', 'columns'), block('to_do', 'tests', { checked: true }), { type: 'divider', divider: {} }] })
    expect(lines).toEqual(['# Goal', 'Export as CSV', '• columns', '☑ tests'])
  })

  it('stops after the limit', () => {
    expect(blockLines({ results: Array.from({ length: 10 }, (_, i) => block('paragraph', `p${i}`)) }, 3)).toEqual(['p0', 'p1', 'p2'])
  })
})

describe('the Backlog tab', () => {
  const config = { ...DEFAULT_NOTION_CONFIG, pipelineStatuses: ['Ready for refinement', 'Refined', 'Backlog'], closedStatuses: ['Done', 'Cancelled'] }

  it('is every ticket in no sprint and in no status that has a tab or is closed', () => {
    expect(isBacklogTab(' backlog ')).toBe(true)
    expect(isBacklogTab('Refined')).toBe(false)
    expect(statusQuery(config, 'Backlog').filter).toEqual({
      and: [
        { property: 'Sprint', relation: { is_empty: true } },
        { property: 'Status', status: { does_not_equal: 'Ready for refinement' } },
        { property: 'Status', status: { does_not_equal: 'Refined' } },
        { property: 'Status', status: { does_not_equal: 'Done' } },
        { property: 'Status', status: { does_not_equal: 'Cancelled' } }
      ]
    })
  })

  it('leaves out the sprint filter when there is no sprint property, and a status tab stays a plain status filter', () => {
    expect(statusQuery({ ...config, sprintProperty: '' }, 'Backlog').filter).toMatchObject({ and: expect.not.arrayContaining([{ property: '', relation: { is_empty: true } }]) })
    expect(statusQuery({ ...config, sprintProperty: '', pipelineStatuses: ['Backlog'], closedStatuses: [] }, 'Backlog')).toEqual({ page_size: 100 })
    expect(statusQuery(config, 'Refined').filter).toEqual({ property: 'Status', status: { equals: 'Refined' } })
  })
})

describe('epics', () => {
  const page = (epics: string[]) => ({
    id: 'p1',
    url: 'https://notion.so/p1',
    properties: { Name: { type: 'title', title: [{ plain_text: 'T' }] }, Epic: { type: 'relation', relation: epics.map((id) => ({ id })) } }
  })

  it('reads the epic relation of a ticket', () => {
    expect(parseTicket(page(['e1', 'e2']), 'u', DEFAULT_NOTION_CONFIG)?.epicIds).toEqual(['e1', 'e2'])
  })

  it('reads no epics when the property is not set', () => {
    expect(parseTicket(page(['e1']), 'u', { ...DEFAULT_NOTION_CONFIG, epicProperty: '' })?.epicIds).toEqual([])
  })

  it('groups by epic, a ticket in several epics in each, "No epic" last', () => {
    const groups = groupByEpic([{ epics: ['B'] }, { epics: [] }, { epics: ['A', 'B'] }])
    expect(groups.map((g) => [g.epic, g.items.length])).toEqual([['A', 1], ['B', 2], ['No epic', 1]])
  })
})

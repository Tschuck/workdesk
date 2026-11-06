import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemorySecrets } from '../../secrets'
import { WorkDeskService } from '../../service'
import { FakeGit } from '../../status/fake-git'
import { SourceStore } from '../store'
import { DEFAULT_NOTION_CONFIG } from './board'
import { NOTION_CREDS_KEY, NotionAuth } from './oauth'
import { NotionService } from './service'

const ticketPage = { id: 't1', url: 'https://notion.so/t1', properties: { Name: { type: 'title', title: [{ plain_text: 'Credential selection' }] }, ID: { type: 'unique_id', unique_id: { prefix: 'ACME', number: 1205 } } } }
const PR = { owner: 'acme', repo: 'acme-api', number: 806, url: 'https://github.com/acme/acme-api/pull/806', title: 'ACME-1205 Credential selection', branch: 'acme-1205-login-selection-overhaul' }

describe('the Notion ticket of a pull request', () => {
  let tmp: string
  let service: WorkDeskService
  let notion: NotionService
  let calls: string[]
  let relation: boolean
  let prPageUrlMatches: 'equals' | 'contains' | 'none'

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'workdesk-nl-'))
    service = new WorkDeskService(join(tmp, 'root'), new FakeGit())
    await service.load()
    const secrets = new MemorySecrets()
    await secrets.set(NOTION_CREDS_KEY, JSON.stringify({ clientId: 'c', clientSecret: 's', accessToken: 'a', refreshToken: 'r', userId: 'me' }))
    calls = []
    relation = true
    prPageUrlMatches = 'equals'
    const api: typeof fetch = async (url, init) => {
      const path = String(url).replace('https://api.notion.com/v1', '')
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push(`${init?.method} ${path} ${body ? JSON.stringify(body.filter) : ''}`.trim())
      const reply = (data: unknown, st = 200) => new Response(JSON.stringify(data), { status: st }) as Response
      if (path === '/databases/db1') {
        return reply({ properties: { Name: { type: 'title' }, ID: { type: 'unique_id', unique_id: { prefix: 'ACME' } }, ...(relation ? { 'GitHub PRs': { type: 'relation', relation: { database_id: 'gh-db' } } } : {}) } })
      }
      if (path === '/databases/ghdb') return reply({ properties: { Name: { type: 'title' }, URL: { type: 'url' } } })
      if (path === '/databases/ghdb/query') {
        const f = body.filter.url
        const hit = (f.equals && prPageUrlMatches === 'equals') || (f.contains && prPageUrlMatches === 'contains')
        return reply({ results: hit ? [{ id: 'pr-page' }] : [] })
      }
      if (path === '/databases/db1/query') {
        if (body.filter.relation) return reply({ results: body.filter.relation.contains === 'pr-page' ? [ticketPage] : [] })
        if (body.filter.unique_id) return reply({ results: body.filter.unique_id.equals === 1205 ? [ticketPage] : [] })
      }
      return reply({ message: 'unexpected ' + path }, 404)
    }
    notion = new NotionService({ auth: new NotionAuth(secrets, { fetch: api, openUrl: async () => undefined }), store: new SourceStore(service.status.dir), service, now: () => 1 })
    await notion.setConfig({ ...DEFAULT_NOTION_CONFIG, databaseId: 'db1' })
  })
  afterEach(async () => {
    service.status.autoCommit.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  it('asks Notion which ticket has the pull request linked: its page by address, then the ticket that has it related', async () => {
    const t = await notion.ticketForPr(PR)
    expect(t).toMatchObject({ id: 't1', ticketKey: 'ACME-1205', url: 'https://notion.so/t1' })
    expect(calls).toEqual([
      'GET /databases/db1',
      'GET /databases/ghdb',
      `POST /databases/ghdb/query ${JSON.stringify({ property: 'URL', url: { equals: PR.url } })}`,
      `POST /databases/db1/query ${JSON.stringify({ property: 'GitHub PRs', relation: { contains: 'pr-page' } })}`
    ])
  })

  it('finds the pull request page by the end of its address when the whole address does not match', async () => {
    prPageUrlMatches = 'contains'
    expect((await notion.ticketForPr(PR))?.ticketKey).toBe('ACME-1205')
  })

  it('falls back to the ticket key of the branch and the title, by the auto-number', async () => {
    prPageUrlMatches = 'none'
    expect((await notion.ticketForPr(PR))?.ticketKey).toBe('ACME-1205')
    expect(calls.at(-1)).toBe(`POST /databases/db1/query ${JSON.stringify({ property: 'ID', unique_id: { equals: 1205 } })}`)
    // no relation property at all: straight to the key
    calls.length = 0
    relation = false
    expect((await notion.ticketForPr(PR))?.ticketKey).toBe('ACME-1205')
    expect(calls).toEqual(['GET /databases/db1', `POST /databases/db1/query ${JSON.stringify({ property: 'ID', unique_id: { equals: 1205 } })}`])
  })

  it('says nothing when there is no ticket, the prefix is another one, or Notion is not connected', async () => {
    prPageUrlMatches = 'none'
    expect(await notion.ticketForPr({ ...PR, title: 'bump undici', branch: 'dependabot/npm/undici-8.12.3' })).toBeUndefined()
    expect(await notion.ticketForPr({ ...PR, title: 'ENG-1205 other team', branch: 'eng-1205-x' })).toBeUndefined()
    const loose = new NotionService({ auth: new NotionAuth(new MemorySecrets(), { fetch: async () => new Response('{}'), openUrl: async () => undefined }), store: new SourceStore(service.status.dir), service })
    expect(await loose.ticketForPr(PR)).toBeUndefined()
  })
})

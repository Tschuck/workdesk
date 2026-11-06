import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemorySecrets } from '../../secrets'
import { SourceStore } from '../store'
import { fixtureFetch, gitlabRoutes, jiraRoutes } from './fixtures'
import { gitlabCi, gitlabMergeable } from './gitlab'
import { cleanBaseUrl, jsonCall } from './http'
import { jiraCategory } from './jira'
import { detectKind, parseRemote, ProviderRegistry } from './registry'

async function registry(fetchLog: { method: string; url: string }[] = [], secrets = new MemorySecrets()) {
  const store = new SourceStore(await mkdtemp(join(tmpdir(), 'providers-')))
  const fetchFn = fixtureFetch({ ...gitlabRoutes, ...jiraRoutes }, fetchLog)
  return { reg: new ProviderRegistry({ store, secrets, fetch: fetchFn }), secrets }
}

describe('parseRemote', () => {
  it.each([
    ['https://github.com/acme/app.git', 'github.com', 'acme/app'],
    ['git@github.com:acme/app.git', 'github.com', 'acme/app'],
    ['ssh://git@gitlab.example.com:2222/acme/tools/app.git', 'gitlab.example.com', 'acme/tools/app'],
    ['git@gitlab.com:group/sub/project', 'gitlab.com', 'group/sub/project'],
    ['https://dev.azure.com/org/proj/_git/repo', 'dev.azure.com', 'org/proj/_git/repo']
  ])('%s', (url, host, path) => {
    expect(parseRemote(url)).toEqual({ host, path })
  })
  it('gives up on text that is no remote', () => {
    expect(parseRemote('not a remote')).toBeUndefined()
  })
})

describe('detectKind', () => {
  it.each([
    ['github.com', 'github'],
    ['gitlab.com', 'gitlab'],
    ['gitlab.example.com', 'gitlab'],
    ['bitbucket.org', 'bitbucket'],
    ['dev.azure.com', 'azure-devops'],
    ['acme.visualstudio.com', 'azure-devops'],
    ['git.example.com', undefined]
  ])('%s', (host, kind) => {
    expect(detectKind(host)).toBe(kind)
  })
})

describe('provider registry', () => {
  it('detects from the remote host', async () => {
    const { reg } = await registry()
    expect(await reg.resolve('git@github.com:acme/app.git')).toMatchObject({ kind: 'github', by: 'detected' })
    expect(await reg.resolve('https://gitlab.com/a/b.git')).toMatchObject({ kind: 'gitlab', by: 'detected' })
    expect(await reg.resolve('https://git.example.com/a/b.git')).toMatchObject({ by: 'none' })
  })

  it('a host setting makes a self-hosted GitLab known', async () => {
    const { reg } = await registry()
    await reg.setHostKind('git.example.com', 'gitlab')
    expect(await reg.resolve('https://git.example.com/a/b.git')).toMatchObject({ kind: 'gitlab', by: 'host' })
  })

  it('the configured GitLab instance is recognised by its host', async () => {
    const { reg } = await registry()
    await reg.save('gitlab', { baseUrl: 'https://code.example.org', token: 't' })
    expect(await reg.resolve('git@code.example.org:a/b.git')).toMatchObject({ kind: 'gitlab' })
  })

  it('a repository setting wins over the host setting and the name, and can be removed', async () => {
    const { reg } = await registry()
    const repo = parseRemote('https://github.com/acme/app.git')!
    await reg.setRepoKind(repo, 'gitlab')
    expect(await reg.resolve('https://github.com/acme/app.git')).toMatchObject({ kind: 'gitlab', by: 'repo' })
    expect(await reg.resolve('https://github.com/acme/other.git')).toMatchObject({ kind: 'github' })
    await reg.setRepoKind(repo, undefined)
    expect(await reg.resolve('https://github.com/acme/app.git')).toMatchObject({ kind: 'github', by: 'detected' })
  })

  it('keeps the token in the secret store and out of the settings it reports', async () => {
    const { reg, secrets } = await registry()
    const status = await reg.save('gitlab', { baseUrl: 'https://gitlab.example.com/', token: ' glpat-secret ' })
    expect(await secrets.get('provider-gitlab-token')).toBe('glpat-secret')
    expect(JSON.stringify(status)).not.toContain('glpat-secret')
    expect(status.find((s) => s.kind === 'gitlab')).toMatchObject({ hasToken: true, baseUrl: 'https://gitlab.example.com', untested: true })
    expect(JSON.stringify(await reg.settings())).not.toContain('glpat-secret')
  })

  it('an empty token keeps the stored one; clear removes it', async () => {
    const { reg, secrets } = await registry()
    await reg.save('gitlab', { token: 'one' })
    await reg.save('gitlab', { baseUrl: 'https://gitlab.example.com', token: '' })
    expect(await secrets.get('provider-gitlab-token')).toBe('one')
    await reg.clear('gitlab')
    expect(await secrets.get('provider-gitlab-token')).toBeUndefined()
  })

  it('Jira needs a site and an email', async () => {
    const { reg } = await registry()
    await expect(reg.save('jira', { token: 't' })).rejects.toThrow(/site URL/)
  })

  it('test connection reports success and failure as text', async () => {
    const { reg } = await registry()
    expect(await reg.test('gitlab')).toEqual({ ok: false, message: 'Not configured: store the credentials first' })
    await reg.save('gitlab', { baseUrl: 'https://gitlab.example.com', token: 't' })
    expect(await reg.test('gitlab')).toEqual({ ok: true, message: 'Connected as tobi' })
    await reg.save('jira', { baseUrl: 'https://acme.atlassian.net', email: 'tobi@example.com', token: 't' })
    expect(await reg.test('jira')).toEqual({ ok: true, message: 'Connected as Tobi' })
    await reg.save('gitlab', { baseUrl: 'https://gitlab.example.com/other' })
    expect((await reg.test('gitlab')).ok).toBe(false)
  })
})

describe('adapter details', () => {
  it('GitLab sends the token as PRIVATE-TOKEN and nothing else', async () => {
    const seen: Record<string, string>[] = []
    const f = (async (_u: unknown, init?: RequestInit) => (seen.push(init!.headers as Record<string, string>), new Response('{"username":"x"}'))) as typeof fetch
    await jsonCall(f, 'GitLab', 'https://gitlab.example.com/api/v4/user', { headers: { 'PRIVATE-TOKEN': 'tok' } })
    expect(seen[0]['PRIVATE-TOKEN']).toBe('tok')
    expect(seen[0].Authorization).toBeUndefined()
  })

  it('an error names the system and the path but not the token or the query', async () => {
    const f = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch
    const err = await jsonCall(f, 'Jira', 'https://a.atlassian.net/rest/api/3/search/jql?jql=secret', { headers: { Authorization: 'Basic abc' } }).catch((e: Error) => e)
    expect((err as Error).message).toMatch(/Jira: 401.*\/rest\/api\/3\/search\/jql/)
    expect((err as Error).message).not.toMatch(/secret|abc/)
  })

  it('base URLs are cleaned and must be http(s)', () => {
    expect(cleanBaseUrl(' https://gitlab.example.com/gitlab/ ')).toBe('https://gitlab.example.com/gitlab')
    expect(() => cleanBaseUrl('ftp://x')).toThrow()
  })

  it('maps GitLab pipeline and merge statuses', () => {
    expect(gitlabCi(undefined)).toBe('none')
    expect(gitlabCi('running')).toBe('pending')
    expect(gitlabCi('manual')).toBe('pending')
    expect(gitlabCi('failed')).toBe('failure')
    expect(gitlabCi('canceled')).toBe('failure')
    expect(gitlabMergeable({ detailed_merge_status: 'conflict' })).toBe('dirty')
    expect(gitlabMergeable({ detailed_merge_status: 'need_rebase' })).toBe('behind')
    expect(gitlabMergeable({ detailed_merge_status: 'not_approved' })).toBe('blocked')
    expect(gitlabMergeable({ detailed_merge_status: 'mergeable', draft: true })).toBe('draft')
    expect(gitlabMergeable({})).toBe('unknown')
  })

  it('maps Jira status categories', () => {
    expect([jiraCategory('new'), jiraCategory('indeterminate'), jiraCategory('done'), jiraCategory('x')]).toEqual(['todo', 'doing', 'done', 'unknown'])
  })
})

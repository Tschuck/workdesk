import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SecretStore } from '../../secrets'
import type { Graphql, Transport } from './api'

const run = promisify(execFile)

export const GITHUB_TOKEN_KEY = 'github-token'

/** Uses the `gh` CLI's own login. */
export const ghTransport: Transport = async (path) => {
  try {
    const { stdout } = await run('gh', ['api', path], { maxBuffer: 20 * 1024 * 1024 })
    return JSON.parse(stdout)
  } catch (err) {
    throw ghFailure(err, path.split('?')[0])
  }
}

/** What went wrong in a `gh` call, in gh's own words, without the command line (which can be a whole query). */
export function ghFailure(err: unknown, what: string): Error {
  const e = err as { stderr?: string; message?: string }
  const said = (e.stderr ?? '').trim().split('\n').filter(Boolean).pop() ?? (e.message ?? 'failed').split('\n')[0]
  return new Error(`GitHub (${what}): ${said.replace(/^gh: /, '')}`)
}

/** The `gh` CLI's GraphQL endpoint. A number goes as `-F` (typed: an Int variable needs it), text as `-f` (always text). */
export const ghGraphql: Graphql = async (query, variables = {}) => {
  const args = ['api', 'graphql', '-f', `query=${query}`, ...Object.entries(variables).flatMap(([k, v]) => [typeof v === 'number' ? '-F' : '-f', `${k}=${v}`])]
  try {
    const { stdout } = await run('gh', args, { maxBuffer: 20 * 1024 * 1024 })
    return unwrap(JSON.parse(stdout))
  } catch (err) {
    throw ghFailure(err, 'graphql')
  }
}

/** A GraphQL answer carries its errors next to the data; a missing `data` is a failure. */
export function unwrap(body: { data?: unknown; errors?: { message: string }[] }): unknown {
  if (!body.data) throw new Error(`GitHub GraphQL: ${body.errors?.map((e) => e.message).join('; ') ?? 'no data'}`)
  return body.data
}

/** Uses a personal access token. */
export const tokenTransport =
  (token: string, fetchFn: typeof fetch = fetch): Transport =>
  async (path) => {
    const res = await fetchFn(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    })
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${path.split('?')[0]}`)
    return res.json()
  }

/** GraphQL with a personal access token. */
export const tokenGraphql =
  (token: string, fetchFn: typeof fetch = fetch): Graphql =>
  async (query, variables = {}) => {
    const res = await fetchFn('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    })
    if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}`)
    return unwrap(await res.json())
  }

export type GithubAuth = { kind: 'token' } | { kind: 'gh' } | { kind: 'none' }

export async function ghAvailable(): Promise<boolean> {
  return run('gh', ['auth', 'status']).then(
    () => true,
    () => false
  )
}

/** A stored token wins; otherwise the `gh` login. */
export async function resolveTransport(
  secrets: SecretStore,
  hasGh: () => Promise<boolean> = ghAvailable
): Promise<{ auth: GithubAuth; transport?: Transport; graphql?: Graphql }> {
  const token = await secrets.get(GITHUB_TOKEN_KEY)
  if (token) return { auth: { kind: 'token' }, transport: tokenTransport(token), graphql: tokenGraphql(token) }
  if (await hasGh()) return { auth: { kind: 'gh' }, transport: ghTransport, graphql: ghGraphql }
  return { auth: { kind: 'none' } }
}

/** Fetch is passed in everywhere, so tests answer from fixtures and never touch the network. */
export type FetchFn = typeof fetch

export interface JsonRequest {
  method?: 'GET' | 'POST'
  headers: Record<string, string>
  body?: unknown
}

/** One JSON call. A failure says which system and which path (without the query, which can hold a search), never the token. */
export async function jsonCall(fetchFn: FetchFn, label: string, url: string, req: JsonRequest): Promise<unknown> {
  let res: Response
  try {
    res = await fetchFn(url, {
      method: req.method ?? 'GET',
      headers: { Accept: 'application/json', ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...req.headers },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined
    })
  } catch (err) {
    throw new Error(`${label}: cannot reach ${new URL(url).host} (${(err as Error).message})`)
  }
  if (res.status === 401 || res.status === 403) throw new Error(`${label}: ${res.status}, the token was refused or lacks a scope (${new URL(url).pathname})`)
  if (!res.ok) throw new Error(`${label}: ${res.status} for ${new URL(url).pathname}`)
  if (res.status === 204) return undefined
  return res.json()
}

/** `https://host/path` without a trailing slash; rejects what is not an http(s) URL. */
export function cleanBaseUrl(input: string): string {
  const url = new URL(input.trim())
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The base URL must start with https://')
  return (url.origin + url.pathname).replace(/\/+$/, '')
}

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import type { SecretStore } from '../../secrets'

export const NOTION_CREDS_KEY = 'notion-oauth'
export const NOTION_PORT = 8765
const NOTION_VERSION = '2022-06-28'
const API = 'https://api.notion.com/v1'

/** Client of the user's own Notion integration, plus the tokens it was granted. */
export interface NotionCreds {
  clientId: string
  clientSecret: string
  accessToken?: string
  refreshToken?: string
  userId?: string
}

export interface NotionAuthStatus {
  /** client id and secret are stored */
  configured: boolean
  connected: boolean
  /** register this redirect URI in the Notion integration */
  redirectUri: string
}

export interface NotionResponse {
  status: number
  data: Record<string, any>
}

export interface NotionAuthOptions {
  fetch?: typeof fetch
  /** 0 picks a free port (tests) */
  port?: number
  openUrl: (url: string) => Promise<void>
  uuid?: () => string
  timeoutMs?: number
}

const page = (title: string, text: string): string =>
  `<html><body style="font-family:sans-serif"><h3>${title}</h3>${text}</body></html>`

/**
 * Notion OAuth with the user's own client: consent in the browser, a local
 * callback server catches the redirect, tokens and client secret live in the Keychain.
 */
export class NotionAuth {
  private server?: Server
  private cancel?: () => void
  private readonly fetchFn: typeof fetch
  private readonly port: number

  constructor(
    private readonly secrets: SecretStore,
    private readonly o: NotionAuthOptions
  ) {
    this.fetchFn = o.fetch ?? fetch
    this.port = o.port ?? NOTION_PORT
  }

  private async creds(): Promise<NotionCreds | undefined> {
    const raw = await this.secrets.get(NOTION_CREDS_KEY)
    return raw ? (JSON.parse(raw) as NotionCreds) : undefined
  }

  private save(c: NotionCreds): Promise<void> {
    return this.secrets.set(NOTION_CREDS_KEY, JSON.stringify(c))
  }

  redirectUri(port = this.port): string {
    return `http://localhost:${port}/notion/callback`
  }

  async status(): Promise<NotionAuthStatus> {
    const c = await this.creds()
    return { configured: !!c?.clientId && !!c.clientSecret, connected: !!c?.accessToken, redirectUri: this.redirectUri() }
  }

  async userId(): Promise<string | undefined> {
    return (await this.creds())?.userId
  }

  /** Store the integration's client; earlier tokens belong to another client and are dropped. */
  async saveClient(clientId: string, clientSecret: string): Promise<void> {
    if (!clientId.trim() || !clientSecret.trim()) throw new Error('Client id and client secret are both needed')
    await this.save({ clientId: clientId.trim(), clientSecret: clientSecret.trim() })
  }

  async disconnect(): Promise<void> {
    const c = await this.creds()
    if (c) await this.save({ clientId: c.clientId, clientSecret: c.clientSecret })
  }

  /** Forget everything, client included. */
  forget(): Promise<void> {
    return this.secrets.delete(NOTION_CREDS_KEY)
  }

  private async tokenRequest(c: NotionCreds, body: Record<string, string>): Promise<Record<string, any>> {
    const res = await this.fetchFn(`${API}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64'),
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION
      },
      body: JSON.stringify(body)
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, any>
    if (!res.ok || typeof data.access_token !== 'string') {
      throw new Error(`Notion: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}`)
    }
    return data
  }

  cancelConnect(): void {
    this.cancel?.()
  }

  /** One-time consent: opens the browser and resolves once the tokens are stored. */
  async connect(): Promise<void> {
    const c = await this.creds()
    if (!c?.clientId || !c.clientSecret) throw new Error('Save the integration\'s client id and client secret first')
    this.cancelConnect()
    const state = (this.o.uuid ?? randomUUID)()

    await new Promise<void>((resolve, reject) => {
      let done = false
      const finish = (err?: Error) => {
        if (done) return
        done = true
        clearTimeout(timer)
        this.cancel = undefined
        // let the browser get its answer before the server goes away
        setTimeout(() => server.close(), 500).unref()
        err ? reject(err) : resolve()
      }
      const timer = setTimeout(() => finish(new Error('Notion connect timed out; try again')), this.o.timeoutMs ?? 5 * 60_000)
      this.cancel = () => finish(new Error('Notion connect cancelled'))

      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const reply = (code: number, html: string) => (res.writeHead(code, { 'Content-Type': 'text/html' }), res.end(html))
        if (url.pathname !== '/notion/callback') return reply(404, page('Not found', 'Not the Notion callback.'))
        if (url.searchParams.get('state') !== state) return reply(400, page('Not the Notion callback', 'The state does not match.'))
        const error = url.searchParams.get('error')
        const code = url.searchParams.get('code')
        if (error || !code) {
          reply(400, page('Notion was not connected', error ?? 'No code received.'))
          return finish(new Error(`Notion connect failed: ${error ?? 'no code'}`))
        }
        this.tokenRequest(c, { grant_type: 'authorization_code', code, redirect_uri: this.redirectUri((server.address() as AddressInfo).port) })
          .then(async (data) => {
            await this.save({ ...c, accessToken: data.access_token, refreshToken: data.refresh_token, userId: data.owner?.user?.id ?? c.userId })
            reply(200, page('Notion connected', 'You can close this tab.'))
            finish()
          })
          .catch((err: Error) => {
            reply(500, page('Notion was not connected', err.message))
            finish(err)
          })
      })
      this.server = server
      server.once('error', (err) => finish(new Error(`Cannot listen on port ${this.port} for the Notion callback: ${err.message}`)))
      server.listen(this.port, 'localhost', () => {
        const redirect = this.redirectUri((server.address() as AddressInfo).port)
        const consent = new URL(`${API}/oauth/authorize`)
        consent.search = new URLSearchParams({ client_id: c.clientId, response_type: 'code', owner: 'user', redirect_uri: redirect, state }).toString()
        this.o.openUrl(consent.toString()).catch((err: Error) => finish(err))
      })
    })
  }

  /** Notion API call as the connected user; an expired token is refreshed once. */
  async request(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, retried = false): Promise<NotionResponse> {
    const c = await this.creds()
    if (!c?.accessToken) throw new Error('Notion is not connected')
    const res = await this.fetchFn(API + path, {
      method,
      headers: { Authorization: `Bearer ${c.accessToken}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (res.status === 401 && !retried && c.refreshToken) {
      const data = await this.tokenRequest(c, { grant_type: 'refresh_token', refresh_token: c.refreshToken }).catch(() => undefined)
      if (!data) throw new Error('Notion session expired; connect again')
      await this.save({ ...c, accessToken: data.access_token, refreshToken: data.refresh_token ?? c.refreshToken })
      return this.request(method, path, body, true)
    }
    return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, any> }
  }
}

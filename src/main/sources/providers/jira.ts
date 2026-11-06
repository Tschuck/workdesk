import type { Provider, Ticket, TicketProvider, TicketTransition } from '../provider'
import type { Candidate } from '../source'
import { cleanBaseUrl, jsonCall, type FetchFn } from './http'

interface Obj { [k: string]: any }

export const JIRA_TOKEN_KEY = 'provider-jira-token'

const KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/
const VALID_KEY = /^[A-Z][A-Z0-9]+-\d+$/

/** Jira's status category (`new`, `indeterminate`, `done`) as the coarse category the app uses. */
export function jiraCategory(key: string | undefined): Ticket['category'] {
  return key === 'new' ? 'todo' : key === 'indeterminate' ? 'doing' : key === 'done' ? 'done' : 'unknown'
}

const FIELDS = 'summary,status,assignee'

/**
 * Jira Cloud REST v3 with the account's email and an API token (Basic auth). Built from the documented API and
 * fixtures; not yet confirmed against a real account.
 */
export function jiraTickets(baseUrl: string, email: string, token: string, fetchFn: FetchFn = fetch): TicketProvider {
  const root = cleanBaseUrl(baseUrl)
  const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64')
  const call = (path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) =>
    jsonCall(fetchFn, 'Jira', `${root}/rest/api/3${path}`, { method, headers: { Authorization: auth }, body }) as Promise<any>
  const keyOf = (key: string): string => {
    if (!VALID_KEY.test(key)) throw new Error(`Not a Jira issue key: ${key}`)
    return key
  }
  const toTicket = (i: Obj): Ticket => ({
    key: i.key,
    title: i.fields?.summary ?? '',
    url: `${root}/browse/${i.key}`,
    status: i.fields?.status?.name ?? '?',
    category: jiraCategory(i.fields?.status?.statusCategory?.key),
    assignee: i.fields?.assignee?.displayName ?? undefined
  })

  return {
    async me() {
      const u = (await call('/myself')) as Obj
      return u.displayName ?? u.emailAddress ?? u.accountId
    },

    async ticket(key) {
      return toTicket(await call(`/issue/${keyOf(key)}?fields=${FIELDS}`))
    },

    async transitions(key): Promise<TicketTransition[]> {
      const res = (await call(`/issue/${keyOf(key)}/transitions`)) as Obj
      return ((res.transitions ?? []) as Obj[]).map((t) => ({ id: String(t.id), name: t.name, to: t.to?.name ?? t.name }))
    },

    async transition(key, transitionId) {
      const allowed = await this.transitions(key)
      if (!allowed.some((t) => t.id === transitionId)) throw new Error(`${key} has no transition ${transitionId} from its current status`)
      await call(`/issue/${keyOf(key)}/transitions`, 'POST', { transition: { id: transitionId } })
    },

    async assigned(): Promise<Candidate[]> {
      const jql = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC'
      const res = (await call(`/search/jql?jql=${encodeURIComponent(jql)}&fields=${FIELDS}&maxResults=50`)) as Obj
      return ((res.issues ?? []) as Obj[]).map((i) => {
        const t = toTicket(i)
        return { id: t.key, title: `${t.key} ${t.title}`, name: t.title, url: t.url, subtitle: t.status, ticketKey: t.key }
      })
    },

    keyIn: (text) => KEY_RE.exec(text)?.[1]
  }
}

export function jiraProvider(baseUrl: string, email: string, token: string, fetchFn: FetchFn = fetch): Provider {
  const tickets = jiraTickets(baseUrl, email, token, fetchFn)
  return { kind: 'jira', name: 'Jira', untested: true, tickets, testConnection: () => tickets.me() }
}

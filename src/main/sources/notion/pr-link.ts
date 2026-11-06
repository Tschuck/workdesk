/** Finding the Notion ticket of a pull request: by what Notion links (its GitHub relation), or by the ticket key in the branch and title. */

type Obj = Record<string, any>

/** `ACME-1205` in some text, the first of each: [{ prefix: 'ACME', number: 1205, key: 'ACME-1205' }] */
export function ticketKeysIn(...texts: (string | undefined)[]): { prefix: string; number: number; key: string }[] {
  const found: { prefix: string; number: number; key: string }[] = []
  for (const text of texts) {
    for (const m of (text ?? '').matchAll(/(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})[-_ ](\d{1,6})(?![A-Za-z0-9])/g)) {
      const prefix = m[1].toUpperCase()
      const number = Number(m[2])
      // a space is only a separator after capitals (`ACME 1205`); `from 5` is not a ticket
      if (m[0][m[1].length] === ' ' && m[1] !== prefix) continue
      const key = `${prefix}-${number}`
      if (!found.some((f) => f.key === key)) found.push({ prefix, number, key })
    }
  }
  return found
}

/** Relation properties of the tasks database that look like the ones the GitHub integration adds ("GitHub PRs", "Pull requests"). */
export function githubRelations(schema: Obj): { name: string; databaseId: string }[] {
  return Object.entries<Obj>(schema?.properties ?? {})
    .filter(([name, p]) => p.type === 'relation' && /git\s?hub|pull\s?request|\bprs?\b/i.test(name))
    .flatMap(([name, p]) => {
      const id = p.relation?.database_id ?? p.relation?.data_source_id
      return typeof id === 'string' ? [{ name, databaseId: id.replace(/-/g, '') }] : []
    })
}

/** The URL property of the database the GitHub integration keeps its pull requests in. */
export function urlProperty(schema: Obj): string | undefined {
  const urls = Object.entries<Obj>(schema?.properties ?? {}).filter(([, p]) => p.type === 'url').map(([name]) => name)
  return urls.find((n) => /^(url|link)$/i.test(n)) ?? urls.find((n) => /url|link|github/i.test(n)) ?? urls[0]
}

/** The auto-number property of the tasks database (`ACME-1205`), with its prefix. */
export function uniqueIdProperty(schema: Obj): { name: string; prefix?: string } | undefined {
  const hit = Object.entries<Obj>(schema?.properties ?? {}).find(([, p]) => p.type === 'unique_id')
  return hit ? { name: hit[0], prefix: hit[1].unique_id?.prefix || undefined } : undefined
}

/** The Notion query for the pull request's page in the GitHub database: by its address, else by the end of it (`owner/repo/pull/12`). */
export const prPageQueries = (urlProp: string, prUrl: string, owner: string, repo: string, number: number): Obj[] => [
  { filter: { property: urlProp, url: { equals: prUrl } }, page_size: 1 },
  { filter: { property: urlProp, url: { contains: `${owner}/${repo}/pull/${number}` } }, page_size: 1 }
]

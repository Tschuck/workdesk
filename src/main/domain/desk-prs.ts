import { isOwnPr } from './order'
import { stageLabel } from './stage'
import type { WorkDesk } from './types'

/** A pull request of a WorkDesk, as the page of all of them lists it. */
export interface DeskPr {
  /** `owner/repo#12` */
  id: string
  title: string
  url: string
  /** `review`: a colleague's that you review; `mine`: yours */
  role: 'review' | 'mine'
  deskId: string
  deskName: string
  /** where the WorkDesk stands, e.g. "Re-review" */
  stage: string
  state?: 'open' | 'closed' | 'merged'
}

const prUrl = (id: string): string | undefined => {
  const m = /^([^/\s]+)\/([^#\s]+)#(\d+)$/.exec(id)
  return m ? `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}` : undefined
}

/** A pull request as typed or printed by `gh pr create`: its GitHub address, or `owner/repo#12`. */
export function parsePrRef(input: string): { id: string; url: string } | undefined {
  const text = input.trim()
  const m = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(text)
  const id = m ? `${m[1]}/${m[2]}#${m[3]}` : /^[^/\s]+\/[^#\s]+#\d+$/.test(text) ? text : undefined
  return id ? { id, url: prUrl(id)! } : undefined
}

/** The pull requests by WorkDesk, in the order of `prsInDesks` (the WorkDesks with ones to review first). */
export function byDesk(prs: readonly DeskPr[]): { deskId: string; deskName: string; stage: string; prs: DeskPr[] }[] {
  const groups = new Map<string, { deskId: string; deskName: string; stage: string; prs: DeskPr[] }>()
  for (const p of prs) {
    const g = groups.get(p.deskId) ?? { deskId: p.deskId, deskName: p.deskName, stage: p.stage, prs: [] }
    g.prs.push(p)
    groups.set(p.deskId, g)
  }
  return [...groups.values()]
}

/** The address the page opens a pull request at: GitHub shows its comment threads as previews (`comments:mode=thread-previews`). */
export function prPageUrl(url: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set('comments:mode', 'thread-previews')
    return u.toString()
  } catch {
    return url
  }
}

/**
 * The pull requests in the WorkDesks: the ones of their work items, and those they review that are no work item (a review WorkDesk
 * from before). One row per pull request and WorkDesk; to review first, then yours, each by WorkDesk.
 */
export function prsInDesks(desks: readonly WorkDesk[]): DeskPr[] {
  const out: DeskPr[] = []
  for (const d of desks) {
    const states = new Map((d.reviews ?? []).map((r) => [`${r.owner}/${r.repo}#${r.number}`, r]))
    const seen = new Set<string>()
    const add = (id: string, title: string, url: string | undefined, role: DeskPr['role']) => {
      const link = url ?? prUrl(id)
      if (seen.has(id) || !link) return
      seen.add(id)
      out.push({ id, title, url: link, role, deskId: d.id, deskName: d.name, stage: stageLabel(d.stage), ...(states.get(id)?.snapshot ? { state: states.get(id)!.snapshot!.state } : {}) })
    }
    for (const i of d.items ?? []) if (i.kind === 'pr') add(i.id, i.title, i.url, isOwnPr(d, i) ? 'mine' : 'review')
    for (const [id, r] of states) add(id, id, r.url, 'review')
  }
  const rank = (p: DeskPr) => (p.role === 'review' ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b) || a.deskName.localeCompare(b.deskName) || a.id.localeCompare(b.id))
}

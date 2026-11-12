import { isOwnPr } from './order'
import { stageLabel } from './stage'
import type { Stage, WorkDesk } from './types'

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
  stageKey: Stage
  /** when the WorkDesk was started (ms since the epoch) */
  createdAt: number
  /** who opened it, when known */
  author?: string
  state?: 'open' | 'closed' | 'merged'
}

/** The pull requests of one WorkDesk, a card on the page. */
export interface DeskPrCard {
  deskId: string
  deskName: string
  stage: string
  stageKey: Stage
  createdAt: number
  prs: DeskPr[]
}

export type DeskPrsGrouping = 'desk' | 'stage'
export type DeskPrsOrder = 'name' | 'oldest' | 'newest' | 'author'

/** The Stages a grouping by Stage shows, in this order: the review ones first. */
const STAGE_ORDER: readonly Stage[] = ['to-review', 're-review', 'reviewed-waiting', 'implement', 'testing', 'in-review', 'waiting', 'done']

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
export function byDesk(prs: readonly DeskPr[]): DeskPrCard[] {
  const groups = new Map<string, DeskPrCard>()
  for (const p of prs) {
    const g = groups.get(p.deskId) ?? { deskId: p.deskId, deskName: p.deskName, stage: p.stage, stageKey: p.stageKey, createdAt: p.createdAt, prs: [] }
    g.prs.push(p)
    groups.set(p.deskId, g)
  }
  return [...groups.values()]
}

/**
 * The cards of the page, ordered and grouped: by WorkDesk is one list (the WorkDesks with ones to review first), by Stage one section per
 * Stage (To review, Re-review, Reviewed, waiting, then your own). `author` orders by who opened the first pull request with an author;
 * the WorkDesks without one come last. Ties go by name.
 */
export function arrangeDeskPrs(prs: readonly DeskPr[], grouping: DeskPrsGrouping, order: DeskPrsOrder): { title?: string; cards: DeskPrCard[] }[] {
  const authorOf = (c: DeskPrCard) => c.prs.find((p) => p.author)?.author?.toLowerCase()
  const rank = (c: DeskPrCard) => (c.prs.some((p) => p.role === 'review') ? 0 : 1)
  const byOrder = (a: DeskPrCard, b: DeskPrCard): number => {
    if (order === 'oldest' && a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    if (order === 'newest' && a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
    if (order === 'author') {
      const x = authorOf(a)
      const y = authorOf(b)
      if (x !== y) return x === undefined ? 1 : y === undefined ? -1 : x.localeCompare(y)
    }
    return a.deskName.localeCompare(b.deskName)
  }
  const cards = byDesk(prs)
  if (grouping === 'desk') return [{ cards: cards.sort((a, b) => rank(a) - rank(b) || byOrder(a, b)) }]
  return STAGE_ORDER.flatMap((stage) => {
    const these = cards.filter((c) => c.stageKey === stage).sort(byOrder)
    return these.length > 0 ? [{ title: stageLabel(stage), cards: these }] : []
  })
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
    const add = (id: string, title: string, url: string | undefined, role: DeskPr['role'], author?: string) => {
      const link = url ?? prUrl(id)
      if (seen.has(id) || !link) return
      seen.add(id)
      out.push({ id, title, url: link, role, deskId: d.id, deskName: d.name, stage: stageLabel(d.stage), stageKey: d.stage, createdAt: d.createdAt, ...(author ? { author } : {}), ...(states.get(id)?.snapshot ? { state: states.get(id)!.snapshot!.state } : {}) })
    }
    for (const i of d.items ?? []) if (i.kind === 'pr') add(i.id, i.title, i.url, isOwnPr(d, i) ? 'mine' : 'review', i.author)
    for (const [id, r] of states) add(id, id, r.url, 'review')
  }
  const rank = (p: DeskPr) => (p.role === 'review' ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b) || a.deskName.localeCompare(b.deskName) || a.id.localeCompare(b.id))
}

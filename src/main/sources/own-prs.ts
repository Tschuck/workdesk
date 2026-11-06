import { ownPrItems, ownPrNews, ownPrsFinished, ownPrStage, type PrNews } from '../domain/own-pr-news'
import type { PrTodoState } from '../domain/prs'
import { deriveDeskStage } from '../domain/review'
import { applyDerivedStage } from '../domain/stage'
import type { ReviewInfo } from '../domain/types'
import type { WorkDeskService } from '../service'
import { parsePrId, type WatchedPrState } from './github/api'
import type { WatchedPr } from './pr-watch'

type Known = PrTodoState & { changesBy?: string[]; requested?: string[] }

/**
 * What was last read of each pull request, per service: one that was not read this round (GitHub did not answer for it, or it was seen
 * merged and is not asked about again) still counts with what is known of it, so the Stage does not flip for one round.
 */
const lastRead = new WeakMap<WorkDeskService, Map<string, Known>>()

/**
 * What is new on the pull requests of your own: a review, a request for changes, comments. It becomes a Signal of the WorkDesk that has it
 * (also a parked or postponed one: a Signal brings it back), and what was seen is kept with the work item, so it is told once, also across
 * a restart of the app.
 */
export async function trackOwnPrs(
  service: WorkDeskService,
  read: ReadonlyMap<string, WatchedPrState>,
  targets: readonly WatchedPr[],
  onNews?: (pr: { deskId: string; id: string; title: string; url?: string }, news: PrNews) => void
): Promise<void> {
  let known = lastRead.get(service)
  if (!known) lastRead.set(service, (known = new Map()))
  for (const [id, w] of read) known.set(id, { ...w.state, changesBy: w.snapshot.changesBy, requested: w.snapshot.requested })

  // first whose they are: somebody else's pull request is to be reviewed, and tells nothing of the kind of your own
  for (const deskId of new Set(targets.map((t) => t.deskId))) await sortOutPrs(service, deskId, read)
  for (const target of targets) {
    const watched = read.get(target.id)
    const desk = service.getState().desks.find((d) => d.id === target.deskId)
    const item = desk && ownPrItems(desk).find((i) => i.id === target.id)
    if (!watched || !desk || !item) continue
    const { seen, news } = ownPrNews(item.seen, watched.state, watched.snapshot.commentCount)
    const same = item.seen && item.seen.approvals === seen.approvals && item.seen.changesRequested === seen.changesRequested && item.seen.commentCount === seen.commentCount
    if (!same) await service.updateDesk(desk.id, (d) => ({ ...d, items: (d.items ?? []).map((i) => (i.kind === item.kind && i.id === item.id ? { ...i, seen } : i)) }))
    const number = target.id.slice(target.id.lastIndexOf('#'))
    for (const n of news) {
      service.raiseDeskSignal(desk.id, n.type, `${number} ${n.message}`)
      onNews?.({ deskId: desk.id, id: target.id, title: item.title, url: item.url ?? watched.state.url }, n)
    }
  }
  for (const deskId of new Set(targets.map((t) => t.deskId))) {
    const desk = service.getState().desks.find((d) => d.id === deskId)
    if (!desk || desk.stageOverridden || (desk.reviews ?? []).length > 0) continue
    // the Stage that follows from the pull requests of the WorkDesk: changes requested, conflicts, failed checks or a merge to do are yours
    // again, open and unquestioned it waits, all merged or closed (and no Todo left open) it is done
    const own = ownPrItems(desk)
    const states = own.flatMap((i) => known!.get(i.id) ?? [])
    // one of them was never read: it cannot be told where the WorkDesk stands
    if (states.length < own.length) continue
    const openTodos = service.getState().todos.some((t) => desk.todoIds.includes(t.id) && !t.resolved)
    const stage = ownPrsFinished(states) ? (openTodos ? undefined : ('done' as const)) : ownPrStage(states)
    if (stage && stage !== desk.stage) await service.updateDesk(deskId, (d) => ({ ...d, stage }))
  }
}

/**
 * The pull requests a WorkDesk has as work items that are somebody else's are to be reviewed: they get the `review` role (older ones were
 * taken as your own and made the WorkDesk wait), and the WorkDesk reviews them like one started from a pull request, so its Stage follows
 * the review (To review, Reviewed, waiting, Re-review).
 */
async function sortOutPrs(service: WorkDeskService, deskId: string, read: ReadonlyMap<string, WatchedPrState>): Promise<void> {
  const desk = service.getState().desks.find((d) => d.id === deskId)
  if (!desk) return
  const theirs = (desk.items ?? []).filter((i) => i.kind === 'pr' && (i.role === 'review' || (!i.role && read.get(i.id)?.mine === false)))
  const toTell = theirs.filter((i) => !i.role)
  const covered = new Set((desk.reviews ?? []).map((r) => `${r.owner}/${r.repo}#${r.number}`))
  const toReview = theirs.filter((i) => !covered.has(i.id) && read.get(i.id)?.snapshot)
  if (toTell.length === 0 && toReview.length === 0) return
  await service.updateDesk(deskId, (d) => {
    const tell = new Set(toTell.map((i) => i.id))
    const items = (d.items ?? []).map((i) => (i.kind === 'pr' && tell.has(i.id) ? { ...i, role: 'review' as const } : i))
    const reviews: ReviewInfo[] = [
      ...(d.reviews ?? []),
      ...toReview.map((i) => {
        const { owner, repo, number } = parsePrId(i.id)
        return { owner, repo, number, url: i.url ?? `https://github.com/${owner}/${repo}/pull/${number}`, snapshot: read.get(i.id)!.snapshot }
      })
    ]
    const stage = reviews.length > 0 ? applyDerivedStage({ stage: d.stage, stageOverridden: d.stageOverridden }, deriveDeskStage(reviews) ?? d.stage) : {}
    return { ...d, items, ...(reviews.length > 0 ? { reviews } : {}), ...stage }
  })
}

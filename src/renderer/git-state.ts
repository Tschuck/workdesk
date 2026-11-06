// What the File pane knows about the git side of its Branch folders: changed files, review comments and type problems.
// One module-level bus tells every File pane to ask again (after a save, a stage, a commit, a comment, a window focus).
import { useEffect, useMemo, useState } from 'react'
import type { FileRoot } from '../main/files'
import { markers, type ChangeKind, type GitEntry } from '../main/domain/git-status'
import { commentCounts, type ReviewComment } from '../main/domain/local-review'
import { problemCounts, type Problem } from '../main/domain/diagnostics'

const bus = new EventTarget()
const CHANGED = 'workdesk:git-changed'

/** Something changed in the folders' git state (or its review): every File pane asks again. */
export const notifyGitChanged = (): void => void bus.dispatchEvent(new Event(CHANGED))

/** a folder with git (a Branch), not scratch or notes */
export const isGitRoot = (r: FileRoot): boolean => !r.scratch && !r.plain

export interface RootMarks {
  entries: GitEntry[]
  /** change kind per path (files and the folders above them) */
  git: Record<string, ChangeKind>
  comments: Record<string, number>
  allComments: ReviewComment[]
  /** type problems per path (files and folders); only after a check */
  problems?: Record<string, number>
  problemList?: Problem[]
  problemsMessage?: string
  checking?: boolean
}

const checked = new Map<string, { list: Problem[]; message?: string }>()
const checking = new Set<string>()

/** Runs the project's own `tsc --noEmit` in the folder; the counts show in the tree afterwards. */
export async function checkProblems(deskId: string, rootPath: string): Promise<void> {
  if (checking.has(rootPath)) return
  checking.add(rootPath)
  notifyGitChanged()
  try {
    const r = await window.workdesk.diagnosticsCheck(deskId, rootPath)
    checked.set(rootPath, { list: r.problems, message: r.message })
  } catch (e) {
    checked.set(rootPath, { list: [], message: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
  } finally {
    checking.delete(rootPath)
    notifyGitChanged()
  }
}

export const cleanError = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Marks per git folder of `roots`; asked again on every `notifyGitChanged()` and when the window gets the focus. */
export function useMarks(deskId: string, roots: readonly FileRoot[]): Record<string, RootMarks> {
  const [data, setData] = useState<Record<string, { entries: GitEntry[]; comments: ReviewComment[] }>>({})
  const [tick, setTick] = useState(0)
  const key = roots.filter(isGitRoot).map((r) => r.path).join('|')
  useEffect(() => {
    const on = () => setTick((t) => t + 1)
    bus.addEventListener(CHANGED, on)
    window.addEventListener('focus', on)
    return () => (bus.removeEventListener(CHANGED, on), window.removeEventListener('focus', on))
  }, [])
  useEffect(() => {
    let live = true
    const paths = key ? key.split('|') : []
    void Promise.all(
      paths.map(async (p) => {
        const [entries, review] = await Promise.all([
          window.workdesk.gitStatus(deskId, p).catch(() => [] as GitEntry[]),
          window.workdesk.reviewState(deskId, p).catch(() => undefined)
        ])
        return [p, { entries, comments: review?.comments ?? [] }] as const
      })
    ).then((all) => live && setData(Object.fromEntries(all)))
    return () => {
      live = false
    }
  }, [deskId, key, tick])
  return useMemo(() => {
    const out: Record<string, RootMarks> = {}
    for (const [p, d] of Object.entries(data)) {
      const c = checked.get(p)
      out[p] = {
        entries: d.entries,
        git: markers(d.entries),
        comments: commentCounts(d.comments),
        allComments: d.comments,
        problems: c ? problemCounts(c.list) : undefined,
        problemList: c?.list,
        problemsMessage: c?.message,
        checking: checking.has(p)
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tick])
}

/** A number that changes whenever the state may have: for a panel that asks for its own data. */
export function useGitTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const on = () => setTick((t) => t + 1)
    bus.addEventListener(CHANGED, on)
    window.addEventListener('focus', on)
    return () => (bus.removeEventListener(CHANGED, on), window.removeEventListener('focus', on))
  }, [])
  return tick
}

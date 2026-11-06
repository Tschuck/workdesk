import { useEffect, useState, type ReactNode } from 'react'
import './editor-git.css'
import type { FileRoot } from '../main/files'
import { filterByPreset, type ReviewPreset } from '../main/domain/review-presets'
import { buildReviewTree, childrenOf, commentCounts, type ReviewChild, type ReviewEntry } from '../main/domain/local-review'
import type { ReviewState } from '../main/review-service'
import type { DiffRequest } from './DiffView'
import { Chevron, FileIcon } from './FileIcon'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { cleanError, isGitRoot, notifyGitChanged, useGitTick } from './git-state'

interface Props {
  deskId: string
  roots: FileRoot[]
  onDiff: (req: DiffRequest) => void
  /** the file whose diff is shown (absolute path), marked in the list */
  current?: string
  /** only the changed files in it are listed */
  preset?: ReviewPreset
  /** the menu to pick the preset, shown above the step buttons */
  presetPicker?: ReactNode
}

/** Review mode: per Branch folder the files changed against the merge base with a base branch, with the number of comments per file. */
export function ReviewPanel({ deskId, roots, onDiff, current, preset, presetPicker }: Props) {
  const git = roots.filter(isGitRoot)
  if (git.length === 0) return <p className="hint side-note">No Branch folder here.</p>
  return (
    <div className="git-panel">
      {git.map((r) => (
        <RootReview key={r.path} deskId={deskId} root={r} onDiff={onDiff} current={current} many={git.length > 1} preset={preset} presetPicker={presetPicker} />
      ))}
    </div>
  )
}

const LETTER_CLASS: Record<ReviewEntry['status'], string> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', U: 'untracked' }

/** the files of the tree in the order they are listed */
function flatten(children: ReviewChild[]): ReviewEntry[] {
  return children.flatMap((c) => (c.kind === 'dir' ? flatten(childrenOf(c.node)) : [c.entry]))
}

/** a commit hash as the base is shown short; a branch name as it is */
const shortBase = (base?: string): string | undefined => (base && /^[0-9a-f]{40}$/.test(base) ? base.slice(0, 8) : base)

const reviewedKey = (deskId: string, root: string, base: string) => `workdesk.reviewed.${deskId}.${root}.${base}`
const readReviewed = (key: string): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function RootReview({ deskId, root, onDiff, many, current, preset, presetPicker }: { deskId: string; root: FileRoot; onDiff: Props['onDiff']; many: boolean; current?: string; preset?: ReviewPreset; presetPicker?: ReactNode }) {
  const api = window.workdesk
  const tick = useGitTick()
  const [state, setState] = useState<ReviewState>()
  const [branches, setBranches] = useState<string[]>([])
  // the newest commits of the Branch: one of them can be the base instead of a branch
  const [commits, setCommits] = useState<{ sha: string; title: string }[]>([])
  const [error, setError] = useState<string>()
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] }>()
  const [closed, setClosed] = useState<Set<string>>(new Set())
  // the files ticked as reviewed, per WorkDesk, Branch folder and base; kept on this machine
  const key = reviewedKey(deskId, root.path, state?.base ?? '')
  const [reviewed, setReviewed] = useState<Set<string>>(new Set())
  useEffect(() => setReviewed(readReviewed(key)), [key])
  const setTick = (paths: string[], on: boolean) => {
    const next = new Set(reviewed)
    for (const p of paths) on ? next.add(p) : next.delete(p)
    setReviewed(next)
    try {
      localStorage.setItem(key, JSON.stringify([...next]))
    } catch {
      /* not remembered */
    }
  }

  useEffect(() => {
    let live = true
    api.reviewState(deskId, root.path).then((s) => live && (setState(s), setError(undefined)), (e) => live && setError(cleanError(e)))
    return () => {
      live = false
    }
  }, [api, deskId, root.path, tick])
  useEffect(() => void api.reviewBranches(deskId, root.path).then(setBranches, () => setBranches([])), [api, deskId, root.path])
  // read again with every change of the folder: a new commit is the newest one
  useEffect(() => void api.reviewCommits(deskId, root.path).then(setCommits, () => setCommits([])), [api, deskId, root.path, tick])

  const counts = commentCounts(state?.comments ?? [])
  const fail = (e: unknown) => setError(cleanError(e))
  const pick = (base: string) => void api.reviewSetBase(deskId, root.path, base).then(notifyGitChanged, fail)
  const toggle = (path: string) => setClosed((c) => new Set(c.has(path) ? [...c].filter((x) => x !== path) : [...c, path]))

  const entries = filterByPreset(state?.entries ?? [], preset)
  const hidden = (state?.entries.length ?? 0) - entries.length
  const files = state ? flatten(childrenOf(buildReviewTree(entries))) : []
  const open = (e: ReviewEntry) => onDiff({ path: `${root.path}/${e.path}`, rootPath: root.path, mode: 'review', oldPath: e.oldPath, baseLabel: shortBase(state?.base) })
  const at = files.findIndex((e) => `${root.path}/${e.path}` === current)
  const step = (dir: 1 | -1) => {
    if (files.length === 0) return
    const to = files[at < 0 ? (dir === 1 ? 0 : files.length - 1) : (at + dir + files.length) % files.length]
    open(to)
  }
  const doneCount = files.filter((e) => reviewed.has(e.path)).length
  /** tick the file that is shown and go to the next one that is not ticked yet */
  const doneAndNext = () => {
    const here = files[at]
    if (here) setTick([here.path], true)
    const after = [...files.slice(at + 1), ...files.slice(0, Math.max(at, 0))].find((e) => !reviewed.has(e.path) && e.path !== here?.path)
    if (after) open(after)
  }

  const view = (c: ReviewChild, depth: number) => {
    if (c.kind === 'dir') {
      const folded = closed.has(c.path)
      return (
        <li key={'d' + c.path}>
          <div
            className="file-folder"
            style={{ paddingLeft: depth * 14 + 6 }}
            onClick={() => toggle(c.path)}
            onContextMenu={(ev) => {
              ev.preventDefault()
              setMenu({
                x: ev.clientX,
                y: ev.clientY,
                items: [
                  { label: 'Copy relative path', onClick: () => void api.writeClipboard(c.path) },
                  { label: 'Copy path', onClick: () => void api.writeClipboard(`${root.path}/${c.path}`) }
                ]
              })
            }}
          >
            <Chevron open={!folded} />
            <span className="file-label">{c.label}</span>
          </div>
          {!folded && <ul className="file-nodes">{childrenOf(c.node).map((x) => view(x, depth + 1))}</ul>}
        </li>
      )
    }
    const e = c.entry
    const name = e.path.split('/').pop() ?? e.path
    const n = counts[e.path] ?? 0
    return (
      <li key={'f' + e.path}>
        <div
          className={'file-leaf' + (`${root.path}/${e.path}` === current ? ' current' : '') + (reviewed.has(e.path) ? ' reviewed' : '')}
          style={{ paddingLeft: depth * 14 + 6 }}
          title={e.oldPath ? `${e.oldPath} → ${e.path}` : e.path}
          onClick={() => open(e)}
          onContextMenu={(ev) => {
            ev.preventDefault()
            setMenu({
              x: ev.clientX,
              y: ev.clientY,
              items: [
                { label: 'Show the diff', onClick: () => open(e) },
                { label: 'Copy relative path', onClick: () => void api.writeClipboard(e.path) },
                { label: 'Copy path', onClick: () => void api.writeClipboard(`${root.path}/${e.path}`) }
              ]
            })
          }}
        >
          <input type="checkbox" className="rv-tick" checked={reviewed.has(e.path)} title="Reviewed" aria-label={`${name} reviewed`} onClick={(ev) => ev.stopPropagation()} onChange={(ev) => setTick([e.path], ev.target.checked)} />
          <FileIcon name={name} />
          <span className="file-label">{name}</span>
          {n > 0 && <span className="rv-count" title={`${n} comment${n === 1 ? '' : 's'}`}>💬 {n}</span>}
          <span className={`git-letter git-${LETTER_CLASS[e.status]}`}>{e.status}</span>
        </div>
      </li>
    )
  }

  return (
    <section className="git-root">
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(undefined)} />}
      <h4>
        <span>{many ? root.label : 'Review'}</span>
        <span className="file-spacer" />
        <button type="button" title="Read the changes again" onClick={notifyGitChanged}>↻</button>
      </h4>
      {(() => {
        // a commit as the base is a 40-character hash; it is picked in the second box, the first one then has no branch selected
        const isCommit = !!state?.base && /^[0-9a-f]{40}$/.test(state.base)
        const sha = isCommit ? (state!.base as string) : ''
        return (
          <>
            <label className="rv-base">
              <span className="hint">Base</span>
              <select value={isCommit ? '' : (state?.base ?? '')} onChange={(e) => pick(e.target.value)} aria-label="Base branch">
                {(!state?.base || isCommit) && <option value="" disabled>{isCommit ? 'Since a commit (below)' : 'Pick a base branch…'}</option>}
                {state?.base && !isCommit && !branches.includes(state.base) && <option value={state.base}>{state.base}</option>}
                {branches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
            {commits.length > 0 && (
              <label className="rv-base">
                <span className="hint">Since</span>
                <select value={sha} onChange={(e) => pick(e.target.value)} aria-label="Base commit" title="Review only what changed after a commit of this Branch">
                  <option value="" disabled>{isCommit ? '' : 'or a commit…'}</option>
                  {isCommit && !commits.some((c) => c.sha === sha) && <option value={sha}>{sha.slice(0, 8)}</option>}
                  {commits.map((c) => (
                    <option key={c.sha} value={c.sha}>{c.sha.slice(0, 8)} {c.title}</option>
                  ))}
                </select>
              </label>
            )}
          </>
        )
      })()}
      {state?.mergeBase && <p className="hint" title="git merge-base">Merge base {state.mergeBase.slice(0, 8)}</p>}
      {error && <pre className="git-error" onClick={() => setError(undefined)}>{error}</pre>}
      {state?.message && <p className="hint">{state.message}</p>}
      {presetPicker}
      {hidden > 0 && <p className="hint" title={preset?.description}>{preset?.name}: {hidden} of {state?.entries.length} changed file{state?.entries.length === 1 ? '' : 's'} hidden</p>}
      {files.length > 0 && (
        <div className="rv-steps">
          <button type="button" title="The previous changed file" onClick={() => step(-1)}>◀ Previous</button>
          <button type="button" title="The next changed file" onClick={() => step(1)}>Next ▶</button>
          <button type="button" title="Tick the file that is shown as reviewed and go to the next one that is not" disabled={at < 0} onClick={doneAndNext}>Reviewed ✓ &amp; next</button>
          <span className="rv-progress" title="Files ticked as reviewed">{doneCount}/{files.length} reviewed</span>
          {doneCount > 0 && <button type="button" className="link-btn" title="Remove all ticks" onClick={() => setTick(files.map((e) => e.path), false)}>reset</button>}
        </div>
      )}
      <ul className="file-nodes">{state ? childrenOf(buildReviewTree(entries)).map((c) => view(c, 0)) : null}</ul>
    </section>
  )
}

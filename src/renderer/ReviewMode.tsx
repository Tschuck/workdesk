import { useEffect, useRef, useState } from 'react'
import './editor-git.css'
import './review-mode.css'
import type { FileRoot } from '../main/files'
import { DiffView, type DiffRequest } from './DiffView'
import { GitPanel } from './GitPanel'
import { ReviewPanel } from './ReviewPanel'
import { ReviewComments } from './ReviewComments'
import { ScopeSwitch } from './ScopeSwitch'
import { useCommentsHost } from './comments-host'
import { isGitRoot, useGitTick, useMarks } from './git-state'
import type { ReviewPreset } from '../main/domain/review-presets'
import { PANEL_SIZES, Resizer } from './Resizer'
import { scopedRoots, useScope } from './scope'

type Part = 'review' | 'changes' | 'comments'

/**
 * Review tab of a WorkDesk: it takes the place of the tab content while it is the active tab. On the left what changed (since the base branch, or in the working tree: stage and commit),
 * on the right the diff of the file with its line comments. The tabs are not touched; leaving puts them back.
 */
export function ReviewMode({ deskId, roots, onExit, onOpenFile }: { deskId: string; roots: FileRoot[]; onExit: () => void; onOpenFile: (path: string, line?: number) => void }) {
  const scope = useScope(deskId)
  const scoped = scopedRoots(roots, scope)
  const marks = useMarks(deskId, scoped)
  const [part, setPart] = useState<Part>('review')
  // the Review presets: which of the changed files the review shows (also the ones made for this WorkDesk by the desk-review-preset skill)
  const tick = useGitTick()
  const [presets, setPresets] = useState<ReviewPreset[]>([])
  const presetKey = `workdesk.reviewPreset.${deskId}`
  const [presetId, setPresetId] = useState(() => {
    try {
      return localStorage.getItem(presetKey) ?? 'whole-review'
    } catch {
      return 'whole-review'
    }
  })
  useEffect(() => void window.workdesk.reviewPresets(deskId).then(setPresets, () => setPresets([])), [deskId, tick])
  const preset = presets.find((p) => p.id === presetId)
  const pickPreset = (id: string) => {
    setPresetId(id)
    try {
      localStorage.setItem(presetKey, id)
    } catch {
      /* not remembered */
    }
  }
  const [diff, setDiff] = useState<DiffRequest>()
  // the diff has edits that are not saved: another file is only shown after asking
  const diffDirty = useRef(false)
  const pick = (d: DiffRequest | undefined) => {
    if (diffDirty.current && !window.confirm('This file has changes that are not saved (⌘S). Show the other file and lose them?')) return
    setDiff(d)
  }
  const [error, setError] = useState<string>()
  const commentTotal = Object.values(marks).reduce((n, m) => n + m.allComments.length, 0)
  const changed = Object.values(marks).reduce((n, m) => n + m.entries.length, 0)

  // a file of another branch than the scope is not in the list any more
  useEffect(() => setDiff((d) => (d && scoped.some((r) => r.path === d.rootPath) ? d : undefined)), [scope]) // eslint-disable-line react-hooks/exhaustive-deps

  const rootPath = diff?.rootPath
  const rel = diff && rootPath ? diff.path.slice(rootPath.length + 1) : undefined
  const host = useCommentsHost(deskId, rootPath, rel, rootPath ? marks[rootPath]?.allComments : undefined, setError)
  const presetPicker =
    presets.length > 1 ? (
      <label className="rv-base">
        <span className="hint">Preset</span>
        <select value={preset?.id ?? 'whole-review'} onChange={(e) => pickPreset(e.target.value)} aria-label="Review preset" title={preset?.description}>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {preset && !preset.builtin && (
          <button type="button" className="link-btn" title="Delete this preset" onClick={() => void window.workdesk.reviewPresetRemove(deskId, preset.id).then((l) => (setPresets(l), pickPreset('whole-review')), (e) => setError(String(e?.message ?? e)))}>delete</button>
        )}
      </label>
    )
    : undefined
  const git = scoped.filter(isGitRoot)
  const withGit = git.length > 0

  return (
    <div className="review-mode">
      <aside className="file-side review-side">
        <div className="review-head">
          <strong>Review</strong>
          <span className="file-spacer" />
          <button type="button" title="Close the Review tab" onClick={onExit}>Close review</button>
        </div>
        <ScopeSwitch deskId={deskId} roots={roots} />
        {withGit && (
          <div className="file-side-tabs">
            <button className={part === 'review' ? 'active' : ''} title="Files changed since the merge base with a base branch, with comments" onClick={() => setPart('review')}>Since base</button>
            <button className={part === 'comments' ? 'active' : ''} title="All review comments: edit, delete, copy as markdown" onClick={() => setPart('comments')}>Comments{commentTotal ? ` ${commentTotal}` : ''}</button>
            <button className={part === 'changes' ? 'active' : ''} title="The working tree: stage, commit, type problems" onClick={() => setPart('changes')}>Working tree{changed ? ` ${changed}` : ''}</button>
          </div>
        )}
        {!withGit ? (
          <p className="hint side-note">This WorkDesk has no Branch folder to review.</p>
        ) : part === 'review' ? (
          <>
            <ReviewPanel deskId={deskId} roots={scoped} onDiff={pick} current={diff?.mode === 'review' ? diff.path : undefined} preset={preset} presetPicker={presetPicker} />
          </>
        ) : part === 'comments' ? (
          <ReviewComments deskId={deskId} roots={scoped} onDiff={pick} />
        ) : (
          <GitPanel deskId={deskId} roots={scoped} marks={marks} onDiff={pick} onOpen={(p, l) => onOpenFile(p, l)} />
        )}
      </aside>
      <Resizer size={PANEL_SIZES.files} min={200} max={720} edge="right" panel={(h) => h.previousElementSibling as HTMLElement | null} className="files-resizer" />
      <div className="review-main">
        {error && <p className="file-note error" onClick={() => setError(undefined)}>{error}</p>}
        {diff ? (
          <DiffView
            key={diff.path + diff.mode}
            deskId={deskId}
            request={diff}
            comments={host}
            commentsKey={rootPath ? marks[rootPath]?.allComments : undefined}
            onEdit={(line) => onOpenFile(diff.path, line)}
            onDirty={(d) => {
              diffDirty.current = d
            }}
            onClose={() => setDiff(undefined)}
          />
        ) : (
          <p className="hint review-empty">Pick a changed file on the left to see what changed. Click the gutter of a line to leave a comment (shared with the Local Review extension).</p>
        )}
      </div>
    </div>
  )
}

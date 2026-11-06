import { useState } from 'react'
import './editor-git.css'
import type { FileRoot } from '../main/files'
import { entryKind, isStaged, isUnstaged, KIND_LETTER, type GitEntry } from '../main/domain/git-status'
import type { DiffRequest } from './DiffView'
import { FileIcon } from './FileIcon'
import { checkProblems, cleanError, isGitRoot, notifyGitChanged, type RootMarks } from './git-state'

interface Props {
  deskId: string
  roots: FileRoot[]
  marks: Record<string, RootMarks>
  onDiff: (req: DiffRequest) => void
  onOpen: (path: string, line?: number) => void
}

/** The "Changes" side of the File pane: per Branch folder the staged and unstaged files, a commit box, and the type problems. */
export function GitPanel({ deskId, roots, marks, onDiff, onOpen }: Props) {
  const git = roots.filter(isGitRoot)
  if (git.length === 0) return <p className="hint side-note">No Branch folder here.</p>
  return (
    <div className="git-panel">
      {git.map((r) => (
        <RootChanges key={r.path} deskId={deskId} root={r} marks={marks[r.path]} onDiff={onDiff} onOpen={onOpen} many={git.length > 1} />
      ))}
    </div>
  )
}

function RootChanges({ deskId, root, marks, onDiff, onOpen, many }: { deskId: string; root: FileRoot; marks?: RootMarks; onDiff: Props['onDiff']; onOpen: Props['onOpen']; many: boolean }) {
  const api = window.workdesk
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()
  const [busy, setBusy] = useState(false)
  const entries = marks?.entries ?? []
  const staged = entries.filter(isStaged)
  const unstaged = entries.filter(isUnstaged)

  const run = async (job: () => Promise<unknown>) => {
    setBusy(true)
    setError(undefined)
    setDone(undefined)
    try {
      await job()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(false)
      notifyGitChanged()
    }
  }
  const stage = (paths: string[]) => run(() => api.gitStage(deskId, root.path, paths))
  const unstage = (paths: string[]) => run(() => api.gitUnstage(deskId, root.path, paths))
  const commit = () =>
    run(async () => {
      const line = await api.gitCommit(deskId, root.path, message)
      setMessage('')
      setDone(line)
    })

  const open = (e: GitEntry) => onDiff({ path: `${root.path}/${e.path}`, rootPath: root.path, mode: 'head' })
  const row = (e: GitEntry, side: 'staged' | 'unstaged') => {
    const kind = entryKind(e)
    // the column that counts for this list: a file staged and changed again is in both
    const letter = side === 'staged' ? (e.x === 'A' ? 'A' : e.x === 'D' ? 'D' : e.x === 'R' ? 'R' : 'M') : KIND_LETTER[kind]
    const name = e.path.split('/').pop() ?? e.path
    const dir = e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : ''
    return (
      <li key={side + e.path} className="git-row" title={e.from ? `${e.from} → ${e.path}` : e.path} onClick={() => open(e)}>
        <FileIcon name={name} />
        <span className="git-name">{name}</span>
        <span className="hint git-dir">{dir}</span>
        <button type="button" className="git-act" title={side === 'staged' ? 'Unstage' : 'Stage'} disabled={busy} onClick={(ev) => (ev.stopPropagation(), void (side === 'staged' ? unstage([e.path]) : stage([e.path])))}>
          {side === 'staged' ? '−' : '+'}
        </button>
        <span className={`git-letter git-${side === 'staged' ? 'added' : kind}`}>{letter}</span>
      </li>
    )
  }

  const problems = marks?.problemList
  return (
    <section className="git-root">
      <h4>
        <span>{many ? root.label : 'Changes'}</span>
        <span className="file-spacer" />
        <button type="button" disabled={marks?.checking} title="Run the project's own tsc --noEmit here and show the problem counts in the tree" onClick={() => void checkProblems(deskId, root.path)}>
          {marks?.checking ? 'Checking…' : problems ? `Problems: ${problems.length}` : 'Check types'}
        </button>
      </h4>
      {marks?.problemsMessage && <p className="hint">{marks.problemsMessage}</p>}
      {problems && problems.length > 0 && (
        <ul className="git-problems">
          {problems.slice(0, 200).map((p, i) => (
            <li key={i} title={`${p.code}: ${p.message}`} onClick={() => onOpen(`${root.path}/${p.path}`, p.line)}>
              <span className="git-problem-at">{p.path.split('/').pop()}:{p.line}</span> {p.message}
            </li>
          ))}
          {problems.length > 200 && <li className="hint">… and {problems.length - 200} more</li>}
        </ul>
      )}
      <div className="git-commit">
        <textarea
          value={message}
          rows={2}
          placeholder="Commit message (⌘Enter commits the staged files)"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && staged.length > 0 && message.trim() && (e.preventDefault(), void commit())}
        />
        <button type="button" className="primary" disabled={busy || staged.length === 0 || !message.trim()} title="Commit with your git configuration (signing and hooks as in a terminal). Nothing is pushed." onClick={() => void commit()}>
          Commit{staged.length ? ` (${staged.length})` : ''}
        </button>
      </div>
      {error && <pre className="git-error" onClick={() => setError(undefined)} title="Click to dismiss">{error}</pre>}
      {done && <p className="hint">{done}</p>}
      <h5>
        <span>Staged ({staged.length})</span>
        {staged.length > 0 && <button type="button" disabled={busy} onClick={() => void unstage(staged.map((e) => e.path))}>Unstage all</button>}
      </h5>
      <ul className="git-list">{staged.map((e) => row(e, 'staged'))}</ul>
      <h5>
        <span>Changes ({unstaged.length})</span>
        {unstaged.length > 0 && <button type="button" disabled={busy} onClick={() => void stage(unstaged.map((e) => e.path))}>Stage all</button>}
      </h5>
      <ul className="git-list">{unstaged.map((e) => row(e, 'unstaged'))}</ul>
      {entries.length === 0 && <p className="hint">No changes.</p>}
    </section>
  )
}

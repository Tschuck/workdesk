import { useEffect, useState } from 'react'
import type { FileRoot } from '../main/files'
import { renderMarkdown, type ReviewComment } from '../main/domain/local-review'
import type { ReviewState } from '../main/review-service'
import type { DiffRequest } from './DiffView'
import { cleanError, isGitRoot, notifyGitChanged, useGitTick } from './git-state'

/** Review: all line comments of the review in one list: open one in the diff, change its text, delete it, copy them all as markdown. They are kept in `.review/comments.json`. */
export function ReviewComments({ deskId, roots, onDiff }: { deskId: string; roots: FileRoot[]; onDiff: (req: DiffRequest) => void }) {
  const api = window.workdesk
  const tick = useGitTick()
  const git = roots.filter(isGitRoot)
  const [states, setStates] = useState<Record<string, ReviewState>>({})
  const [editing, setEditing] = useState<{ root: string; id: string; text: string }>()
  // a comment on the review as a whole: being written
  const [adding, setAdding] = useState<{ root: string; text: string }>()
  const [message, setMessage] = useState<{ text: string; error?: boolean }>()

  useEffect(() => {
    let live = true
    void Promise.all(git.map(async (r) => [r.path, await api.reviewState(deskId, r.path)] as const)).then(
      (all) => live && setStates(Object.fromEntries(all)),
      (e) => live && setMessage({ text: cleanError(e), error: true })
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, deskId, tick, git.map((r) => r.path).join('\u0000')])

  const fail = (e: unknown) => setMessage({ text: cleanError(e), error: true })
  const total = git.reduce((n, r) => n + (states[r.path]?.comments.length ?? 0) + (states[r.path]?.notes.length ?? 0), 0)

  const open = (root: FileRoot, c: ReviewComment) => {
    const entry = states[root.path]?.entries.find((e) => e.path === c.path)
    onDiff({ path: `${root.path}/${c.path}`, rootPath: root.path, mode: 'review', oldPath: entry?.oldPath, baseLabel: states[root.path]?.base, line: c.line })
  }
  const copy = () => {
    const parts = git
      .filter((r) => (states[r.path]?.comments.length ?? 0) + (states[r.path]?.notes.length ?? 0) > 0)
      .map((r) => (git.length > 1 ? `# ${r.label}\n\n` : '') + renderMarkdown(states[r.path].comments, states[r.path].base, states[r.path].notes))
    const text = parts.length > 0 ? parts.join('\n') : renderMarkdown([])
    void api.writeClipboard(text).then(() => setMessage({ text: `${total} comment${total === 1 ? '' : 's'} copied as markdown.` }), fail)
  }
  const save = (root: string, note = false) => {
    if (!editing || !editing.text.trim()) return
    void (note ? api.reviewUpdateNote : api.reviewUpdateComment)(deskId, root, editing.id, editing.text).then(() => (setEditing(undefined), notifyGitChanged()), fail)
  }

  if (git.length === 0) return <p className="hint side-note">No Branch folder to review.</p>
  return (
    <div className="rv-comments">
      <div className="rv-comments-head">
        <span className="hint">{total} comment{total === 1 ? '' : 's'}</span>
        <span className="file-spacer" />
        <button type="button" title="A comment on the review as a whole, not on a line" onClick={() => setAdding({ root: git[0].path, text: '' })}>Add a general comment</button>
        <button type="button" disabled={total === 0} title="Put all comments on the clipboard, one heading per path:line" onClick={copy}>Copy as markdown</button>
        <button
          type="button"
          disabled={total === 0}
          onClick={() => window.confirm(`Delete all ${total} review comments?`) && void Promise.all(git.map((r) => api.reviewClearComments(deskId, r.path))).then(notifyGitChanged, fail)}
        >
          Clear all
        </button>
      </div>
      {message && <p className={message.error ? 'error-text' : 'hint'} onClick={() => setMessage(undefined)}>{message.text}</p>}
      {adding && (
        <div className="rv-comment">
          <span className="rv-comment-where">General comment</span>
          {git.length > 1 && (
            <select value={adding.root} onChange={(e) => setAdding({ ...adding, root: e.target.value })} aria-label="Branch folder">
              {git.map((r) => (
                <option key={r.path} value={r.path}>{r.label}</option>
              ))}
            </select>
          )}
          <textarea
            autoFocus
            rows={4}
            placeholder="About the review as a whole …"
            value={adding.text}
            onChange={(e) => setAdding({ ...adding, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAdding(undefined)
              else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && adding.text.trim()) (e.preventDefault(), void api.reviewAddNote(deskId, adding.root, adding.text).then(() => (setAdding(undefined), notifyGitChanged()), fail))
            }}
          />
          <div className="rv-comment-buttons">
            <button type="button" className="primary" disabled={!adding.text.trim()} onClick={() => void api.reviewAddNote(deskId, adding.root, adding.text).then(() => (setAdding(undefined), notifyGitChanged()), fail)}>Save</button>
            <button type="button" onClick={() => setAdding(undefined)}>Cancel</button>
          </div>
        </div>
      )}
      {total === 0 && !adding && <p className="hint side-note">No comments yet. Click the gutter of a line in a diff to leave one, or add a general comment.</p>}
      {git.map((root) => {
        const comments = [...(states[root.path]?.comments ?? [])].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
        const notes = states[root.path]?.notes ?? []
        if (comments.length === 0 && notes.length === 0) return null
        return (
          <section key={root.path} className="rv-comments-root">
            {git.length > 1 && <h4>{root.label}</h4>}
            <ul>
              {notes.map((n) => {
                const mine = editing?.id === n.id
                return (
                  <li key={n.id} className="rv-comment">
                    <span className="rv-comment-where">General</span>
                    {mine ? (
                      <>
                        <textarea
                          autoFocus
                          rows={Math.min(14, Math.max(3, editing!.text.split('\n').length + 1))}
                          value={editing!.text}
                          onChange={(e) => setEditing({ ...editing!, text: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setEditing(undefined)
                            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), save(root.path, true))
                          }}
                        />
                        <div className="rv-comment-buttons">
                          <button type="button" className="primary" disabled={!editing!.text.trim()} onClick={() => save(root.path, true)}>Save</button>
                          <button type="button" onClick={() => setEditing(undefined)}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="rv-comment-text">{n.text}</div>
                        <div className="rv-comment-buttons">
                          <button type="button" onClick={() => setEditing({ root: root.path, id: n.id, text: n.text })}>Edit</button>
                          <button type="button" onClick={() => void api.reviewRemoveNote(deskId, root.path, n.id).then(notifyGitChanged, fail)}>Delete</button>
                        </div>
                      </>
                    )}
                  </li>
                )
              })}
              {comments.map((c) => {
                const mine = editing?.id === c.id
                return (
                  <li key={c.id} className="rv-comment">
                    <button type="button" className="rv-comment-where" title="Show it in the diff" onClick={() => open(root, c)}>
                      {c.path}<span className="rv-comment-line">:{c.line}</span>
                    </button>
                    {mine ? (
                      <>
                        <textarea
                          autoFocus
                          rows={Math.min(14, Math.max(3, editing!.text.split('\n').length + 1))}
                          value={editing!.text}
                          onChange={(e) => setEditing({ ...editing!, text: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setEditing(undefined)
                            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), save(root.path))
                          }}
                        />
                        <div className="rv-comment-buttons">
                          <button type="button" className="primary" disabled={!editing!.text.trim()} onClick={() => save(root.path)}>Save</button>
                          <button type="button" onClick={() => setEditing(undefined)}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="rv-comment-text">{c.text}</div>
                        <div className="rv-comment-buttons">
                          <button type="button" onClick={() => setEditing({ root: root.path, id: c.id, text: c.text })}>Edit</button>
                          <button type="button" onClick={() => void api.reviewRemoveComment(deskId, root.path, c.id).then(notifyGitChanged, fail)}>Delete</button>
                        </div>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

import { prStatusLabel } from '../main/domain/prs'
import { ReadinessChip } from './PrStates'
import type { DeskPrs } from '../main/sources/desk-prs'
import { Spinner } from './Spinner'

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

interface Props {
  data?: DeskPrs
  loading: boolean
  error?: string
  onRefresh: () => void
  openUrl: (url: string) => void
  /** show the branch's details */
  onOpenBranch?: (project: string, branch: string) => void
}

/** The Pull Requests of branches, with state, readiness and reviews. */
export function PullRequestsPanel({ data, loading, error, onRefresh, openUrl, onOpenBranch }: Props) {
  return (
    <div className="panel prs-panel">
      <h3>
        Pull Requests
        <span className="panel-tools">
          {data && <span className="hint">{clock(data.fetchedAt)}</span>}
          <button disabled={loading} title="Ask GitHub again" onClick={onRefresh}>
            {loading && <Spinner />} {loading ? '' : '↻'}
          </button>
        </span>
      </h3>
      {error && <p className="hint">{error}</p>}
      {!data && !error && <p className="hint">{loading ? 'Asking GitHub…' : 'Not loaded yet.'}</p>}
      {data?.branches.length === 0 && <p className="empty">This WorkDesk has no branches yet.</p>}
      {data?.branches.map((b) => (
        <div key={b.project + '/' + b.branch} className="branch-prs">
          <div className="branch-prs-head">
            {onOpenBranch ? (
              <button className="branch-link" title="Details of this branch" onClick={() => onOpenBranch(b.project, b.branch)}>{b.branch}</button>
            ) : (
              <code className="bname">{b.branch}</code>
            )}
            <small className="hint">{b.project}</small>
          </div>
          {b.error && <div className="hint">{b.error}</div>}
          {b.prs.map((p) => (
            <div key={p.number} className={'pr-line state-' + p.state}>
              <span className={'chip small pr-state-' + (p.draft && p.state === 'open' ? 'draft' : p.state)}>{prStatusLabel(p)}</span>
              <span className="pr-title" title={p.url} onClick={() => openUrl(p.url)}>
                <span className="pr-num">#{p.number}</span> {p.title}
              </span>
              {p.base && <small className="hint" title="merges into">→ {p.base}</small>}
              {p.state === 'open' && (
                <>
                  <ReadinessChip s={p} />
                  {p.approvals > 0 && <span className="chip small rs-approved" title="approvals">✓ {p.approvals}</span>}
                  {p.changesRequested > 0 && <span className="chip small rs-changes" title="changes requested">✗ {p.changesRequested}</span>}
                  {p.pending.length > 0 && <span className="chip small" title={`Waiting for ${p.pending.join(', ')}`}>review: {p.pending.join(', ')}</span>}
                </>
              )}
            </div>
          ))}
          {!b.error && b.repo && b.prs.length === 0 && (
            <div className="pr-line">
              <span className="hint">No pull request yet</span>
              {b.createUrl && <button onClick={() => openUrl(b.createUrl!)}>Create</button>}
            </div>
          )}
          {!b.repo && <div className="hint">Not a GitHub repository.</div>}
        </div>
      ))}
    </div>
  )
}

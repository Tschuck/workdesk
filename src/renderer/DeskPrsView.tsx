import { useMemo, useState } from 'react'
import { byDesk, prPageUrl, prsInDesks, type DeskPr } from '../main/domain/desk-prs'
import type { WorkDesk } from '../main/domain/types'
import { BrowserPane } from './BrowserPane'
import { IconButton } from './Icons'
import './desk-prs.css'

const keyOf = (p: DeskPr) => `${p.deskId} ${p.id}`

/**
 * The pull requests in the WorkDesks of the Profile in view: a list, and the GitHub page of the one picked beside it, with a way to its
 * WorkDesk on top. To clear out the WorkDesks of pull requests that nobody works on.
 */
export function DeskPrsView({ desks, openDesk }: { desks: readonly WorkDesk[]; openDesk: (id: string) => void }) {
  const prs = useMemo(() => prsInDesks(desks), [desks])
  const [picked, setPicked] = useState<string>()
  const current = prs.find((p) => keyOf(p) === picked) ?? prs[0]
  return (
    <section className="desk-prs">
      <div className="desk-prs-list">
        <h2>Pull requests in WorkDesks</h2>
        {prs.length === 0 && <p className="empty">No WorkDesk has a pull request.</p>}
        {byDesk(prs).map((g) => (
          <div key={g.deskId} className="desk-prs-card">
            <h3 title={`${g.deskName} · ${g.stage}`}>
              <span className="desk-prs-desk">{g.deskName}</span>
              <span className="chip small">{g.stage}</span>
              <button className="desk-prs-go" title={`Open the WorkDesk ${g.deskName}`} onClick={() => openDesk(g.deskId)}>
                →
              </button>
            </h3>
            <ul>
              {g.prs.map((p) => (
                <li key={keyOf(p)} className={current && keyOf(current) === keyOf(p) ? 'active' : ''} onClick={() => setPicked(keyOf(p))} title={p.url}>
                  <span className="desk-pr-title">{p.title}</span>
                  <span className="desk-pr-meta">
                    {p.id}
                    {p.role === 'mine' && <span className="chip small">yours</span>}
                    {p.state && p.state !== 'open' && <span className="chip small">{p.state}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {current && (
        <div className="desk-prs-detail">
          <div className="desk-prs-bar">
            <span className="desk-pr-head">
              <strong>{current.title}</strong>
              <small className="hint">
                {current.id} · {current.deskName} · {current.stage}
              </small>
            </span>
            <IconButton icon="link" title="Copy the link of the pull request" onClick={() => void window.workdesk.writeClipboard(current.url)} />
            <button className="go-btn" title={`Open the WorkDesk ${current.deskName}`} onClick={() => openDesk(current.deskId)}>
              WorkDesk →
            </button>
          </div>
          <BrowserPane key={keyOf(current)} url={prPageUrl(current.url)} rememberKey="desk-prs" onLocation={() => undefined} />
        </div>
      )}
    </section>
  )
}

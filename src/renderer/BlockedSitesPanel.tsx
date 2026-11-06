import { useEffect, useState } from 'react'
import { Field, Modal, PageHead } from './Modal'
import { cleanError } from './ProfilesSettings'

/** Settings → Browser → Blocked sites: pages of these sites are not loaded; a pass opens one page of one for ten minutes. */
export function BlockedSitesPanel() {
  const api = window.workdesk
  const [sites, setSites] = useState<string[]>()
  const [adding, setAdding] = useState(false)
  const [site, setSite] = useState('')
  const [error, setError] = useState<string>()
  useEffect(() => void api.siteBlockList().then(setSites), [api])

  const add = () =>
    void api.siteBlockAdd(site).then(
      (list) => (setSites(list), setAdding(false), setSite(''), setError(undefined)),
      (e) => setError(cleanError(e))
    )

  return (
    <section>
      <PageHead title="Blocked sites" addLabel="Block a site" onAdd={() => (setError(undefined), setAdding(true))} />
      <p className="hint">
        Pages of these sites are not loaded in any browser tab of WorkDesk. The page says so, and offers a <strong>pass for that one page</strong>, for ten minutes, after a short wait: you can read the post you
        need, but every other page of the site is blocked again. A site covers its subdomains (<code>reddit.com</code> also blocks <code>old.reddit.com</code>); a path blocks only that part (<code>reddit.com/r/all</code>).
      </p>
      <ul className="todos">
        {(sites ?? []).map((s) => (
          <li key={s}>
            <span className="title"><code>{s}</code></span>
            <span className="actions">
              <button onClick={() => void api.siteBlockRemove(s).then(setSites)}>Remove</button>
            </span>
          </li>
        ))}
        {sites?.length === 0 && <li className="empty">No site is blocked.</li>}
      </ul>
      {adding && (
        <Modal title="Block a site" submitLabel="Block" canSubmit={!!site.trim()} error={error} onClose={() => setAdding(false)} onSubmit={add}>
          <Field label="Site" hint="A domain such as reddit.com, or a part of one such as reddit.com/r/all.">
            <input autoFocus placeholder="reddit.com" value={site} spellCheck={false} onChange={(e) => (setSite(e.target.value), setError(undefined))} />
          </Field>
        </Modal>
      )}
    </section>
  )
}

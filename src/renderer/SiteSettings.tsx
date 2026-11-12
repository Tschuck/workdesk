import { useEffect, useState } from 'react'
import { blockLevelOf, siteBlockLevelOf, siteOf, withSiteBlocking, type BlockLevel } from '../main/domain/browser-sessions'
import { askableOrigin, PERMISSION_LABEL, type Grant, type PagePermission } from '../main/domain/page-origin'
import { setBrowserSessions, useBrowserSessions } from './browser-sessions'
import { IconButton } from './Icons'

const ALL: PagePermission[] = ['camera', 'microphone', 'screen']
const NAME: Record<PagePermission, string> = { camera: 'Camera', microphone: 'Microphone', screen: 'Screen sharing' }
const LEVEL: Record<BlockLevel, string> = { off: 'No blocking', trackers: 'Block trackers', ads: 'Block trackers and ads' }

/**
 * What the open page may use, set from its address bar: the camera, the microphone and screen sharing, and its tracker
 * and ad blocking (instead of the one of all pages), per site. A new blocking level reloads the page (`onBlocking`).
 */
export function SiteSettings({ url, onBlocking }: { url: string; onBlocking?: () => void }) {
  const api = window.workdesk
  const [open, setOpen] = useState(false)
  const [grants, setGrants] = useState<Grant[]>([])
  const config = useBrowserSessions()
  const origin = askableOrigin(url)

  useEffect(() => {
    if (open) void api.pagePermissionsList().then(setGrants)
  }, [api, open])

  if (!origin) return null
  const allowed = (p: PagePermission) => grants.some((g) => g.origin === origin && g.permission === p)
  const set = (p: PagePermission) => void (allowed(p) ? api.pagePermissionsRevoke(origin, p) : api.pagePermissionsAllow(origin, p)).then(setGrants)
  const site = siteOf(new URL(origin).hostname)
  const own = siteBlockLevelOf(config, site)
  const block = (level: BlockLevel | undefined) =>
    config && void api.browserSessionsSet(withSiteBlocking(config, site, level)).then((saved) => (setBrowserSessions(saved), onBlocking?.()))

  return (
    <span className="site-settings">
      <IconButton icon="sliders" title="Site settings: camera, microphone, screen sharing and blocking for this site" onClick={() => setOpen((o) => !o)} />
      {open && (
        <>
          <div className="site-backdrop" onClick={() => setOpen(false)} />
          <div className="site-popover" role="dialog" aria-label="Site settings">
            <strong>{new URL(origin).host}</strong>
            <ul>
              {ALL.map((p) => (
                <li key={p}>
                  <span>{NAME[p]}</span>
                  <span className={'chip small' + (allowed(p) ? ' on' : '')}>{allowed(p) ? 'allowed' : 'asks'}</span>
                  <button title={allowed(p) ? `Stop letting this site use ${PERMISSION_LABEL[p]} without asking` : `Let this site use ${PERMISSION_LABEL[p]} without asking`} onClick={() => set(p)}>
                    {allowed(p) ? 'Ask again' : 'Allow'}
                  </button>
                </li>
              ))}
            </ul>
            <small className="hint">A site that is not allowed asks the first time it needs it. Other things (location, notifications) are always refused.</small>
            {config && (
              <label className="site-blocking">
                <span>Trackers and ads on {site}</span>
                <select value={own ?? ''} onChange={(e) => block((e.target.value || undefined) as BlockLevel | undefined)}>
                  <option value="">Like all pages ({LEVEL[blockLevelOf(config)].toLowerCase()})</option>
                  {(Object.keys(LEVEL) as BlockLevel[]).map((l) => (
                    <option key={l} value={l}>
                      {LEVEL[l]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </>
      )}
    </span>
  )
}

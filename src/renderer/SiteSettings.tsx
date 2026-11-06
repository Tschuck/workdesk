import { useEffect, useState } from 'react'
import { askableOrigin, PERMISSION_LABEL, type Grant, type PagePermission } from '../main/domain/page-origin'
import { IconButton } from './Icons'

const ALL: PagePermission[] = ['camera', 'microphone', 'screen']
const NAME: Record<PagePermission, string> = { camera: 'Camera', microphone: 'Microphone', screen: 'Screen sharing' }

/** What the open page may use, set from its address bar: the camera, the microphone and screen sharing, per site. */
export function SiteSettings({ url }: { url: string }) {
  const api = window.workdesk
  const [open, setOpen] = useState(false)
  const [grants, setGrants] = useState<Grant[]>([])
  const origin = askableOrigin(url)

  useEffect(() => {
    if (open) void api.pagePermissionsList().then(setGrants)
  }, [api, open])

  if (!origin) return null
  const allowed = (p: PagePermission) => grants.some((g) => g.origin === origin && g.permission === p)
  const set = (p: PagePermission) => void (allowed(p) ? api.pagePermissionsRevoke(origin, p) : api.pagePermissionsAllow(origin, p)).then(setGrants)

  return (
    <span className="site-settings">
      <IconButton icon="sliders" title="Site settings: camera, microphone and screen sharing for this site" onClick={() => setOpen((o) => !o)} />
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
          </div>
        </>
      )}
    </span>
  )
}

import { useEffect, useRef, useState } from 'react'
import { cssColor, type ProfilesConfig } from '../main/domain/profiles'
import './profiles.css'

interface Props {
  config: ProfilesConfig
  /** open Signals per Profile (from all WorkDesks, not only the ones in view) */
  signals: Record<string, number>
  onPick: (view: string) => void
}

/** The Profile in view, above the WORKDESK title: a colour dot and the name. There is always exactly one in view. */
export function ProfileSelector({ config, signals, onPick }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const current = config.profiles.find((p) => p.id === config.active)
  // Signals of the Profiles that are not in view; while all are in view nothing is hidden
  const elsewhere = config.profiles.filter((p) => p.id !== config.active).reduce((n, p) => n + (signals[p.id] ?? 0), 0)

  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', key)
    return () => (window.removeEventListener('mousedown', off), window.removeEventListener('keydown', key))
  }, [open])

  const pick = (view: string) => (setOpen(false), view !== config.active && onPick(view))

  return (
    <div className="profile-selector" ref={root} style={{ '--profile-color': current ? cssColor(current.color) : 'var(--yellow)' } as React.CSSProperties}>
      <button className="profile-current" aria-haspopup="listbox" aria-expanded={open} title="Profile in view: what the sidebar, Dashboard, Work items, palette and search show" onClick={() => setOpen((o) => !o)}>
        <span className="profile-dot" style={{ background: current ? cssColor(current.color) : 'transparent' }} data-all={!current} />
        <span className="profile-name">{current?.name ?? 'Default'}</span>
        {elsewhere > 0 && <span className="chip small profile-badge" title={`${elsewhere} open Signal${elsewhere === 1 ? '' : 's'} in other Profiles`}>{elsewhere}</span>}
        <span className="profile-chevron" aria-hidden>▾</span>
      </button>
      {open && (
        <ul className="profile-menu" role="listbox">
          {config.profiles.map((p) => (
            <li key={p.id} role="option" aria-selected={p.id === config.active} className={p.id === config.active ? 'active' : ''} onClick={() => pick(p.id)}>
              <span className="profile-dot" style={{ background: cssColor(p.color) }} />
              <span className="profile-name">{p.name}</span>
              {p.id !== config.active && (signals[p.id] ?? 0) > 0 && <span className="chip small profile-badge">{signals[p.id]}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import { useEffect } from 'react'

export interface MenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
  /** why it does nothing, shown as the tooltip of a disabled entry */
  why?: string
}

/** A menu where the mouse was right-clicked. Closes on a click anywhere else, Escape or scrolling (a page that takes the focus while loading must not close it). */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    window.addEventListener('wheel', close, { passive: true })
    return () => {
        window.removeEventListener('keydown', key)
      window.removeEventListener('wheel', close)
    }
  }, [onClose])
  // keep it inside the window
  const left = Math.min(x, window.innerWidth - 230)
  const top = Math.min(y, window.innerHeight - 12 - items.length * 30)
  return (
    <>
      <div className="menu-backdrop" onMouseDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <ul className="context-menu" style={{ left, top }} role="menu">
        {items.map((i) => (
          <li key={i.label} role="menuitem" aria-disabled={i.disabled} className={i.disabled ? 'disabled' : ''} title={i.disabled ? i.why : undefined} onClick={() => !i.disabled && (onClose(), i.onClick())}>
            {i.label}
          </li>
        ))}
      </ul>
    </>
  )
}

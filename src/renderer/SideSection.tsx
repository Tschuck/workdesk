import type { ReactNode } from 'react'

/** A part of the bottom of the left panel: a title (a link when it goes somewhere), a chevron on the right to fold it. */
export function SideSection({ title, open, onToggle, onTitle, titleHint, extra, className, children }: {
  title: string
  open: boolean
  onToggle: (open: boolean) => void
  onTitle?: () => void
  titleHint?: string
  extra?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={`side-section ${className ?? ''}${open ? ' open' : ''}`}>
      {/* the whole line folds the section; the title (when it is a link) and the extra buttons do their own thing */}
      <div className="side-head" onClick={() => onToggle(!open)}>
        {onTitle ? <button className="side-title link" title={titleHint} onClick={(e) => (e.stopPropagation(), onTitle())}>{title}</button> : <span className="side-title">{title}</span>}
        {open && extra && <span className="side-extra" onClick={(e) => e.stopPropagation()}>{extra}</span>}
        <button className="side-chevron" aria-expanded={open} title={open ? `Hide ${title.toLowerCase()}` : `Show ${title.toLowerCase()}`} />
      </div>
      {open && children}
    </div>
  )
}

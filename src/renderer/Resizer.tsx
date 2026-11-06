import { useState, type ReactNode } from 'react'

/** The sizes the user dragged panels to, kept per machine; applied as CSS variables from the start. */
export const PANEL_SIZES = {
  nav: { cssVar: '--nav-width', key: 'workdesk.navWidth' },
  tabs: { cssVar: '--tabs-width', key: 'workdesk.tabsWidth' },
  files: { cssVar: '--files-width', key: 'workdesk.filesWidth' }
} as const

function applySaved(): void {
  for (const { cssVar, key } of Object.values(PANEL_SIZES)) {
    try {
      const px = Number(localStorage.getItem(key))
      if (px > 0) document.documentElement.style.setProperty(cssVar, `${px}px`)
    } catch {
      // the default size stays
    }
  }
}
applySaved()

interface Props {
  size: (typeof PANEL_SIZES)[keyof typeof PANEL_SIZES]
  min: number
  max: number
  /** at which edge of the panel the handle is: dragging towards the outside makes it larger */
  edge: 'left' | 'right'
  /** the panel the handle belongs to, found from the handle */
  panel: (handle: HTMLElement) => HTMLElement | null | undefined
  className: string
  title?: string
  children?: ReactNode
}

/** A handle to drag a panel's width; a double click puts it back to its default size. */
export function Resizer({ size, min, max, edge, panel, className, title = 'Drag to change the width (double click: back to the default)' }: Props) {
  const [dragging, setDragging] = useState(false)

  const start = (down: React.MouseEvent<HTMLElement>) => {
    const target = panel(down.currentTarget)
    if (!target || down.button !== 0) return
    down.preventDefault()
    const from = down.clientX
    const width = target.getBoundingClientRect().width
    let current = width
    setDragging(true)
    const move = (e: MouseEvent) => {
      const delta = (e.clientX - from) * (edge === 'right' ? 1 : -1)
      current = Math.round(Math.min(max, Math.max(min, width + delta)))
      document.documentElement.style.setProperty(size.cssVar, `${current}px`)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDragging(false)
      try {
        localStorage.setItem(size.key, String(current))
      } catch {
        // remembering is a convenience only
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const reset = () => {
    document.documentElement.style.removeProperty(size.cssVar)
    try {
      localStorage.removeItem(size.key)
    } catch {
      // nothing was kept
    }
  }
  return (
    <>
      <div className={'resizer ' + className} role="separator" aria-orientation="vertical" title={title} onMouseDown={start} onDoubleClick={reset} />
      {/* a web page under the pointer would take the mouse events of the drag */}
      {dragging && <div className="resizer-shield" />}
    </>
  )
}

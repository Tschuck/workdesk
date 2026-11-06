/**
 * The tooltips of the app (the `title` of any element) show after half a second; the browser's own take far longer and cannot be sped up.
 * While one is hovered its `title` is taken off, so the browser shows nothing of its own, and put back when the mouse leaves.
 */
export const TOOLTIP_DELAY_MS = 500

export function installTooltips(doc: Document = document): () => void {
  let tip: HTMLDivElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let holder: { el: HTMLElement; title: string } | undefined

  const hide = () => {
    clearTimeout(timer)
    tip?.remove()
    tip = undefined
    // the title goes back, unless the app changed it meanwhile
    if (holder && !holder.el.hasAttribute('title')) holder.el.setAttribute('title', holder.title)
    holder = undefined
  }

  const show = (el: HTMLElement, text: string, x: number, y: number) => {
    tip = doc.createElement('div')
    tip.className = 'tooltip'
    tip.setAttribute('role', 'tooltip')
    tip.textContent = text
    doc.body.appendChild(tip)
    const r = tip.getBoundingClientRect()
    const win = doc.defaultView!
    // below the pointer, inside the window
    tip.style.left = `${Math.max(4, Math.min(x + 8, win.innerWidth - r.width - 4))}px`
    tip.style.top = `${y + 22 + r.height > win.innerHeight ? Math.max(4, y - r.height - 10) : y + 22}px`
    void el
  }

  const over = (e: MouseEvent) => {
    const el = (e.target as Element | null)?.closest?.('[title]') as HTMLElement | null
    if (!el || el === holder?.el) return
    hide()
    const title = el.getAttribute('title')
    if (!title?.trim()) return
    el.removeAttribute('title')
    holder = { el, title }
    const [x, y] = [e.clientX, e.clientY]
    timer = setTimeout(() => holder && show(holder.el, holder.title, x, y), TOOLTIP_DELAY_MS)
  }
  const out = (e: MouseEvent) => {
    if (holder && !holder.el.contains(e.relatedTarget as Node | null)) hide()
  }

  doc.addEventListener('mouseover', over, true)
  doc.addEventListener('mouseout', out, true)
  doc.addEventListener('mousedown', hide, true)
  doc.addEventListener('keydown', hide, true)
  doc.addEventListener('wheel', hide, { capture: true, passive: true })
  return () => {
    hide()
    doc.removeEventListener('mouseover', over, true)
    doc.removeEventListener('mouseout', out, true)
    doc.removeEventListener('mousedown', hide, true)
    doc.removeEventListener('keydown', hide, true)
    doc.removeEventListener('wheel', hide, true)
  }
}

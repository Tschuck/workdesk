import { useEffect, useRef, useState } from 'react'

export interface Findable extends HTMLElement {
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): number
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
}

/** Search in the page of a Browser Pane (Command+F): Enter goes to the next match, Shift+Enter to the previous one, Escape closes. */
export function FindBar({ view, onClose }: { view: Findable | null; onClose: () => void }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ active: number; total: number }>()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
    const el = view
    if (!el) return
    const found = (e: Event) => {
      const r = (e as Event & { result?: { activeMatchOrdinal: number; matches: number } }).result
      if (r) setResult({ active: r.activeMatchOrdinal, total: r.matches })
    }
    el.addEventListener('found-in-page', found)
    return () => {
      el.removeEventListener('found-in-page', found)
      try {
        el.stopFindInPage('clearSelection')
      } catch {
        // the page is gone already
      }
    }
  }, [view])

  const search = (value: string, next?: { forward: boolean }) => {
    if (!view) return
    if (!value) {
      view.stopFindInPage('clearSelection')
      setResult(undefined)
      return
    }
    view.findInPage(value, next ? { findNext: true, forward: next.forward } : {})
  }

  return (
    <div className="find-bar" role="search">
      <input
        ref={input}
        value={text}
        placeholder="Find in page"
        onChange={(e) => (setText(e.target.value), search(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          else if (e.key === 'Enter') search(text, { forward: !e.shiftKey })
          else return
          e.preventDefault()
        }}
      />
      <span className="hint find-count">{text && result ? (result.total === 0 ? 'No matches' : `${result.active}/${result.total}`) : ''}</span>
      <button type="button" title="Previous match (Shift+Enter)" onClick={() => search(text, { forward: false })}>↑</button>
      <button type="button" title="Next match (Enter)" onClick={() => search(text, { forward: true })}>↓</button>
      <button type="button" title="Close (Esc)" onClick={onClose}>×</button>
    </div>
  )
}

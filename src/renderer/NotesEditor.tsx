import { useOpenLink } from './OpenLink'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useMemo, useRef, useState } from 'react'

const render = (text: string): string => DOMPurify.sanitize(marked.parse(text, { async: false }) as string)

/** Markdown notes of one Todo. Autosaves shortly after typing and when leaving. */
export function NotesEditor({ todoId }: { todoId: string }) {
  const api = window.workdesk
  const openLink = useOpenLink()
  const area = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const latest = useRef({ text: '', dirty: false })
  const timer = useRef<number | undefined>(undefined)

  const flush = () => {
    window.clearTimeout(timer.current)
    if (!latest.current.dirty) return
    latest.current.dirty = false
    void api.saveNotes(todoId, latest.current.text)
  }

  useEffect(() => {
    let cancelled = false
    void api.readNotes(todoId).then((t) => {
      if (cancelled) return
      latest.current = { text: t, dirty: false }
      setText(t)
      setLoaded(true)
      area.current?.focus()
    })
    return () => {
      cancelled = true
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todoId])

  const change = (value: string) => {
    setText(value)
    latest.current = { text: value, dirty: true }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 300)
  }

  /** Wrap the selection (or insert the markers) and keep the selection inside. */
  const wrap = (before: string, after = before, placeholder = '') => {
    const el = area.current
    if (!el || previewing) return
    const { selectionStart: a, selectionEnd: b, value } = el
    const middle = value.slice(a, b) || placeholder
    change(value.slice(0, a) + before + middle + after + value.slice(b))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a + before.length, a + before.length + middle.length)
    })
  }
  const bullet = () => {
    const el = area.current
    if (!el || previewing) return
    const a = el.selectionStart
    const lineStart = el.value.lastIndexOf('\n', a - 1) + 1
    change(el.value.slice(0, lineStart) + '- ' + el.value.slice(lineStart))
  }

  const html = useMemo(() => (previewing ? render(text) : ''), [previewing, text])

  return (
    <>
      <div className="md-tools">
        <button title="Bold" onClick={() => wrap('**', '**', 'bold')}><b>B</b></button>
        <button title="Italic" onClick={() => wrap('*', '*', 'italic')}><i>I</i></button>
        <button title="List" onClick={bullet}>•</button>
        <button title="Link" onClick={() => wrap('[', '](https://)', 'text')}>Link</button>
        <button className={previewing ? 'on' : ''} onClick={() => setPreviewing(!previewing)}>Preview</button>
      </div>
      {previewing ? (
        <div
          className="md-preview"
          onClick={(e) => {
            const a = (e.target as HTMLElement).closest('a')
            if (a) {
              e.preventDefault()
              void openLink(a.href)
            }
          }}
          dangerouslySetInnerHTML={{ __html: html || '<p class="hint">Nothing yet.</p>' }}
        />
      ) : (
        <textarea
          ref={area}
          className="md-area"
          disabled={!loaded}
          value={text}
          placeholder="Links, discussion notes… (markdown)"
          onChange={(e) => change(e.target.value)}
        />
      )}
    </>
  )
}

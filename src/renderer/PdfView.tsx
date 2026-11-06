import { useEffect, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import './pdf-view.css'

GlobalWorkerOptions.workerPort = new PdfWorker()

interface Matches {
  current: number
  total: number
}

/**
 * A PDF with its own find bar (⌘F, Enter / ⇧Enter for the next / previous hit, Esc closes it) and zoom, drawn by pdf.js: the viewer of the
 * browser has no find here. `bytes` is the file as read by the main process.
 */
export function PdfView({ bytes, name }: { bytes: Uint8Array; name: string }) {
  const container = useRef<HTMLDivElement>(null)
  const viewerEl = useRef<HTMLDivElement>(null)
  const viewer = useRef<PDFViewer | undefined>(undefined)
  const bus = useRef<EventBus | undefined>(undefined)
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Matches>({ current: 0, total: 0 })
  const [notFound, setNotFound] = useState(false)
  const [page, setPage] = useState({ at: 1, of: 0 })
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!container.current || !viewerEl.current) return
    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const findController = new PDFFindController({ linkService, eventBus })
    const pdfViewer = new PDFViewer({ container: container.current, viewer: viewerEl.current, eventBus, linkService, findController })
    linkService.setViewer(pdfViewer)
    viewer.current = pdfViewer
    bus.current = eventBus
    eventBus.on('pagesinit', () => (pdfViewer.currentScaleValue = 'page-width'))
    eventBus.on('pagechanging', (e: { pageNumber: number }) => setPage((p) => ({ ...p, at: e.pageNumber })))
    eventBus.on('updatefindmatchescount', (e: { matchesCount: Matches }) => setMatches(e.matchesCount))
    eventBus.on('updatefindcontrolstate', (e: { state: number; matchesCount: Matches }) => {
      // 1 = FindState.NOT_FOUND
      setNotFound(e.state === 1)
      setMatches(e.matchesCount)
    })
    const task = getDocument({ data: bytes.slice() })
    task.promise.then(
      (d) => {
        pdfViewer.setDocument(d)
        linkService.setDocument(d)
        setPage({ at: 1, of: d.numPages })
      },
      (e: Error) => setError(e.message)
    )
    return () => {
      void task.destroy()
      pdfViewer.cleanup()
      viewer.current = undefined
      bus.current = undefined
    }
  }, [bytes])

  const find = (q: string, again = false, previous = false) =>
    bus.current?.dispatch('find', { source: window, type: again ? 'again' : '', query: q, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false })
  const zoom = (by: number) => viewer.current && (viewer.current.currentScale = Math.max(0.25, Math.min(5, viewer.current.currentScale * by)))

  return (
    <div
      className="pdf-view"
      onKeyDown={(e) => {
        if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
          e.preventDefault()
          e.stopPropagation()
          input.current?.focus()
          input.current?.select()
        }
      }}
    >
      <div className="pdf-bar">
        <input
          ref={input}
          type="search"
          placeholder="Find in the PDF (⌘F)"
          value={query}
          className={notFound ? 'not-found' : ''}
          onChange={(e) => {
            setQuery(e.target.value)
            find(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.preventDefault(), find(query, true, e.shiftKey))
            else if (e.key === 'Escape') (setQuery(''), find(''), container.current?.focus())
          }}
        />
        <button type="button" title="Previous hit (⇧Enter)" disabled={matches.total === 0} onClick={() => find(query, true, true)}>↑</button>
        <button type="button" title="Next hit (Enter)" disabled={matches.total === 0} onClick={() => find(query, true)}>↓</button>
        <span className="hint pdf-count">{query ? (matches.total > 0 ? `${matches.current} of ${matches.total}` : 'no hit') : ''}</span>
        <span className="file-spacer" />
        <span className="hint">{page.of ? `page ${page.at} / ${page.of}` : ''}</span>
        <button type="button" title="Zoom out" onClick={() => zoom(1 / 1.2)}>−</button>
        <button type="button" title="Zoom in" onClick={() => zoom(1.2)}>+</button>
        <button type="button" title="Fit the width" onClick={() => viewer.current && (viewer.current.currentScaleValue = 'page-width')}>fit</button>
      </div>
      {error && <p className="file-note">{`Cannot show ${name}: ${error}`}</p>}
      <div className="pdf-body">
        <div ref={container} className="pdf-container" tabIndex={0}>
          <div ref={viewerEl} className="pdfViewer" />
        </div>
      </div>
    </div>
  )
}

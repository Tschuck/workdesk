import { useState } from 'react'
import type { SearchEngineId } from '../main/domain/url'
import { moveSearchEngine, useSearchEngines } from './search-engine'

/** The search engines in a list to sort: the first is the default. Drag one, or use the arrows. */
export function SearchEngineList() {
  const engines = useSearchEngines()
  const [drag, setDrag] = useState<SearchEngineId>()
  const [over, setOver] = useState<number>()
  return (
    <ol className="engine-list">
      {engines.map((e, i) => (
        <li
          key={e.id}
          draggable
          className={(over === i && drag && drag !== e.id ? 'over ' : '') + (drag === e.id ? 'dragging' : '')}
          onDragStart={(ev) => (ev.dataTransfer.setData('text/plain', e.name), ev.dataTransfer.setDragImage?.(ev.currentTarget, 10, 10), setDrag(e.id))}
          onDragOver={(ev) => (drag ? (ev.preventDefault(), setOver(i)) : undefined)}
          onDrop={(ev) => {
            ev.preventDefault()
            if (drag) moveSearchEngine(drag, i)
            setDrag(undefined)
            setOver(undefined)
          }}
          onDragEnd={() => (setDrag(undefined), setOver(undefined))}
        >
          <span className="engine-grip" aria-hidden="true">⠿</span>
          <span className="engine-name">{e.name}</span>
          {i === 0 && <span className="chip small">Default</span>}
          <button type="button" className="mini" title="Move up" disabled={i === 0} onClick={() => moveSearchEngine(e.id, i - 1)}>↑</button>
          <button type="button" className="mini" title="Move down" disabled={i === engines.length - 1} onClick={() => moveSearchEngine(e.id, i + 1)}>↓</button>
        </li>
      ))}
    </ol>
  )
}

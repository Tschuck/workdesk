import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { byteSize } from './image-types'
import './image-view.css'

/**
 * An image file as a picture, on a checkerboard (transparency shows): fitted into the pane, or at its real size (a click on it switches).
 * `bytes` is the file as read by the main process; `actions` are more buttons for the bar (the source of an SVG).
 */
export function ImageView({ bytes, mime, name, actions }: { bytes: Uint8Array; mime: string; name: string; actions?: ReactNode }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })), [bytes, mime])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  const [fit, setFit] = useState(true)
  const [size, setSize] = useState<{ w: number; h: number }>()
  const [broken, setBroken] = useState(false)
  useEffect(() => (setSize(undefined), setBroken(false)), [url])
  return (
    <div className="image-view">
      <div className="image-bar">
        <span className="hint">{[size && `${size.w} × ${size.h}`, byteSize(bytes.length)].filter(Boolean).join(' · ')}</span>
        <span className="file-spacer" />
        <button type="button" className={fit ? 'on' : ''} title="Fit the picture into the pane" onClick={() => setFit(true)}>Fit</button>
        <button type="button" className={fit ? '' : 'on'} title="The picture at its real size" onClick={() => setFit(false)}>100%</button>
        {actions}
      </div>
      <div className={'image-body' + (fit ? ' fit' : '')}>
        {broken ? (
          <p className="file-note">This picture could not be drawn (the file may be damaged, or not of its kind).</p>
        ) : (
          <img
            src={url}
            alt={name}
            title={fit ? 'Click: real size' : 'Click: fit into the pane'}
            onClick={() => setFit(!fit)}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setBroken(true)}
          />
        )}
      </div>
    </div>
  )
}

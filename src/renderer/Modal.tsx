import { useEffect, type FormEvent, type ReactNode } from 'react'
import { ICONS } from './Icons'
import './modal.css'

interface ModalProps {
  title: string
  onClose: () => void
  /** the form's submit (Enter or the primary button); without it the modal only has a Close button */
  onSubmit?: () => void
  submitLabel?: string
  canSubmit?: boolean
  busy?: boolean
  error?: string
  wide?: boolean
  /** extra buttons on the left of the actions, e.g. Remove */
  extra?: ReactNode
  children: ReactNode
}

/** The one dialog for adding and editing things: a title, fields, an error, Cancel and a primary button. Escape and a click outside close it. */
export function Modal({ title, onClose, onSubmit, submitLabel = 'Add', canSubmit = true, busy, error, wide, extra, children }: ModalProps) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [busy, onClose])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (onSubmit && canSubmit && !busy) onSubmit()
  }
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className={'modal form-modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title} onSubmit={submit}>
        <h3>{title}</h3>
        <div className="form-modal-body">{children}</div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          {extra && <span className="modal-extra">{extra}</span>}
          <button type="button" onClick={onClose} disabled={busy}>{onSubmit ? 'Cancel' : 'Close'}</button>
          {onSubmit && <button type="submit" className="primary" disabled={!canSubmit || busy}>{busy ? 'Working …' : submitLabel}</button>}
        </div>
      </form>
    </div>
  )
}

/** A labelled field inside a modal. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  )
}

/** The title of a page with the + button on its right: every list is added to through this and a modal. */
export function PageHead({ title, addLabel, onAdd, disabled }: { title: string; addLabel?: string; onAdd?: () => void; disabled?: boolean }) {
  return (
    <div className="page-head">
      <h2>{title}</h2>
      {onAdd && <AddButton label={addLabel ?? `Add to ${title}`} onClick={onAdd} disabled={disabled} />}
    </div>
  )
}

/** The + button. */
export function AddButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="add-button" title={label} aria-label={label} disabled={disabled} onClick={onClick}>{ICONS.plus}</button>
  )
}

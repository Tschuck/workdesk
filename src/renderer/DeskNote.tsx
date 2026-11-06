import { useEffect, useState } from 'react'
import { deskNoteId } from '../main/domain/desk-todos'
import { NotesEditor } from './NotesEditor'
import './desk-todos.css'

/**
 * The Markdown scratch note of a WorkDesk. It opens with the WorkDesk when it has text, and is folded while empty
 * (the editor grabs the focus when it appears, so it is only built while open).
 */
export function DeskNote({ deskId }: { deskId: string }) {
  const id = deskNoteId(deskId)
  const [open, setOpen] = useState<boolean>()
  useEffect(() => {
    let cancelled = false
    void window.workdesk.readNotes(id).then((t) => !cancelled && setOpen((o) => o ?? t.trim() !== ''), () => undefined)
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <details className="panel event-fold desk-note" open={!!open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Notes</summary>
      {open && (
        <div className="desk-note-body">
          <NotesEditor key={id} todoId={id} />
        </div>
      )}
    </details>
  )
}

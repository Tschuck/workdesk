import { useState, type DragEvent } from 'react'

/**
 * Drag-to-sort for a row (or, when `vertical`, a column) of things: drag one onto another, it lands before or after it (left or right half, upper or lower half).
 * `sameGroup` says which pairs may be swapped; `onMove` does it.
 */
export function useSortable(onMove: (id: string, targetId: string, after: boolean) => void, sameGroup: (a: string, b: string) => boolean = () => true, vertical: () => boolean = () => false) {
  const [drag, setDrag] = useState<string>()
  const [over, setOver] = useState<{ id: string; after: boolean }>()
  const reset = () => (setDrag(undefined), setOver(undefined))

  /** the props that make an element draggable and a target */
  const props = (id: string) => ({
    draggable: true as const,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('application/x-workdesk-sort', id)
      setDrag(id)
    },
    onDragOver: (e: DragEvent) => {
      if (!drag || drag === id || !sameGroup(drag, id)) return
      e.preventDefault()
      const box = e.currentTarget.getBoundingClientRect()
      setOver({ id, after: vertical() ? e.clientY > box.top + box.height / 2 : e.clientX > box.left + box.width / 2 })
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      if (drag && over && drag !== id) onMove(drag, id, over.after)
      reset()
    },
    onDragEnd: reset
  })

  /** classes for the element: being dragged, or where the dragged one would land */
  const classes = (id: string): string => (drag === id ? 'dragging' : drag && over?.id === id && drag !== id ? (over.after ? 'drop-after' : 'drop-before') : '')
  return { props, classes }
}

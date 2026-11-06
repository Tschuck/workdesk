/**
 * How the rename dialog and the File panes talk without knowing each other: the dialog asks which of its files have unsaved changes in
 * some pane, and tells the panes which files were written, so that an open pane shows the new text and is not left with a stale buffer.
 */
const DIRTY_QUERY = 'workdesk:files-dirty-query'
const WRITTEN = 'workdesk:files-written'
/** Tells a File pane to open Find usages / Rename symbol for the name at its cursor (⌘P); detail is the mode. */
export const USAGES_EVENT = 'workdesk:file-usages'

export type UsagesMode = 'usages' | 'rename'

/** Which of these files (absolute paths) a File pane shows with changes that are not saved. */
export function dirtyAmong(paths: readonly string[]): Set<string> {
  const found = new Set<string>()
  window.dispatchEvent(new CustomEvent(DIRTY_QUERY, { detail: { paths: new Set(paths), found } }))
  return found
}

/** A File pane answers the question for the file it shows. */
export function onDirtyQuery(answer: (path: string) => boolean): () => void {
  const on = (e: Event) => {
    const { paths, found } = (e as CustomEvent<{ paths: Set<string>; found: Set<string> }>).detail
    for (const p of paths) if (answer(p)) found.add(p)
  }
  window.addEventListener(DIRTY_QUERY, on)
  return () => window.removeEventListener(DIRTY_QUERY, on)
}

export const announceWritten = (paths: readonly string[]): void => void window.dispatchEvent(new CustomEvent(WRITTEN, { detail: paths }))

/** A File pane hears of files that were written on disk behind its back (by a rename). */
export function onWritten(handler: (paths: readonly string[]) => void): () => void {
  const on = (e: Event) => handler((e as CustomEvent<readonly string[]>).detail)
  window.addEventListener(WRITTEN, on)
  return () => window.removeEventListener(WRITTEN, on)
}

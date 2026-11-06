// What a File pane remembers across restarts: the file's cursor and scroll, and the text of unsaved changes.
// Kept per pane in localStorage (a convenience: if it is not there, the pane opens as before).

export interface SavedEditor {
  path: string
  line: number
  column: number
  scrollTop: number
  /** unsaved changes: the text, and a hash of the file's text on disk it was made from (the buffer is dropped when the file changed since) */
  buffer?: { text: string; base: number }
  /** when it was written (ms), to forget panes that are long gone */
  at: number
}

export const STATE_PREFIX = 'workdesk.fileState.'
export const MAX_BUFFER = 1_000_000
export const MAX_AGE_MS = 30 * 24 * 3600 * 1000

/** FNV-1a, 32 bit: enough to tell whether a file changed under an unsaved buffer */
export function hashText(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function parseState(json: string | null): SavedEditor | undefined {
  if (!json) return undefined
  try {
    const d = JSON.parse(json) as Partial<SavedEditor>
    if (typeof d.path !== 'string' || !Number.isInteger(d.line) || !Number.isInteger(d.column) || typeof d.scrollTop !== 'number') return undefined
    const b = d.buffer
    const buffer = b && typeof b.text === 'string' && typeof b.base === 'number' ? { text: b.text, base: b.base } : undefined
    return { path: d.path, line: d.line!, column: d.column!, scrollTop: d.scrollTop, buffer, at: typeof d.at === 'number' ? d.at : 0 }
  } catch {
    return undefined
  }
}

/** The state to write, with the buffer only when there are unsaved changes and they are not too large. */
export function makeState(path: string, cursor: { line: number; column: number }, scrollTop: number, unsaved: { text: string; diskText: string } | undefined, now = Date.now()): SavedEditor {
  const buffer = unsaved && unsaved.text.length <= MAX_BUFFER && unsaved.text !== unsaved.diskText ? { text: unsaved.text, base: hashText(unsaved.diskText) } : undefined
  return { path, line: cursor.line, column: cursor.column, scrollTop, buffer, at: now }
}

/** What to put back when `path` is opened with `diskText`: nothing for another file; the unsaved text only if the file is as it was. */
export function restorable(state: SavedEditor | undefined, path: string, diskText: string): { text?: string; line: number; column: number; scrollTop: number } | undefined {
  if (!state || state.path !== path) return undefined
  const fresh = state.buffer && state.buffer.base === hashText(diskText) && state.buffer.text !== diskText
  return { text: fresh ? state.buffer!.text : undefined, line: state.line, column: state.column, scrollTop: state.scrollTop }
}

export const isStale = (state: SavedEditor, now = Date.now()): boolean => now - state.at > MAX_AGE_MS

export function loadEditorState(paneId: string): SavedEditor | undefined {
  try {
    return parseState(localStorage.getItem(STATE_PREFIX + paneId))
  } catch {
    return undefined
  }
}

export function saveEditorState(paneId: string, state: SavedEditor): void {
  try {
    localStorage.setItem(STATE_PREFIX + paneId, JSON.stringify(state))
  } catch {
    // full or blocked: not remembering is fine
  }
}

/** Forgets what long-gone panes left behind; once at start. */
export function pruneEditorStates(now = Date.now()): void {
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(STATE_PREFIX)) continue
      const s = parseState(localStorage.getItem(k))
      if (!s || isStale(s, now)) localStorage.removeItem(k)
    }
  } catch {
    // nothing to prune
  }
}

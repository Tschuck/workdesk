import { findPane, type DeskLayout } from './layout'

/** What to look for in the output of terminals. */
export interface TextQuery {
  text: string
  regex?: boolean
  caseSensitive?: boolean
}

export interface LineHit {
  /** 1-based line of the captured output */
  line: number
  text: string
}

/** The lines of a terminal's output that match; a bad regular expression matches nothing. Lines are cut to 300 characters. */
export function matchLines(output: string, q: TextQuery, max = 20): LineHit[] {
  if (!q.text) return []
  let test: (s: string) => boolean
  if (q.regex) {
    try {
      const re = new RegExp(q.text, q.caseSensitive ? '' : 'i')
      test = (s) => re.test(s)
    } catch {
      return []
    }
  } else {
    const needle = q.caseSensitive ? q.text : q.text.toLowerCase()
    test = (s) => (q.caseSensitive ? s : s.toLowerCase()).includes(needle)
  }
  const hits: LineHit[] = []
  const lines = output.split('\n')
  for (let i = 0; i < lines.length && hits.length < max; i++) {
    const text = lines[i].replace(/\s+$/, '')
    if (text && test(text)) hits.push({ line: i + 1, text: text.length > 300 ? text.slice(0, 300) + '…' : text })
  }
  return hits
}

/** The Tab that holds a Pane. */
export function tabOfPane(layout: DeskLayout, paneId: string): { tabId: string; name: string } | undefined {
  for (const t of layout.tabs) if (t.kind === 'panes' && findPane(t.layout, paneId)) return { tabId: t.id, name: t.name }
  return undefined
}

/** A hit anywhere in the workspace (text in a file, or a line of a terminal's output). */
export interface WorkspaceHit {
  kind: 'text' | 'terminal'
  deskId: string
  deskName: string
  /** text: the file (relative to its root) */
  path?: string
  rootPath?: string
  rootLabel?: string
  /** terminal: the Pane and its Tab */
  paneId?: string
  tabId?: string
  tabName?: string
  line: number
  text: string
}

/** Files of one WorkDesk, for opening a file of any WorkDesk from the palette. */
export interface DeskFiles {
  deskId: string
  deskName: string
  roots: { label: string; path: string; files: string[] }[]
}

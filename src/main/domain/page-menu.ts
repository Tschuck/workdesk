/** What the right-click menu of a web page in a browser Pane offers; the main process turns the ids into actions. */
export type PageMenuId =
  | 'back'
  | 'forward'
  | 'reload'
  | 'open-link'
  | 'copy-link'
  | 'copy-selection'
  | 'cut'
  | 'paste'
  | 'copy-markdown'
  | 'attach-desk'
  | 'attach-todo'
  | 'inspect'

export type PageMenuEntry = { id: PageMenuId; label: string; enabled?: boolean } | { separator: true }

export interface PageMenuContext {
  pageUrl: string
  linkUrl?: string
  selectionText?: string
  isEditable?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
  /** the Pane is in a running WorkDesk, so pages can be attached; `deskName` is shown in the entry */
  deskName?: string
  /** the link can be opened as a Tab of the WorkDesk (the Pane has somewhere to open it) */
  canOpenTab?: boolean
}

const isWeb = (url: string | undefined): boolean => !!url && /^https?:\/\//i.test(url)

export function pageMenu(c: PageMenuContext): PageMenuEntry[] {
  const out: PageMenuEntry[] = []
  const group = (entries: PageMenuEntry[]): void => {
    if (entries.length === 0) return
    if (out.length > 0) out.push({ separator: true })
    out.push(...entries)
  }
  group([
    { id: 'back', label: 'Back', enabled: !!c.canGoBack },
    { id: 'forward', label: 'Forward', enabled: !!c.canGoForward },
    { id: 'reload', label: 'Reload' }
  ])
  if (isWeb(c.linkUrl)) group([...(c.canOpenTab ? [{ id: 'open-link' as const, label: 'Open link in new tab' }] : []), { id: 'copy-link', label: 'Copy link address' }])
  const edit: PageMenuEntry[] = []
  if (c.isEditable) edit.push({ id: 'cut', label: 'Cut', enabled: !!c.selectionText })
  if (c.selectionText) edit.push({ id: 'copy-selection', label: 'Copy' })
  if (c.isEditable) edit.push({ id: 'paste', label: 'Paste' })
  group(edit)
  if (isWeb(c.pageUrl)) {
    group([
      { id: 'copy-markdown', label: 'Copy URL as Markdown link' },
      ...(c.deskName !== undefined ? [{ id: 'attach-desk' as const, label: `Attach to ${c.deskName}` }, { id: 'attach-todo' as const, label: 'Attach to a Todo…' }] : [])
    ])
  }
  group([{ id: 'inspect', label: 'Inspect' }])
  return out
}

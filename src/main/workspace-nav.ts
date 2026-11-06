import { matchLines, tabOfPane, type DeskFiles, type TextQuery, type WorkspaceHit } from './domain/search-all'
import type { DeskLayout } from './domain/layout'
import type { FileRoot, FilesService, SearchHit, SearchQuery } from './files'
import type { TmuxAdmin } from './terminal/tmux-admin'
import { parsePaneCwds, samePaneCwds, type PaneCwds } from './domain/follow-cd'
import { sessionName } from './terminal/manager'

/** The WorkDesk parts the navigation looks at. */
export interface NavDesk {
  id: string
  name: string
  presence: string
}

export const MAX_TEXT_HITS = 300
export const MAX_TERMINAL_HITS = 100
/** the roots shared by every WorkDesk: not part of a desk's own files */
const SHARED_LABELS = new Set(['knowledge', 'todo notes', 'global scratch'])

/** Workspace-wide navigation in main: the files, the text and the terminal output of every started WorkDesk, and where each terminal is. */
export class WorkspaceNav {
  private cwds: PaneCwds = {}

  constructor(
    private readonly deps: {
      desks: () => NavDesk[]
      files: Pick<FilesService, 'roots' | 'list' | 'search'>
      layout: (deskId: string) => Promise<DeskLayout>
      tmux: Pick<TmuxAdmin, 'allPaneCwds' | 'capture' | 'panes'>
    }
  ) {}

  /** WorkDesks that have folders to look in (parked and planned ones have nothing running, and their Tabs are not on screen) */
  private started(): NavDesk[] {
    return this.deps.desks().filter((d) => d.presence !== 'parked' && d.presence !== 'planned')
  }

  private ownRoots(deskId: string): FileRoot[] {
    return this.deps.files.roots(deskId).filter((r) => !SHARED_LABELS.has(r.label))
  }

  /** The files of every started WorkDesk, by root (relative paths). */
  async files(): Promise<DeskFiles[]> {
    return Promise.all(
      this.started().map(async (d) => ({
        deskId: d.id,
        deskName: d.name,
        roots: await Promise.all(this.ownRoots(d.id).map(async (r) => ({ label: r.label, path: r.path, files: await this.deps.files.list(d.id, r.path).catch(() => [] as string[]) })))
      }))
    )
  }

  /** Text in the files of every started WorkDesk (git grep in its branch folders). */
  async grep(q: SearchQuery): Promise<WorkspaceHit[]> {
    if (!q.text.trim()) return []
    const hits: WorkspaceHit[] = []
    await Promise.all(
      this.started().map(async (d) => {
        for (const r of this.ownRoots(d.id)) {
          const found: SearchHit[] = await this.deps.files.search(d.id, r.path, q).catch(() => [])
          for (const h of found) hits.push({ kind: 'text', deskId: d.id, deskName: d.name, rootPath: r.path, rootLabel: r.label, path: h.path, line: h.line, text: h.text })
        }
      })
    )
    return hits.slice(0, MAX_TEXT_HITS)
  }

  /** Lines of the output (with scrollback) of every terminal of a started WorkDesk. */
  async terminals(q: TextQuery): Promise<WorkspaceHit[]> {
    if (!q.text) return []
    const names = new Map(this.started().map((d) => [d.id, d.name]))
    const panes = (await this.deps.tmux.panes()).filter((p) => p.session.startsWith('workdesk-') && !p.session.startsWith('workdesk-view-'))
    const layouts = new Map<string, DeskLayout | undefined>()
    const hits: WorkspaceHit[] = []
    for (const p of panes) {
      const deskId = p.session.slice('workdesk-'.length)
      const deskName = names.get(deskId)
      if (deskName === undefined || sessionName(deskId) !== p.session) continue
      const lines = matchLines(await this.deps.tmux.capture(p.session, p.window), q, 10)
      if (lines.length === 0) continue
      if (!layouts.has(deskId)) layouts.set(deskId, await this.deps.layout(deskId).catch(() => undefined))
      const layout = layouts.get(deskId)
      const tab = layout && tabOfPane(layout, p.window)
      if (!tab) continue
      for (const l of lines) hits.push({ kind: 'terminal', deskId, deskName, paneId: p.window, tabId: tab.tabId, tabName: tab.name, line: l.line, text: l.text })
      if (hits.length >= MAX_TERMINAL_HITS) break
    }
    return hits.slice(0, MAX_TERMINAL_HITS)
  }

  /** The folder of every terminal now; `changed` is true when it differs from the last time. */
  async pollCwds(): Promise<{ cwds: PaneCwds; changed: boolean }> {
    const next = parsePaneCwds(await this.deps.tmux.allPaneCwds())
    const changed = !samePaneCwds(this.cwds, next)
    this.cwds = next
    return { cwds: next, changed }
  }

  currentCwds(): PaneCwds {
    return this.cwds
  }
}

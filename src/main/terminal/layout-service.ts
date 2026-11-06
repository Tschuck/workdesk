import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as layoutOps from '../domain/layout'
import type { DeskLayout, PaneTab, SplitDirection } from '../domain/layout'
import type { DeskTemplate } from '../domain/templates'
import { layoutFromTabs } from '../domain/user-templates'
import { deskDir } from '../projects/layout'
import type { TerminalManager } from './manager'

export const deskStateFile = (root: string, deskId: string): string => join(deskDir(root, deskId), '.workdesk', 'state.json')

interface DeskState {
  layout: DeskLayout
}

/** Tabs and Panes of every WorkDesk, persisted in `<desk>/.workdesk/state.json`. */
export class LayoutService {
  private readonly cache = new Map<string, DeskLayout>()
  /** the pinned Tabs per WorkDesk as last saved, to tell when they changed */
  private readonly pinsSeen = new Map<string, string>()
  /** told when the pinned Tabs of any WorkDesk changed (the left panel lists them) */
  onPinsChanged: () => void = () => undefined
  /** what was closed last in each WorkDesk, newest last (kept while the app runs) */
  private readonly closed = new Map<string, layoutOps.ClosedItem[]>()

  private remember(deskId: string, item: layoutOps.ClosedItem): void {
    this.closed.set(deskId, [...(this.closed.get(deskId) ?? []), item].slice(-20))
  }

  constructor(
    private readonly root: string,
    private readonly terminals: TerminalManager
  ) {}

  async get(deskId: string): Promise<DeskLayout> {
    const cached = this.cache.get(deskId)
    if (cached) return cached
    let layout: DeskLayout
    try {
      layout = (JSON.parse(await readFile(deskStateFile(this.root, deskId), 'utf8')) as DeskState).layout
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      layout = layoutOps.defaultLayout(randomUUID(), randomUUID(), deskDir(this.root, deskId), randomUUID())
      await this.save(deskId, layout)
    }
    const complete = layoutOps.withFixedTabs(layoutOps.withoutEditorTabs(layout), randomUUID())
    if (complete !== layout) await this.save(deskId, complete)
    this.cache.set(deskId, complete)
    return complete
  }

  /**
   * Give a new WorkDesk the Panes of a template. A template made from a WorkDesk replaces the Tabs (nothing runs yet);
   * a built-in one splits the first Pane. Meant for a WorkDesk that has just been made.
   */
  async applyTemplate(deskId: string, template: DeskTemplate): Promise<void> {
    const layout = await this.get(deskId)
    if (template.tabs && template.tabs.length > 0) {
      await this.save(deskId, layoutFromTabs(template.tabs, randomUUID, deskDir(this.root, deskId), layout.tabs.find((t) => t.kind === 'details')?.id ?? randomUUID()))
      return
    }
    const tab = layout.tabs.find((t) => t.kind === 'panes')
    const first = tab?.kind === 'panes' ? layoutOps.paneIds(tab.layout)[0] : undefined
    if (tab && first) for (const kind of template.panes.slice(1)) await this.splitPane(deskId, tab.id, first, 'horizontal', kind)
  }

  async tabOfPane(deskId: string, paneId: string): Promise<string | undefined> {
    const layout = await this.get(deskId)
    return layout.tabs.find((t) => t.kind === 'panes' && layoutOps.findPane(t.layout, paneId))?.id
  }

  async splitPane(deskId: string, tabId: string, paneId: string, direction: SplitDirection, kind: 'terminal' | 'browser' | 'file' = 'terminal', before = false, url?: string): Promise<DeskLayout> {
    const layout = await this.get(deskId)
    const pane = layoutOps.findPane(this.paneTab(layout, tabId).layout, paneId)
    if (!pane) throw new Error(`Unknown Pane ${paneId}`)
    const cwd = pane.kind === 'terminal' ? (pane.cwd ?? deskDir(this.root, deskId)) : deskDir(this.root, deskId)
    const added = kind === 'browser' ? layoutOps.newBrowserPane(randomUUID(), url) : kind === 'file' ? layoutOps.newFilePane(randomUUID(), url) : layoutOps.newTerminalPane(randomUUID(), cwd)
    return this.save(deskId, this.mapTab(layout, tabId, (t) => ({ ...t, layout: layoutOps.splitPane(t.layout, paneId, direction, added, before) })))
  }

  async closePane(deskId: string, tabId: string, paneId: string): Promise<DeskLayout> {
    const layout = await this.get(deskId)
    const tab = this.paneTab(layout, tabId)
    const rest = layoutOps.removePane(tab.layout, paneId)
    if (!rest && tab.pinned) throw new Error(`Unpin the Tab "${tab.name}" to close it`)
    const gone = layoutOps.findPane(tab.layout, paneId)
    if (gone) {
      if (rest) this.remember(deskId, { kind: 'pane', tabId, pane: gone, beside: layoutOps.paneIds(rest)[0] })
      else if (layout.tabs.filter((t) => t.kind === 'panes').length > 1) this.remember(deskId, { kind: 'tab', tab })
    }
    if (layoutOps.findPane(tab.layout, paneId)?.kind === 'terminal') await this.terminals.close(deskId, paneId)
    if (!rest) return this.save(deskId, layout.tabs.filter((t) => t.kind === 'panes').length === 1 ? this.resetTab(layout, tabId, deskId) : layoutOps.closeTab(layout, tabId))
    return this.save(deskId, this.mapTab(layout, tabId, (t) => ({ ...t, layout: rest })))
  }

  /** Which of these WorkDesks has the page open in a Tab: the Tab to go to. */
  async findPage(deskIds: readonly string[], url: string): Promise<{ deskId: string; tabId: string } | undefined> {
    for (const deskId of deskIds) {
      const found = layoutOps.findBrowserPage(await this.get(deskId), url)
      if (found) return { deskId, tabId: found.tabId }
    }
    return undefined
  }

  /** a Review WorkDesk's first tabs: the pull request, the Review Tab, then the rest */
  async arrangeReviewStart(deskId: string, prUrls: string[]): Promise<DeskLayout> {
    return this.save(deskId, layoutOps.arrangeReviewStart(await this.get(deskId), prUrls, randomUUID()))
  }

  /** the Review Tab: made when there is none, then brought to the front (`activate`) */
  async openReviewTab(deskId: string, activate = true): Promise<DeskLayout> {
    return this.save(deskId, layoutOps.openReviewTab(await this.get(deskId), randomUUID(), activate))
  }

  /** `cwd` is where a new terminal starts (a branch folder), instead of the folder of the WorkDesk */
  async addTab(deskId: string, kind: 'terminal' | 'browser' | 'file' = 'terminal', url?: string, cwd?: string): Promise<DeskLayout> {
    const layout = await this.get(deskId)
    if (kind === 'browser' && url) {
      // the same page again: go to the Tab that shows it
      const open = layout.tabs.find((t) => t.kind === 'panes' && t.layout.type === 'pane' && t.layout.kind === 'browser' && t.layout.url === url)
      if (open) return this.save(deskId, layoutOps.setActiveTab(layout, open.id))
    }
    if (kind === 'file' && url) {
      // the same file again: go to the Tab that shows it
      const open = layout.tabs.find((t) => t.kind === 'panes' && layoutOps.singleFilePath(t) === url)
      if (open) return this.save(deskId, layoutOps.setActiveTab(layout, open.id))
    }
    const same = layout.tabs.filter((t) => t.kind === 'panes' && (kind === 'browser') === (t.layout.type === 'pane' && t.layout.kind === 'browser')).length
    const pane = kind === 'browser' ? layoutOps.newBrowserPane(randomUUID(), url) : kind === 'file' ? layoutOps.newFilePane(randomUUID(), url) : layoutOps.newTerminalPane(randomUUID(), cwd ?? deskDir(this.root, deskId))
    const tab = {
      kind: 'panes' as const,
      id: randomUUID(),
      name: kind === 'file' && url ? (url.split('/').pop() ?? 'File') : `${kind === 'browser' ? 'Browser' : kind === 'file' ? 'File' : 'Terminal'} ${same + 1}`,
      layout: pane,
      ...(kind === 'browser' || kind === 'file' ? { autoName: true } : {})
    }
    return this.save(deskId, layoutOps.addTab(layout, tab))
  }

  /**
   * A Terminal Tab in a Branch's folder that types the commands in, so they run where you can see them.
   * The commands are chained: the first one that fails stops the rest, and the shell stays open.
   */
  async addSetupTab(deskId: string, cwd: string, name: string, commands: readonly string[]): Promise<DeskLayout> {
    const layout = await this.get(deskId)
    const pane = layoutOps.newTerminalPane(randomUUID(), cwd)
    this.terminals.queueInput(pane.id, commands.join(' && ') + '\r')
    return this.save(deskId, layoutOps.addTab(layout, { kind: 'panes', id: randomUUID(), name, layout: pane }))
  }

  /** A Terminal Tab for a Claude that was started for you: it is added, but the Tab you are looking at stays. */
  async addWorkerTab(deskId: string, cwd: string, name: string): Promise<{ tabId: string; paneId: string }> {
    const layout = await this.get(deskId)
    const pane = layoutOps.newTerminalPane(randomUUID(), cwd)
    const tabId = randomUUID()
    const next = layoutOps.addTab(layout, { kind: 'panes', id: tabId, name, layout: pane })
    await this.save(deskId, { ...next, activeTabId: layout.activeTabId })
    return { tabId, paneId: pane.id }
  }

  /** Several pages at once, one Tab each (a page that is open already is reused); the first one is shown. One after the other, so none is lost. */
  async addBrowserTabs(deskId: string, urls: readonly string[]): Promise<DeskLayout> {
    const wanted = [...new Set(urls)]
    let layout = await this.get(deskId)
    for (const url of wanted) layout = await this.addTab(deskId, 'browser', url)
    const first = wanted[0] && layout.tabs.find((t) => t.kind === 'panes' && t.layout.type === 'pane' && t.layout.kind === 'browser' && t.layout.url === wanted[0])
    return first ? this.save(deskId, layoutOps.setActiveTab(layout, first.id)) : layout
  }

  /** A File Pane shows another file: remembered, and a Tab with only that Pane is named after the file. */
  async setFileLocation(deskId: string, tabId: string, paneId: string, path: string | undefined, line?: number): Promise<DeskLayout> {
    const layout = await this.get(deskId)
    return this.save(
      deskId,
      this.mapTab(layout, tabId, (t) => {
        const next = { ...t, layout: layoutOps.setFileLocation(t.layout, paneId, path, line) }
        const single = layoutOps.singleFilePath(next)
        return t.layout.type === 'pane' && t.layout.kind === 'file' && t.autoName ? { ...next, name: single ? (single.split('/').pop() ?? 'File') : t.name } : next
      })
    )
  }

  async setBrowserLocation(deskId: string, tabId: string, paneId: string, url: string, title?: string, favicon?: string): Promise<DeskLayout> {
    const layout = await this.get(deskId)
    return this.save(
      deskId,
      this.mapTab(layout, tabId, (t) => {
        const next = { ...t, layout: layoutOps.setBrowserLocation(t.layout, paneId, url, title, layoutOps.isIconUrl(favicon) ? favicon : undefined) }
        return next.autoName ? { ...next, name: layoutOps.tabNameFromTitle(layoutOps.singleBrowserTitle(next), t.name) } : next
      })
    )
  }

  /** Renaming ends automatic naming; an empty name on a Browser Tab turns it back on. */
  async renameTab(deskId: string, tabId: string, name: string): Promise<DeskLayout> {
    const layout = await this.get(deskId)
    const tab = layout.tabs.find((t) => t.id === tabId)
    if (name.trim() === '' && tab?.kind === 'panes' && tab.layout.type === 'pane' && tab.layout.kind === 'browser') {
      return this.save(deskId, this.mapTab(layout, tabId, (t) => ({ ...t, autoName: true, name: layoutOps.tabNameFromTitle(layoutOps.singleBrowserTitle(t), 'Browser') })))
    }
    return this.save(deskId, layoutOps.renameTab(layout, tabId, name))
  }

  /** Put a Tab before or after another one (see `moveTab`). */
  /** Drag a Pane to another Tab or to a new one; the terminal keeps running (same id). */
  async duplicateTab(deskId: string, tabId: string): Promise<DeskLayout> {
    return this.save(deskId, layoutOps.duplicateTab(await this.get(deskId), tabId, randomUUID(), randomUUID))
  }

  async movePaneBeside(deskId: string, fromTabId: string, paneId: string, toTabId: string, targetPaneId: string, direction: layoutOps.SplitDirection, before: boolean): Promise<DeskLayout> {
    return this.save(deskId, layoutOps.movePaneBeside(await this.get(deskId), fromTabId, paneId, toTabId, targetPaneId, direction, before))
  }

  async mergeTab(deskId: string, fromTabId: string, toTabId: string, paneId: string, direction: layoutOps.SplitDirection, before: boolean): Promise<DeskLayout> {
    return this.save(deskId, layoutOps.mergeTab(await this.get(deskId), fromTabId, toTabId, paneId, direction, before))
  }

  async movePane(deskId: string, tabId: string, paneId: string, toTabId?: string): Promise<DeskLayout> {
    return this.save(deskId, layoutOps.movePane(await this.get(deskId), tabId, paneId, toTabId, randomUUID()))
  }

  async moveTab(deskId: string, tabId: string, targetId: string, after: boolean, keepGroup = false): Promise<DeskLayout> {
    return this.save(deskId, layoutOps.moveTab(await this.get(deskId), tabId, targetId, after, keepGroup))
  }

  async setActiveTab(deskId: string, tabId: string): Promise<DeskLayout> {
    return this.save(deskId, layoutOps.setActiveTab(await this.get(deskId), tabId))
  }

  /** Unload the pages of a Tab to free memory, or load them again. */
  async setTabHibernated(deskId: string, tabId: string, on: boolean, auto = false): Promise<DeskLayout> {
    return this.save(deskId, layoutOps.setTabHibernated(await this.get(deskId), tabId, on, auto))
  }

  async closeTab(deskId: string, tabId: string): Promise<DeskLayout> {
    const layout = await this.get(deskId)
    const next = layoutOps.closeTab(layout, tabId)
    const closing = layout.tabs.find((t) => t.id === tabId)
    if (closing?.kind === 'panes') this.remember(deskId, { kind: 'tab', tab: closing })
    for (const paneId of layoutOps.tabPaneIds(layout, tabId)) await this.terminals.close(deskId, paneId)
    return this.save(deskId, next)
  }

  private tab(layout: DeskLayout, tabId: string) {
    const tab = layout.tabs.find((t) => t.id === tabId)
    if (!tab) throw new Error(`Unknown Tab ${tabId}`)
    return tab
  }

  private paneTab(layout: DeskLayout, tabId: string): PaneTab {
    const tab = layoutOps.paneTab(layout, tabId)
    if (!tab) throw new Error(`Tab ${tabId} has no Panes`)
    return tab
  }

  private mapTab(layout: DeskLayout, tabId: string, fn: (t: PaneTab) => PaneTab): DeskLayout {
    this.paneTab(layout, tabId)
    return { ...layout, tabs: layout.tabs.map((t) => (t.id === tabId && t.kind === 'panes' ? fn(t) : t)) }
  }

  /** Closing the last Pane of the last Tab leaves a fresh Terminal behind. */
  private resetTab(layout: DeskLayout, tabId: string, deskId: string): DeskLayout {
    return this.mapTab(layout, tabId, (t) => ({ ...t, layout: layoutOps.newTerminalPane(randomUUID(), deskDir(this.root, deskId)) }))
  }

  private async save(deskId: string, layout: DeskLayout): Promise<DeskLayout> {
    const file = deskStateFile(this.root, deskId)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ layout } satisfies DeskState, null, 2) + '\n')
    this.cache.set(deskId, layout)
    const pins = JSON.stringify(layoutOps.pinnedTabs(layout))
    if (this.pinsSeen.get(deskId) !== pins) {
      this.pinsSeen.set(deskId, pins)
      this.onPinsChanged()
    }
    return layout
  }

  /** Brings back what was closed last in this WorkDesk (Command+Shift+T); nothing to bring back leaves the layout as it is. */
  async reopenClosed(deskId: string): Promise<DeskLayout> {
    const item = this.closed.get(deskId)?.pop()
    const layout = await this.get(deskId)
    return item ? this.save(deskId, layoutOps.reopen(layout, item, randomUUID(), randomUUID)) : layout
  }

  async moveTabToGroup(deskId: string, tabId: string, group: string): Promise<DeskLayout> {
    return this.save(deskId, layoutOps.moveTabToGroup(await this.get(deskId), tabId, group))
  }

  async moveGroup(deskId: string, group: string, target: string, after: boolean): Promise<DeskLayout> {
    return this.save(deskId, layoutOps.moveGroup(await this.get(deskId), group, target, after))
  }

  async setTabBranch(deskId: string, tabId: string, path: string): Promise<DeskLayout> {
    return this.save(deskId, layoutOps.setTabBranch(await this.get(deskId), tabId, path))
  }

  async setTabGroup(deskId: string, tabId: string, group: string): Promise<DeskLayout> {
    return this.save(deskId, layoutOps.setTabGroup(await this.get(deskId), tabId, group))
  }

  async togglePin(deskId: string, tabId: string): Promise<DeskLayout> {
    return this.save(deskId, layoutOps.togglePin(await this.get(deskId), tabId))
  }

  /** The pinned Tabs of these WorkDesks, as saved: a WorkDesk that has no saved layout yet is not made one. */
  async pins(deskIds: readonly string[]): Promise<Record<string, layoutOps.PinnedTab[]>> {
    const out: Record<string, layoutOps.PinnedTab[]> = {}
    for (const deskId of deskIds) {
      let layout = this.cache.get(deskId)
      if (!layout) {
        try {
          layout = (JSON.parse(await readFile(deskStateFile(this.root, deskId), 'utf8')) as DeskState).layout
        } catch {
          continue
        }
      }
      const pinned = layoutOps.pinnedTabs(layout)
      if (pinned.length > 0) out[deskId] = pinned
    }
    return out
  }
}

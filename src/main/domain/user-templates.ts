import { isValidStage } from './stage'
import type { DeskLayout, LayoutNode, Tab } from './layout'
import { withFixedTabs } from './layout'
import type { Schedule } from './schedule'
import { TEMPLATES, type DeskTemplate, type TemplateNode, type TemplatePane, type TemplateTab } from './templates'
import type { Stage, Todo, WorkDesk } from './types'

export const USER_PREFIX = 'user-'
export const isBuiltin = (id: string): boolean => TEMPLATES.some((t) => t.id === id)

function nodeOf(node: LayoutNode, kindsOnly: boolean): TemplateNode {
  if (node.type === 'split') return { type: 'split', direction: node.direction, children: node.children.map((c) => nodeOf(c, kindsOnly)) }
  if (node.kind === 'browser') return { type: 'pane', kind: 'browser', url: kindsOnly ? 'about:blank' : node.url }
  if (node.kind === 'file') return kindsOnly || !node.path ? { type: 'pane', kind: 'file' } : { type: 'pane', kind: 'file', path: node.path }
  return { type: 'pane', kind: 'terminal' }
}

const kindsIn = (node: TemplateNode): TemplatePane[] => (node.type === 'split' ? node.children.flatMap(kindsIn) : [node.kind])

/** The Tabs with Panes of a WorkDesk as template tabs. With `kindsOnly` the pages and files are left out: just the kinds of Panes. */
export function captureTabs(layout: DeskLayout, kindsOnly: boolean): TemplateTab[] {
  return layout.tabs.flatMap((t: Tab) => (t.kind === 'panes' ? [{ name: t.name, layout: nodeOf(t.layout, kindsOnly) }] : []))
}

/** A template from a WorkDesk: its open Todos in checklist order, its Stage (a Plain Stage; others become Implement) and its Tabs. */
export function captureTemplate(id: string, name: string, desk: WorkDesk, todos: readonly Todo[], layout: DeskLayout, kindsOnly: boolean): DeskTemplate {
  const title = name.trim()
  if (!title) throw new Error('A template needs a name')
  const byId = new Map(todos.map((t) => [t.id, t]))
  const open = desk.todoIds.flatMap((tid) => byId.get(tid) ?? []).filter((t) => !t.resolved)
  const tabs = captureTabs(layout, kindsOnly)
  const stage: Stage = isValidStage(desk.stage) ? desk.stage : 'implement'
  const panes: TemplatePane[] = tabs[0] ? kindsIn(tabs[0].layout) : ['terminal']
  return { id, name: title, stage, todos: open.map((t) => t.title), panes: panes.length > 0 ? panes : ['terminal'], tabs }
}

/** A layout for a new WorkDesk from template tabs: Details in front, and the first Tab of Panes active. */
export function layoutFromTabs(tabs: readonly TemplateTab[], newId: () => string, cwd: string, detailsId: string): DeskLayout {
  const build = (n: TemplateNode): LayoutNode =>
    n.type === 'split'
      ? { type: 'split', direction: n.direction, children: n.children.map(build) }
      : n.kind === 'browser'
        ? { type: 'pane', id: newId(), kind: 'browser', url: n.url }
        : n.kind === 'file'
          ? { type: 'pane', id: newId(), kind: 'file', ...(n.path ? { path: n.path } : {}) }
          : { type: 'pane', id: newId(), kind: 'terminal', cwd }
  const paneTabs: Tab[] = tabs.map((t) => ({ kind: 'panes', id: newId(), name: t.name, layout: build(t.layout) }))
  if (paneTabs.length === 0) paneTabs.push({ kind: 'panes', id: newId(), name: 'Terminal', layout: { type: 'pane', id: newId(), kind: 'terminal', cwd } })
  return withFixedTabs({ tabs: paneTabs, activeTabId: detailsId }, detailsId)
}

// --- the list of the user's own templates ---

function update(list: readonly DeskTemplate[], id: string, fn: (t: DeskTemplate) => DeskTemplate): DeskTemplate[] {
  if (isBuiltin(id)) throw new Error('The built-in templates cannot be changed: duplicate one first')
  if (!list.some((t) => t.id === id)) throw new Error(`Unknown template ${id}`)
  return list.map((t) => (t.id === id ? fn(t) : t))
}

const cleanTodos = (todos: readonly string[]): string[] => todos.map((t) => t.trim()).filter(Boolean)

/** Rename, change the Stage or replace the Todos of a user template. */
export function editTemplate(list: readonly DeskTemplate[], id: string, patch: { name?: string; stage?: Stage; todos?: string[] }): DeskTemplate[] {
  return update(list, id, (t) => {
    const name = patch.name === undefined ? t.name : patch.name.trim()
    if (!name) throw new Error('A template needs a name')
    if (patch.stage !== undefined && !isValidStage(patch.stage)) throw new Error(`Stage "${patch.stage}" is not known`)
    return { ...t, name, stage: patch.stage ?? t.stage, todos: patch.todos === undefined ? t.todos : cleanTodos(patch.todos) }
  })
}

export function deleteTemplate(list: readonly DeskTemplate[], id: string): DeskTemplate[] {
  return update(list, id, (t) => t).filter((t) => t.id !== id)
}

/** A copy (also of a built-in one) at the end of the user's list, named "… copy". */
export function duplicateTemplate(list: readonly DeskTemplate[], id: string, newId: string): DeskTemplate[] {
  const src = [...TEMPLATES, ...list].find((t) => t.id === id)
  if (!src) throw new Error(`Unknown template ${id}`)
  const { builtin: _b, ...rest } = src
  const names = new Set([...TEMPLATES, ...list].map((t) => t.name))
  let name = `${src.name} copy`
  for (let n = 2; names.has(name); n++) name = `${src.name} copy ${n}`
  return [...list, { ...rest, id: newId, name }]
}

/** One step up (-1) or down (1) among the user's templates. */
export function moveTemplate(list: readonly DeskTemplate[], id: string, delta: -1 | 1): DeskTemplate[] {
  const i = list.findIndex((t) => t.id === id)
  if (i < 0) throw new Error(isBuiltin(id) ? 'The built-in templates keep their place' : `Unknown template ${id}`)
  const j = i + delta
  if (j < 0 || j >= list.length) return [...list]
  const out = [...list]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Schedules whose template is gone are paused, with the reason. Others are returned as they are. */
export function pauseMissingTemplates(schedules: readonly Schedule[], templates: readonly DeskTemplate[]): Schedule[] {
  const ids = new Set(templates.map((t) => t.id))
  return schedules.map((s) => (ids.has(s.templateId) || s.pausedReason ? s : { ...s, paused: true, pausedReason: 'Its template was deleted. Choose another template, then resume.' }))
}

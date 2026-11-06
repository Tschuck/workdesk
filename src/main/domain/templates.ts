import { setStageByHand } from './stage'
import { createTodo } from './todos'
import type { Stage, Todo, WorkDesk } from './types'

export type TemplatePane = 'terminal' | 'browser' | 'file'

/** A layout without ids: Panes with what they show, and the splits between them. */
export type TemplateNode =
  | { type: 'pane'; kind: 'terminal' }
  | { type: 'pane'; kind: 'browser'; url: string }
  | { type: 'pane'; kind: 'file'; path?: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; children: TemplateNode[] }

export interface TemplateTab {
  name: string
  layout: TemplateNode
}

/** A preset for a Plain WorkDesk: the Todos it starts with, the Stage, and the Panes of its first Tab. */
export interface DeskTemplate {
  id: string
  name: string
  stage: Stage
  todos: string[]
  /** Panes of the first Tab, side by side; the first is the terminal that every WorkDesk has */
  panes: TemplatePane[]
  /** the three that come with the app: they cannot be changed or deleted, only duplicated */
  builtin?: true
  /** a template made from a WorkDesk keeps its Tabs with the layout; without them `panes` is used */
  tabs?: TemplateTab[]
}

export const TEMPLATES: DeskTemplate[] = [
  {
    id: 'review-pr',
    name: 'Review PR',
    stage: 'in-review',
    todos: ['Read the description and the ticket', 'Check out the branch and run it', 'Go through the diff', 'Write the comments', 'Submit the review'],
    panes: ['terminal', 'browser'],
    builtin: true
  },
  {
    id: 'release',
    name: 'Release',
    stage: 'testing',
    todos: ['Check that main is green', 'Write the release notes', 'Bump the version and tag', 'Deploy', 'Check it in production', 'Announce it'],
    panes: ['terminal', 'browser'],
    builtin: true
  },
  {
    id: 'bug-triage',
    name: 'Bug triage',
    stage: 'implement',
    todos: ['Reproduce the bug', 'Find the cause', 'Decide: fix now, schedule or close', 'Write what was found into the ticket'],
    panes: ['terminal', 'browser', 'file'],
    builtin: true
  }
]

export interface TemplateDesk {
  desk: WorkDesk
  todos: Todo[]
}

/** The WorkDesk and the Todos of a template; `newId` gives an id for each Todo. The Stage counts as set by hand. */
export function fromTemplate(template: DeskTemplate, desks: readonly WorkDesk[], deskId: string, name: string, newId: () => string, now: number): TemplateDesk {
  const todos = template.todos.map((title) => ({ ...createTodo(newId(), { title, list: 'today' }, now), deskId }))
  const desk: WorkDesk = {
    id: deskId,
    name,
    ...setStageByHand(template.stage),
    priority: desks.length === 0 ? 0 : Math.max(...desks.map((d) => d.priority)) + 1,
    presence: 'inactive',
    todoIds: todos.map((t) => t.id),
    branches: [],
    signals: [],
    createdAt: now
  }
  return { desk, todos }
}

/** Built-in templates, then the user's own. */
export const allTemplates = (user: readonly DeskTemplate[]): DeskTemplate[] => [...TEMPLATES, ...user]

export function templateById(id: string, user: readonly DeskTemplate[] = []): DeskTemplate {
  const t = allTemplates(user).find((x) => x.id === id)
  if (!t) throw new Error(`Unknown template ${id}`)
  return t
}

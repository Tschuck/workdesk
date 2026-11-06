import type { AppState } from '../shared/api'
import { BranchesView } from './BranchesView'
import { GithubView } from './GithubView'
import { NotionView } from './NotionView'
import type { SettingsSection } from './SettingsView'
import { TodoArchive } from './TodoArchive'
import { TodoView } from './TodoView'

export type WorkTab = 'todos' | 'prs' | 'notion' | 'branches' | 'archive'

const TABS: { id: WorkTab; label: string; title: string }[] = [
  { id: 'todos', label: 'Todos', title: 'Your own Todos that no WorkDesk has' },
  { id: 'prs', label: 'Pull Requests', title: 'Open pull requests of your Projects' },
  { id: 'notion', label: 'Notion', title: 'Tickets of the sprint board and the statuses before it' },
  { id: 'branches', label: 'Branches', title: 'Start a WorkDesk from existing git branches' },
  { id: 'archive', label: 'Todo Archive', title: 'Resolved Todos that were put away: search them, or bring one back' }
]

interface Props {
  state: AppState
  run: (action: () => Promise<AppState>) => Promise<void>
  tab: WorkTab
  onTab: (tab: WorkTab) => void
  openDesk: (id: string) => void
  openSettings: (section: SettingsSection) => void
  /** a branch to show on the Branches tab */
  focus?: { project: string; branch: string }
}

/** Where work comes from, in one place: your Todos, pull requests, tickets and branches, as tabs. */
export function WorkItemsPage({ state, run, tab, onTab, openDesk, openSettings, focus }: Props) {
  const free = state.todos.filter((t) => !t.deskId && !t.resolved).length
  return (
    <div className="work-page">
      <div className="pipe-tabs work-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === tab} title={t.title} className={'pipe-tab' + (t.id === tab ? ' active' : '')} onClick={() => onTab(t.id)}>
            {t.label}
            {t.id === 'todos' && <span className="count">{free}</span>}
          </button>
        ))}
      </div>
      {tab === 'todos' && <TodoView state={state} run={run} openDesk={openDesk} />}
      {tab === 'prs' && <GithubView state={state} run={run} openDesk={openDesk} openSettings={openSettings} />}
      {tab === 'notion' && <NotionView state={state} run={run} openDesk={openDesk} openSettings={openSettings} />}
      {tab === 'archive' && (
        <section className="archive-page">
          <h2>Todo Archive</h2>
          <TodoArchive run={run} version={state.todos.length} />
        </section>
      )}
      {tab === 'branches' && <BranchesView focus={focus} desks={state.desks} run={run} openDesk={openDesk} />}
    </div>
  )
}

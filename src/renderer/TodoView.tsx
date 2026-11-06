import { useMemo, useState } from 'react'
import type { AppState } from '../shared/api'
import { allTopics, filterByTopics, groupByTopic, resolvedEarlier } from '../main/domain/todos'
import type { Todo } from '../main/domain/types'
import { todoItem } from '../main/domain/work-items'
import { TODO_MIME } from './dnd'
import { planItems } from './WorkItems'
import { TodoText } from './TodoText'
import { TodoDetail } from './TodoDetail'
import { AddButton, Field, Modal } from './Modal'
import { ContextMenu, type MenuItem } from './ContextMenu'

interface Props {
  state: AppState
  run: (action: () => Promise<AppState>) => Promise<void>
  openDesk: (id: string) => void
}

/** Your own Todos that no WorkDesk has. Plan one for today and it becomes a planned WorkDesk. */
export function TodoView({ state, run, openDesk }: Props) {
  const api = window.workdesk
  const [title, setTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [topicsText, setTopicsText] = useState('')
  const [filter, setFilter] = useState<string[]>([])
  // the Todo whose notes are shown in the pane on the right
  const [openId, setOpenId] = useState<string>()
  const [collapsed, setCollapsed] = useState<string[]>([])
  // drag: which Todo, from which topic section, and where it would land
  const [drag, setDrag] = useState<{ id: string; topic: string }>()
  const [drop, setDrop] = useState<{ id: string; after: boolean }>()
  const [menu, setMenu] = useState<{ x: number; y: number; todo: Todo }>()

  // Todos resolved on an earlier day are out of the way (and in the archive, unless they sit in a WorkDesk)
  const inList = useMemo(() => state.todos.filter((t) => !t.deskId && !resolvedEarlier(t, Date.now())), [state.todos])
  const clearable = state.todos.filter((t) => t.resolved && !t.deskId).length
  const visible = useMemo(() => filterByTopics(inList, filter), [inList, filter])
  const groups = useMemo(() => groupByTopic(visible), [visible])
  // a Todo that left this list (moved, deleted) closes its pane
  const openTodoId = openId && inList.some((t) => t.id === openId) ? openId : undefined

  const row = (t: Todo, topic: string) => {
    // dropping is only possible inside the section the drag started in
    const target = (e: React.DragEvent) => {
      if (!drag || drag.topic !== topic || drag.id === t.id) return undefined
      const box = e.currentTarget.getBoundingClientRect()
      return { id: t.id, after: e.clientY > box.top + box.height / 2 }
    }
    const cls = ['clickable', t.resolved ? 'resolved' : '', t.id === openTodoId ? 'selected' : '']
    if (drag?.id === t.id && drag.topic === topic) cls.push('dragging')
    if (drop?.id === t.id && drag?.topic === topic) cls.push(drop.after ? 'drop-after' : 'drop-before')
    return (
      <li
        key={topic + t.id}
        className={cls.join(' ')}
        draggable
        onClick={() => setOpenId(t.id)}
        onContextMenu={(e) => (e.preventDefault(), setOpenId(t.id), setMenu({ x: e.clientX, y: e.clientY, todo: t }))}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', t.id)
          e.dataTransfer.setData(TODO_MIME, t.id)
          setDrag({ id: t.id, topic })
        }}
        onDragOver={(e) => {
          const pos = target(e)
          if (!pos) return
          e.preventDefault()
          setDrop(pos)
        }}
        onDrop={(e) => {
          const pos = target(e)
          const id = drag?.id
          setDrag(undefined)
          setDrop(undefined)
          if (!pos || !id) return
          e.preventDefault()
          void run(() => api.placeTodo(id, pos.id, pos.after))
        }}
        onDragEnd={() => (setDrag(undefined), setDrop(undefined))}
      >
        <TodoText
          todo={t}
          skipTopic={topic}
          extra={t.resolved ? <span className="badge">resolved</span> : undefined}
        />
        <span className="actions" onClick={(e) => e.stopPropagation()}>
          {!t.resolved && <button title="A planned WorkDesk in the left panel; nothing is started" onClick={() => void planItems([todoItem(t)], run)}>Add to today</button>}
        </span>
      </li>
    )
  }

  const menuItems = (t: Todo): MenuItem[] => [
    { label: 'Open', onClick: () => setOpenId(t.id) },
    { label: 'Add to today', disabled: t.resolved, why: 'It is resolved', onClick: () => void planItems([todoItem(t)], run) },
    { label: t.resolved ? 'Reopen' : 'Resolve', onClick: () => void run(() => api.setTodoResolved(t.id, !t.resolved)) },
    { label: 'Copy title', onClick: () => void navigator.clipboard.writeText(t.title) },
    { label: 'Delete', onClick: () => window.confirm(`Delete the Todo "${t.title}"?`) && void run(() => api.deleteTodo(t.id)) },
  ]

  return (
    <div className="split-page">
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.todo)} onClose={() => setMenu(undefined)} />}
    <section className="split-main">
      <h2>
        Todos
        <AddButton label="Add a Todo" onClick={() => setAdding(true)} />
        {clearable > 0 && (
          <button className="clear-done" title="Put the resolved Todos into the archive; you can search and restore them there" onClick={() => void run(() => api.archiveResolvedTodos(true))}>
            Clear done ({clearable})
          </button>
        )}
      </h2>

      {adding && (
        <Modal
          title="New Todo"
          canSubmit={!!title.trim()}
          onClose={() => setAdding(false)}
          onSubmit={() => {
            void run(() => api.addTodo({ title, topics: topicsText.split(','), list: 'backlog' }))
            setTitle('')
            setTopicsText('')
            setAdding(false)
          }}
        >
          <Field label="Todo"><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Topics" hint="Comma separated."><input value={topicsText} onChange={(e) => setTopicsText(e.target.value)} /></Field>
        </Modal>
      )}

      <div className="topics">
        {allTopics(inList).map((topic) => (
          <button
            key={topic}
            className={filter.includes(topic) ? 'chip on' : 'chip'}
            onClick={() => setFilter((f) => (f.includes(topic) ? f.filter((x) => x !== topic) : [...f, topic]))}
          >
            {topic}
          </button>
        ))}
      </div>

      {groups.length > 0 && (
        <div className="desk-cards">
          {groups.map((g) => {
            const open = !collapsed.includes(g.topic)
            return (
              <div key={g.topic} className="desk-card topic-card">
                <div className="desk-card-head" onClick={() => setCollapsed((c) => (open ? [...c, g.topic] : c.filter((x) => x !== g.topic)))}>
                  <span className="chevron">{open ? '▾' : '▸'}</span>
                  <strong className="desk-card-name" title={g.topic}>{g.topic}</strong>
                  <span className="count">{g.items.length}</span>
                </div>
                {open && <ul className="todos">{g.items.map((t) => row(t, g.topic))}</ul>}
              </div>
            )
          })}
        </div>
      )}
      {visible.length === 0 && <p className="empty">Nothing here.</p>}

    </section>
    <aside className="side-pane">
      {openTodoId ? (
        <TodoDetail key={openTodoId} todoId={openTodoId} state={state} run={run} embedded openDesk={openDesk} onBack={() => setOpenId(undefined)} />
      ) : (
        <p className="empty">Select a Todo to see and edit its notes here.</p>
      )}
    </aside>
    </div>
  )
}

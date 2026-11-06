import { todoPills } from '../main/domain/todos'
import type { Todo } from '../main/domain/types'

/** Kind, project and topics of a Todo as small pills next to its title. */
export function Pills({ todo, skipTopic }: { todo: Pick<Todo, 'topics' | 'source'>; skipTopic?: string }) {
  return (
    <>
      {todoPills(todo)
        .filter((p) => !(p.type === 'topic' && p.label === skipTopic))
        .map((p) => (
          <span key={p.type + p.label} className={`chip small pill-${p.type}` + (p.kind ? ` kind-${p.kind}` : '')} title={p.hint}>
            {p.label}
          </span>
        ))}
    </>
  )
}

import type { ReactNode } from 'react'
import type { Todo } from '../main/domain/types'
import { Pills } from './Pills'
import { PrChips, usePrState } from './PrStates'

interface Props {
  todo: Pick<Todo, 'title' | 'topics' | 'source'>
  /** the topic of the section the Todo is shown in, not repeated as a pill */
  skipTopic?: string
  /** more chips for the second line (postponed, resolved, …) */
  extra?: ReactNode
}

/**
 * The text of a Todo in two lines: its kind, project and topics in front of the title; below, where the
 * Pull Request behind a review stands (approved, checks, ready to merge) and anything else worth a chip.
 */
export function TodoText({ todo, skipTopic, extra }: Props) {
  const hasPr = !!usePrState(todo)
  return (
    <div className="todo-text-block">
      <div className="todo-line1">
        <Pills todo={todo} skipTopic={skipTopic} />
        <span className="title">{todo.title}</span>
      </div>
      {(hasPr || extra) && (
        <div className="todo-line2">
          <PrChips todo={todo} />
          {extra}
        </div>
      )}
    </div>
  )
}

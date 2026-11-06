import { useSyncExternalStore } from 'react'
import { moveEngine, orderEngines, SEARCH_ENGINES, type SearchEngineId } from '../main/domain/url'

const KEY = 'workdesk.searchEngines'
/** the one engine of earlier versions: it stays the first */
const OLD_KEY = 'workdesk.searchEngine'
const listeners = new Set<() => void>()

function read(): SearchEngineId[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as string[] | null
    const old = localStorage.getItem(OLD_KEY)
    return orderEngines(saved ?? (old ? [old] : [])).map((e) => e.id)
  } catch {
    return SEARCH_ENGINES.map((e) => e.id)
  }
}

let order = read()

/** The search engines in the order the user keeps them: the first is the default, used by the address bar and the favorites search. Kept per machine. */
export function setSearchEngineOrder(next: readonly SearchEngineId[]): void {
  order = orderEngines(next).map((e) => e.id)
  try {
    localStorage.setItem(KEY, JSON.stringify(order))
  } catch {
    // remembering is a convenience only
  }
  listeners.forEach((l) => l())
}

export const moveSearchEngine = (id: SearchEngineId, to: number): void => setSearchEngineOrder(moveEngine(order, id, to))

export const getSearchEngine = (): SearchEngineId => order[0]

export const useSearchEngines = () =>
  orderEngines(
    useSyncExternalStore(
      (l) => (listeners.add(l), () => listeners.delete(l)),
      () => order
    )
  )

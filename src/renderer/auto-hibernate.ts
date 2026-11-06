import { useSyncExternalStore } from 'react'
import { DEFAULT_AUTO_HIBERNATE, parseAutoHibernate, type AutoHibernate } from '../main/domain/hibernate'

const KEY = 'workdesk.autoHibernate'
const listeners = new Set<() => void>()

function read(): AutoHibernate {
  try {
    return parseAutoHibernate(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return parseAutoHibernate(undefined)
  }
}

let current: AutoHibernate = { ...DEFAULT_AUTO_HIBERNATE, ...read() }

/** The settings of automatic hibernation of pages, kept on this machine. */
export function setAutoHibernate(patch: Partial<AutoHibernate>): void {
  current = parseAutoHibernate({ ...current, ...patch })
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // remembering is a convenience only
  }
  listeners.forEach((l) => l())
}

export const getAutoHibernate = (): AutoHibernate => current

export const useAutoHibernate = (): AutoHibernate =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current
  )

import { useEffect, useState } from 'react'
import type { BrowserSessionsConfig } from '../main/domain/browser-sessions'

let cached: BrowserSessionsConfig | undefined
let loading: Promise<BrowserSessionsConfig> | undefined
const listeners = new Set<(c: BrowserSessionsConfig) => void>()

/** The rules that say which domain has which session; loaded once, and replaced when Settings saves them. */
export function loadBrowserSessions(): Promise<BrowserSessionsConfig> {
  if (cached) return Promise.resolve(cached)
  loading ??= window.workdesk.browserSessionsGet().then((c) => (cached = c))
  return loading
}

export function setBrowserSessions(c: BrowserSessionsConfig): void {
  cached = c
  listeners.forEach((l) => l(c))
}

export function useBrowserSessions(): BrowserSessionsConfig | undefined {
  const [config, setConfig] = useState(cached)
  useEffect(() => {
    let live = true
    void loadBrowserSessions().then((c) => live && setConfig(c))
    listeners.add(setConfig)
    return () => {
      live = false
      listeners.delete(setConfig)
    }
  }, [])
  return config
}

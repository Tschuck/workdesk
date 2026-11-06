import { useEffect } from 'react'

/**
 * Something to open in a WorkDesk that is not on screen yet (a file or a terminal found by the search over all
 * WorkDesks, a file picked in the palette): queued here, taken by that WorkDesk's view as soon as it is shown.
 */
export type OpenRequest = { kind: 'file'; path: string; line?: number } | { kind: 'tab'; tabId: string }

const queue = new Map<string, OpenRequest[]>()
const listeners = new Set<() => void>()

export function requestOpen(deskId: string, req: OpenRequest): void {
  queue.set(deskId, [...(queue.get(deskId) ?? []), req])
  listeners.forEach((l) => l())
}

/** Runs the requests queued for this WorkDesk, once it is on screen. */
export function useOpenRequests(deskId: string, shown: boolean, openFile: (path: string, line?: number) => void, openTab: (tabId: string) => void): void {
  useEffect(() => {
    if (!shown) return
    const drain = () => {
      const reqs = queue.get(deskId)
      if (!reqs?.length) return
      queue.delete(deskId)
      for (const r of reqs) {
        if (r.kind === 'file') openFile(r.path, r.line)
        else openTab(r.tabId)
      }
    }
    drain()
    listeners.add(drain)
    return () => void listeners.delete(drain)
    // the callbacks are fresh on every render; the latest ones are used when a request arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deskId, shown])
}

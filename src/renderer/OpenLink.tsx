import { createContext, useContext } from 'react'

/** Inside a WorkDesk, links open as a browser Tab of that WorkDesk; elsewhere they open in the system browser. */
export const OpenLinkContext = createContext<((url: string) => void) | undefined>(undefined)

export function useOpenLink(): (url: string) => void {
  const inDesk = useContext(OpenLinkContext)
  return inDesk ?? ((url) => void window.workdesk.openExternal(url))
}

/** Several links at once: one browser Tab each inside a WorkDesk, the system browser elsewhere. */
export const OpenLinksContext = createContext<((urls: string[]) => void) | undefined>(undefined)

export function useOpenLinks(): (urls: string[]) => void {
  const inDesk = useContext(OpenLinksContext)
  return inDesk ?? ((urls) => urls.forEach((url) => void window.workdesk.openExternal(url)))
}

/** Pull Requests and Notion tickets of the WorkDesk a page is in, offered on its empty new tab. */
export interface DeskLink {
  title: string
  url: string
  kind: 'pr' | 'ticket' | 'page'
}
export const DeskLinksContext = createContext<DeskLink[]>([])

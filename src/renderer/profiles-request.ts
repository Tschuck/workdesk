/** Asks the Profiles page to open its dialog to add a Profile (from the navigation of the Settings, which is not that page). */
export type ProfilesRequest = { add: true }

const EVENT = 'workdesk:profiles-request'
let pending: ProfilesRequest | undefined

export function requestProfilesDialog(req: ProfilesRequest): void {
  pending = req
  window.dispatchEvent(new Event(EVENT))
}

/** The request that is waiting (made before the page was there), and forget it. */
export function takeProfilesRequest(): ProfilesRequest | undefined {
  const r = pending
  pending = undefined
  return r
}

export const onProfilesRequest = (listener: () => void): (() => void) => (window.addEventListener(EVENT, listener), () => window.removeEventListener(EVENT, listener))

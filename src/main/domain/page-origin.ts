// What the renderer also needs (the site settings of a page): no Node here.

/** What a web page can be allowed to do, besides the few harmless things that never ask. */
export type PagePermission = 'camera' | 'microphone' | 'screen'

export const PERMISSION_LABEL: Record<PagePermission, string> = { camera: 'the camera', microphone: 'the microphone', screen: 'your screen' }

export interface Grant {
  origin: string
  permission: PagePermission
}

/** Only secure pages (and local development) are asked about; anything else is refused without a question. */
export function askableOrigin(origin: string): string | undefined {
  try {
    const u = new URL(origin)
    if (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) return u.origin
  } catch {
    // not an address
  }
  return undefined
}

/** What the camera / microphone request of Electron asks for. */
export function wanted(permission: string, mediaTypes: readonly string[] = []): PagePermission[] {
  if (permission === 'media') {
    const list = mediaTypes.flatMap((t) => (t === 'video' ? ['camera' as const] : t === 'audio' ? ['microphone' as const] : []))
    return list.length > 0 ? list : ['camera', 'microphone']
  }
  if (permission === 'display-capture') return ['screen']
  return []
}

/**
 * Is a page allowed to find out that it may ask? A page checks the state first (`permissions.query`) and only asks for
 * the camera or microphone when it is not "denied". So for secure pages the check says yes: the question comes with the
 * request, and nothing is let through before the user said yes.
 */
export const mayAsk = (permission: string, origin: string): boolean => permission === 'media' && !!askableOrigin(origin)


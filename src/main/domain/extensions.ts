/** Chrome extension ids are 32 letters a to p. */
const ID = /^[a-p]{32}$/

/** The extension id from what was pasted: the id itself or the URL of its Chrome Web Store page. */
export function parseExtensionId(input: string): string | undefined {
  const text = input.trim()
  if (ID.test(text)) return text
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' || !/^(chromewebstore\.google\.com|chrome\.google\.com)$/.test(url.hostname)) return undefined
    return url.pathname.split('/').find((part) => ID.test(part))
  } catch {
    return undefined
  }
}

export interface InstalledExtension {
  id: string
  name: string
  version: string
}

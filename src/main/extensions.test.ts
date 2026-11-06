import { describe, expect, it } from 'vitest'
import { parseExtensionId } from './domain/extensions'

const ID = 'ddkjiahejlhfcafbddmgiahcphecmpfh'

describe('extension id', () => {
  it('takes the id itself or the Chrome Web Store address', () => {
    expect(parseExtensionId(` ${ID} `)).toBe(ID)
    expect(parseExtensionId(`https://chromewebstore.google.com/detail/ublock-origin-lite/${ID}?hl=en`)).toBe(ID)
    expect(parseExtensionId(`https://chrome.google.com/webstore/detail/${ID}`)).toBe(ID)
  })

  it('refuses everything else', () => {
    for (const text of ['', 'ublock', ID.toUpperCase(), ID + 'a', `http://chromewebstore.google.com/detail/x/${ID}`, `https://evil.example/detail/x/${ID}`, `javascript:${ID}`]) {
      expect(parseExtensionId(text)).toBeUndefined()
    }
  })
})

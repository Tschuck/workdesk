import { describe, expect, it } from 'vitest'
import { isSignInPopup } from './popup'

describe('pop-ups that need their opener', () => {
  it('are https pages opened with window features', () => {
    expect(isSignInPopup('https://accounts.google.com/gsi/transform', 'width=500,height=600,left=10')).toBe(true)
    expect(isSignInPopup('https://accounts.google.com/x', 'popup')).toBe(true)
    expect(isSignInPopup('https://appleid.apple.com/auth', 'popup=yes,noopener')).toBe(true)
  })
  it('are not plain links, other schemes, or pages that ask for nothing', () => {
    expect(isSignInPopup('https://example.com/', '')).toBe(false)
    expect(isSignInPopup('http://example.com/', 'width=500')).toBe(false)
    expect(isSignInPopup('file:///etc/passwd', 'width=500')).toBe(false)
    expect(isSignInPopup('https://example.com/', 'noopener')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { APP_FONT, vscodeFontOptions } from './code-theme'

describe('font of VS Code', () => {
  it('turns a line height below 8 into a multiple of the size, and keeps the app font as a fallback', () => {
    expect(vscodeFontOptions({ fontFamily: 'JetBrains Mono', fontSize: 12, lineHeight: 1.6, letterSpacing: 0.5, fontLigatures: true })).toEqual({
      fontFamily: `JetBrains Mono, ${APP_FONT.fontFamily}`,
      fontSize: 12,
      letterSpacing: 0.5,
      lineHeight: 19,
      fontLigatures: true
    })
    expect(vscodeFontOptions({ lineHeight: 20 }).lineHeight).toBe(20)
    expect(vscodeFontOptions({})).toEqual(APP_FONT)
  })
})

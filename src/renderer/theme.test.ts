import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, rgbTriplet, THEMES, themeById } from './theme'

const HEX = /^#[0-9a-f]{6}$/i

describe('themes', () => {
  it('start with Gruvbox Dark, the default, and have unique ids', () => {
    expect(DEFAULT_THEME).toBe('gruvbox-dark')
    expect(THEMES[0].id).toBe(DEFAULT_THEME)
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length)
    expect(THEMES.length).toBeGreaterThanOrEqual(5)
  })
  it('only use six-digit hex colours, so every tint can be derived', () => {
    for (const t of THEMES) {
      for (const [k, v] of [...Object.entries(t.palette), ...Object.entries(t.xterm)]) expect(v, `${t.id}.${k}`).toMatch(HEX)
    }
  })
  it('keeps the terminal background in line with the page', () => {
    for (const t of THEMES) expect(t.xterm.background).toBe(t.palette.bg)
  })
  it('falls back to the default for an unknown id', () => {
    expect(themeById('nope').id).toBe(DEFAULT_THEME)
    expect(themeById(null).id).toBe(DEFAULT_THEME)
    expect(themeById('nord').name).toBe('Nord')
  })
  it('turns a colour into the r g b CSS needs', () => {
    expect(rgbTriplet('#ebdbb2')).toBe('235 219 178')
    expect(rgbTriplet('#000000')).toBe('0 0 0')
  })
})

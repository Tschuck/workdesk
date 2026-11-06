/** Which colours the editor of a File pane uses: the app's own (`app`), or a theme of an extension installed in VS Code. */
export const APP_CODE_THEME = 'app'
const KEY = 'workdesk.codeTheme'

const listeners = new Set<(id: string) => void>()

/** What was chosen, or undefined while nothing was (then the theme VS Code uses is taken, when there is one). */
export function storedCodeTheme(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function chooseCodeTheme(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // remembering is a convenience only
  }
  listeners.forEach((l) => l(id))
}

export function onCodeThemeChange(listener: (id: string) => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** The id to use now: the choice, else the VS Code theme (by its label), else the app's colours. */
export async function resolveCodeTheme(): Promise<string> {
  const stored = storedCodeTheme()
  if (stored) return stored
  try {
    const { themes, current } = await window.workdesk.codeThemes()
    return themes.find((t) => t.label === current)?.id ?? APP_CODE_THEME
  } catch {
    return APP_CODE_THEME
  }
}

/** Whether the editor uses the font of your VS Code (family, size, letter spacing, line height). Off until chosen. */
const FONT_KEY = 'workdesk.codeFontFromVscode'
const fontListeners = new Set<() => void>()
export const fontFromVscode = (): boolean => {
  try {
    return localStorage.getItem(FONT_KEY) === '1'
  } catch {
    return false
  }
}
export function chooseCodeFont(on: boolean): void {
  try {
    if (on) localStorage.setItem(FONT_KEY, '1')
    else localStorage.removeItem(FONT_KEY)
  } catch {
    // remembering is a convenience only
  }
  fontListeners.forEach((l) => l())
}
export function onCodeFontChange(listener: () => void): () => void {
  fontListeners.add(listener)
  return () => void fontListeners.delete(listener)
}

export interface FontOptions {
  fontFamily: string
  fontSize: number
  letterSpacing: number
  lineHeight: number
  fontLigatures: boolean
}

export const APP_FONT: FontOptions = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, letterSpacing: 0, lineHeight: 0, fontLigatures: false }

/** The options of the editor for the font of VS Code (a line height below 8 is a multiple of the size, as in VS Code). */
export function vscodeFontOptions(f: { fontFamily?: string; fontSize?: number; letterSpacing?: number; lineHeight?: number; fontLigatures?: boolean }): FontOptions {
  const fontSize = f.fontSize ?? APP_FONT.fontSize
  return {
    fontFamily: f.fontFamily ? `${f.fontFamily}, ${APP_FONT.fontFamily}` : APP_FONT.fontFamily,
    fontSize,
    letterSpacing: f.letterSpacing ?? 0,
    lineHeight: f.lineHeight ? (f.lineHeight < 8 ? Math.round(f.lineHeight * fontSize) : f.lineHeight) : 0,
    fontLigatures: f.fontLigatures ?? false
  }
}

/** The font to use now. */
export async function resolveFont(): Promise<FontOptions> {
  if (!fontFromVscode()) return APP_FONT
  try {
    return vscodeFontOptions(await window.workdesk.codeFont())
  } catch {
    return APP_FONT
  }
}

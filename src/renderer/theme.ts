/** The colours the whole UI is made of. Everything else (tints, lines, hover states) is derived from them in app.css. */
export interface Palette {
  bg: string
  bgDark: string
  fg: string
  fgBright: string
  yellow: string
  green: string
  red: string
  blue: string
  orange: string
  purple: string
  /** background of an error message */
  toast: string
}

export interface XtermColors {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  black: string; red: string; green: string; yellow: string; blue: string; magenta: string; cyan: string; white: string
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string; brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string
}

export interface Theme {
  id: string
  name: string
  scheme: 'dark' | 'light'
  palette: Palette
  xterm: XtermColors
}

export const DEFAULT_THEME = 'gruvbox-dark'

/** Gruvbox dark is the default. */
export const THEMES: readonly Theme[] = [
  {
    id: 'gruvbox-dark', name: 'Gruvbox Dark', scheme: 'dark',
    palette: { bg: '#282828', bgDark: '#1d2021', fg: '#ebdbb2', fgBright: '#fbf1c7', yellow: '#fabd2f', green: '#b8bb26', red: '#fb4934', blue: '#83a598', orange: '#fe8019', purple: '#d3869b', toast: '#3c1f1c' },
    xterm: {
      background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selectionBackground: '#504945',
      black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
      brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2'
    }
  },
  {
    id: 'gruvbox-light', name: 'Gruvbox Light', scheme: 'light',
    palette: { bg: '#fbf1c7', bgDark: '#ebdbb2', fg: '#3c3836', fgBright: '#1d2021', yellow: '#b57614', green: '#79740e', red: '#9d0006', blue: '#076678', orange: '#af3a03', purple: '#8f3f71', toast: '#f2d5c4' },
    xterm: {
      background: '#fbf1c7', foreground: '#3c3836', cursor: '#3c3836', selectionBackground: '#d5c4a1',
      black: '#fbf1c7', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#7c6f64',
      brightBlack: '#928374', brightRed: '#9d0006', brightGreen: '#79740e', brightYellow: '#b57614', brightBlue: '#076678', brightMagenta: '#8f3f71', brightCyan: '#427b58', brightWhite: '#3c3836'
    }
  },
  {
    id: 'nord', name: 'Nord', scheme: 'dark',
    palette: { bg: '#2e3440', bgDark: '#242933', fg: '#d8dee9', fgBright: '#eceff4', yellow: '#ebcb8b', green: '#a3be8c', red: '#bf616a', blue: '#81a1c1', orange: '#d08770', purple: '#b48ead', toast: '#4a2f35' },
    xterm: {
      background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selectionBackground: '#434c5e',
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4'
    }
  },
  {
    id: 'dracula', name: 'Dracula', scheme: 'dark',
    palette: { bg: '#282a36', bgDark: '#1e1f29', fg: '#f8f8f2', fgBright: '#ffffff', yellow: '#f1fa8c', green: '#50fa7b', red: '#ff5555', blue: '#8be9fd', orange: '#ffb86c', purple: '#bd93f9', toast: '#4a2a30' },
    xterm: {
      background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a',
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff'
    }
  },
  {
    id: 'tokyo-night', name: 'Tokyo Night', scheme: 'dark',
    palette: { bg: '#1a1b26', bgDark: '#16161e', fg: '#c0caf5', fgBright: '#e5e9ff', yellow: '#e0af68', green: '#9ece6a', red: '#f7768e', blue: '#7aa2f7', orange: '#ff9e64', purple: '#bb9af7', toast: '#3b2230' },
    xterm: {
      background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', selectionBackground: '#33467c',
      black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
      brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5'
    }
  },
  {
    id: 'solarized-dark', name: 'Solarized Dark', scheme: 'dark',
    palette: { bg: '#002b36', bgDark: '#00212b', fg: '#93a1a1', fgBright: '#eee8d5', yellow: '#b58900', green: '#859900', red: '#dc322f', blue: '#268bd2', orange: '#cb4b16', purple: '#6c71c4', toast: '#3a2326' },
    xterm: {
      background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: '#073642',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3'
    }
  }
]

export const themeById = (id: string | null | undefined): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0]

/** `#ebdbb2` → `235 219 178`: what `rgb(var(--fg-rgb) / .1)` in app.css needs. */
export function rgbTriplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

const STORAGE_KEY = 'workdesk.theme'

export function storedThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

let current: Theme = THEMES[0]
const listeners = new Set<(t: Theme) => void>()

export const currentTheme = (): Theme => current

/** Terminals take the colours of the theme at once. */
export function onThemeChange(listener: (t: Theme) => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Put the theme on the page; with `remember` it is kept for the next start. */
export function applyTheme(id: string, remember = false): Theme {
  const theme = themeById(id)
  const root = document.documentElement
  const p = theme.palette
  const vars: Record<string, string> = {
    '--bg': p.bg, '--bg-dark': p.bgDark, '--fg': p.fg, '--fg-bright': p.fgBright,
    '--yellow': p.yellow, '--green': p.green, '--red': p.red, '--blue': p.blue, '--orange': p.orange, '--purple': p.purple, '--toast-bg': p.toast,
    '--fg-rgb': rgbTriplet(p.fg), '--yellow-rgb': rgbTriplet(p.yellow), '--green-rgb': rgbTriplet(p.green), '--red-rgb': rgbTriplet(p.red),
    '--blue-rgb': rgbTriplet(p.blue), '--orange-rgb': rgbTriplet(p.orange), '--purple-rgb': rgbTriplet(p.purple)
  }
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  root.style.setProperty('color-scheme', theme.scheme)
  current = theme
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, theme.id)
    } catch {
      // remembering is a convenience only
    }
  }
  listeners.forEach((l) => l(theme))
  return theme
}

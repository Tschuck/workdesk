import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

export interface CodeThemeInfo {
  /** `<extension folder>/<theme path>`: what `loadCodeTheme` takes */
  id: string
  label: string
  dark: boolean
}

export interface CodeThemes {
  themes: CodeThemeInfo[]
  /** the label of the theme your VS Code uses (workbench.colorTheme), when it is among them */
  current?: string
}

const EXTENSIONS = join(homedir(), '.vscode', 'extensions')
const SETTINGS = join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'settings.json')

/** JSON with comments and trailing commas, as VS Code's theme and settings files are. */
export function parseJsonc(text: string): unknown {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2)
      if (i === -1) break
      i++
    } else out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

async function readJsonc(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    return parseJsonc(await readFile(file, 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** The colour themes of the extensions installed in VS Code, and the one it uses. */
export async function listCodeThemes(extensions = EXTENSIONS, settings = SETTINGS): Promise<CodeThemes> {
  const themes: CodeThemeInfo[] = []
  let dirs: string[] = []
  try {
    dirs = await readdir(extensions)
  } catch {
    return { themes }
  }
  for (const dir of dirs.sort()) {
    const pkg = await readJsonc(join(extensions, dir, 'package.json'))
    const list = (pkg?.contributes as { themes?: { label?: string; uiTheme?: string; path?: string }[] } | undefined)?.themes
    for (const t of Array.isArray(list) ? list : []) {
      if (typeof t.label === 'string' && typeof t.path === 'string') themes.push({ id: `${dir}/${t.path.replace(/^\.\//, '')}`, label: t.label, dark: t.uiTheme !== 'vs' })
    }
  }
  const current = (await readJsonc(settings))?.['workbench.colorTheme']
  return { themes, current: typeof current === 'string' && themes.some((t) => t.label === current) ? current : undefined }
}

/** The theme file of one extension, with what it `include`s merged in (colours and token rules of the including file win). */
export async function loadCodeTheme(id: string, extensions = EXTENSIONS, depth = 0): Promise<Record<string, unknown>> {
  const file = resolve(extensions, id)
  if (!file.startsWith(resolve(extensions) + sep) || !file.endsWith('.json')) throw new Error('Not a theme of an installed extension')
  const theme = await readJsonc(file)
  if (!theme) throw new Error(`Cannot read the theme ${id}`)
  if (typeof theme.include === 'string' && depth < 3) {
    const base = await loadCodeTheme(join(id, '..', theme.include), extensions, depth + 1)
    return {
      ...base,
      ...theme,
      colors: { ...(base.colors as object), ...(theme.colors as object) },
      tokenColors: [...((base.tokenColors as unknown[]) ?? []), ...((theme.tokenColors as unknown[]) ?? [])]
    }
  }
  return theme
}

export interface EditorFont {
  fontFamily?: string
  fontSize?: number
  letterSpacing?: number
  /** as in VS Code: below 8 a multiple of the font size, else pixels */
  lineHeight?: number
  fontLigatures?: boolean
}

/** The font of the editor of your VS Code (its user settings), as far as it is set there. */
export async function readEditorFont(settings = SETTINGS): Promise<EditorFont> {
  const s = (await readJsonc(settings)) ?? {}
  const num = (k: string): number | undefined => (typeof s[k] === 'number' ? (s[k] as number) : undefined)
  const family = s['editor.fontFamily']
  const ligatures = s['editor.fontLigatures']
  return {
    ...(typeof family === 'string' && family.trim() ? { fontFamily: family.trim() } : {}),
    ...(num('editor.fontSize') ? { fontSize: num('editor.fontSize') } : {}),
    ...(num('editor.letterSpacing') !== undefined ? { letterSpacing: num('editor.letterSpacing') } : {}),
    ...(num('editor.lineHeight') ? { lineHeight: num('editor.lineHeight') } : {}),
    ...(typeof ligatures === 'boolean' ? { fontLigatures: ligatures } : {})
  }
}

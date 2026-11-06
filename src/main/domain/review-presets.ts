/**
 * A Review preset narrows which of the changed files a review shows. It is a set of path patterns (gitignore-like, see `matchesPattern`):
 * a file is in when it matches one of `include` or `files` (no include and no files: every file) and matches none of `exclude`.
 */
export interface ReviewPreset {
  id: string
  name: string
  /** what the preset is for, one line */
  description?: string
  include?: string[]
  exclude?: string[]
  /** exact paths, relative to the Branch folder */
  files?: string[]
  /** made for one WorkDesk (by the desk-review-preset skill); none: offered everywhere */
  deskId?: string
  /** comes with the app; cannot be removed */
  builtin?: boolean
}

export const WHOLE_REVIEW_ID = 'whole-review'

export const BUILTIN_PRESETS: readonly ReviewPreset[] = [
  { id: WHOLE_REVIEW_ID, name: 'Whole review', description: 'Every changed file', builtin: true },
  {
    id: 'without-tests',
    name: 'Without tests',
    description: 'Everything except tests, mocks, snapshots and test folders',
    exclude: ['*.test.*', '*.spec.*', '*.snap', '__tests__/', '__mocks__/', 'test/', 'tests/', 'e2e/', 'cypress/'],
    builtin: true
  }
]

const escape = (c: string): string => c.replace(/[.+^${}()|[\]\\]/g, '\\$&')

/** `**` crosses folders, `*` and `?` stay inside one. */
function globToSource(glob: string): string {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          out += '(?:.*/)?'
        } else out += '.*'
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else out += escape(c)
  }
  return out
}

const cache = new Map<string, RegExp | null>()

function compile(pattern: string): RegExp | null {
  const hit = cache.get(pattern)
  if (hit !== undefined) return hit
  let p = pattern.trim().replace(/^\.\//, '')
  let re: RegExp | null = null
  if (p) {
    const dirOnly = p.endsWith('/')
    if (dirOnly) p = p.slice(0, -1)
    // a pattern with a slash is anchored at the folder's root; without one it matches at any depth
    const anchored = p.startsWith('/') || p.includes('/')
    if (p.startsWith('/')) p = p.slice(1)
    const body = globToSource(p)
    re = new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}${dirOnly ? '/.*' : '(?:/.*)?'}$`)
  }
  cache.set(pattern, re)
  return re
}

/** Does the path (relative, `/`-separated) match the pattern? `*.test.*` any depth, `src/api/**` anchored, `test/` a folder anywhere. */
export function matchesPattern(path: string, pattern: string): boolean {
  return compile(pattern)?.test(path) ?? false
}

export function inPreset(path: string, preset: Pick<ReviewPreset, 'include' | 'exclude' | 'files'>): boolean {
  const include = preset.include ?? []
  const files = preset.files ?? []
  if (include.length + files.length > 0 && !(files.includes(path) || include.some((p) => matchesPattern(path, p)))) return false
  return !(preset.exclude ?? []).some((p) => matchesPattern(path, p))
}

/** The entries (anything with a `path`) that are in the preset. */
export const filterByPreset = <T extends { path: string }>(entries: readonly T[], preset: ReviewPreset | undefined): T[] =>
  preset ? entries.filter((e) => inPreset(e.path, preset)) : [...entries]

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const strings = (v: unknown): string[] | undefined => {
  const list = (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
  return list.length > 0 ? [...new Set(list)] : undefined
}

/** A preset from a command or a stored file; a name is needed, the id is made from it. The built-in ones cannot be replaced. */
export function makePreset(raw: { name?: unknown; description?: unknown; include?: unknown; exclude?: unknown; files?: unknown; deskId?: unknown }): ReviewPreset {
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) throw new Error('A preset needs a name')
  const id = slug(name)
  if (!id) throw new Error('A preset needs a name with letters or digits')
  if (BUILTIN_PRESETS.some((b) => b.id === id)) throw new Error(`"${name}" is a built-in preset; pick another name`)
  const include = strings(raw.include)
  const exclude = strings(raw.exclude)
  const files = strings(raw.files)
  if (!include && !exclude && !files) throw new Error('A preset needs something to include or exclude')
  const description = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : undefined
  const deskId = typeof raw.deskId === 'string' && raw.deskId ? raw.deskId : undefined
  return { id, name, ...(description ? { description } : {}), ...(include ? { include } : {}), ...(exclude ? { exclude } : {}), ...(files ? { files } : {}), ...(deskId ? { deskId } : {}) }
}

export function parseStoredPresets(text: string): ReviewPreset[] {
  try {
    const raw = JSON.parse(text) as unknown
    return (Array.isArray(raw) ? raw : []).flatMap((p) => {
      try {
        return [makePreset(p as Record<string, unknown>)]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

/** What a WorkDesk is offered: the built-in presets, then the ones for everywhere, then its own. */
export const presetsFor = (custom: readonly ReviewPreset[], deskId: string): ReviewPreset[] => [
  ...BUILTIN_PRESETS,
  ...custom.filter((p) => !p.deskId),
  ...custom.filter((p) => p.deskId === deskId)
]

/** Save a preset: the same name for the same WorkDesk is replaced. */
export const withPreset = (custom: readonly ReviewPreset[], preset: ReviewPreset): ReviewPreset[] => [
  ...custom.filter((p) => !(p.id === preset.id && p.deskId === preset.deskId)),
  preset
]

export const withoutPreset = (custom: readonly ReviewPreset[], id: string, deskId: string): ReviewPreset[] =>
  custom.filter((p) => !(p.id === id && (p.deskId === deskId || !p.deskId)))

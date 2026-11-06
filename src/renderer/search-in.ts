import type { FileRoot } from '../main/files'

/**
 * The folders a search looks in for what was typed in "Search in…": nothing typed is every root; a path that starts with a root's
 * name (`knowledge/sub`) is that folder of the root; a start of a root's name (`know`) is every root it fits; anything else is none.
 */
export function searchRoots(roots: FileRoot[], typed: string): FileRoot[] {
  const where = typed.trim().replace(/^\/+|\/+$/g, '')
  if (!where) return roots
  // the longest name wins (a root's name can have slashes: project/branch)
  const hit = [...roots].sort((a, b) => b.label.length - a.label.length).find((r) => where === r.label || where.startsWith(r.label + '/'))
  if (hit) {
    const rel = where.slice(hit.label.length + 1)
    if (rel.split('/').includes('..')) return []
    return [rel ? { ...hit, path: `${hit.path}/${rel}`, label: where } : hit]
  }
  return roots.filter((r) => r.label.toLowerCase().startsWith(where.toLowerCase()))
}

/** Every folder above the files of a root, as paths that start with the root's name. */
export function foldersOf(label: string, files: readonly string[]): string[] {
  const dirs = new Set<string>([label])
  for (const f of files) {
    const parts = f.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) dirs.add(`${label}/${parts.slice(0, i).join('/')}`)
  }
  return [...dirs].sort()
}

import { useEffect, useSyncExternalStore } from 'react'
import type { DeskFiles } from '../main/domain/search-all'
import { filterFiles } from './file-buffers'

/** One thing the command palette (Cmd+P) can do. */
export interface Command {
  id: string
  title: string
  /** what kind of thing it is, shown dimmed beside the title: "Go to", "Tab", "Favorite" */
  group: string
  /** a second dimmed piece, e.g. an address */
  hint?: string
  /** more words it is found by */
  keywords?: string
  run: () => void
}

const words = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean)
const subsequence = (text: string, word: string): boolean => {
  let at = 0
  for (const c of text) if (c === word[at] && ++at === word.length) return true
  return false
}

/** How well one typed word fits a command; undefined when it does not. A start of the title beats a word start beats anywhere beats scattered letters. */
function score(c: Command, word: string): number | undefined {
  const title = c.title.toLowerCase()
  if (title.startsWith(word)) return 4
  if (title.includes(' ' + word) || title.includes('/' + word)) return 3
  if (title.includes(word)) return 2
  if (`${c.group} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase().includes(word)) return 1.5
  return word.length > 2 && subsequence(title, word) ? 0.5 : undefined
}

/** The commands that fit what was typed (every word must), best first; equal fits keep their order. No words: all of them in order. */
export function rankCommands(list: readonly Command[], query: string): Command[] {
  const ws = words(query)
  if (ws.length === 0) return [...list]
  const scored: { c: Command; s: number; i: number }[] = []
  list.forEach((c, i) => {
    let total = 0
    for (const w of ws) {
      const s = score(c, w)
      if (s === undefined) return
      total += s
    }
    scored.push({ c, s: total, i })
  })
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c)
}

// The places that offer commands: the app (everywhere) and whatever is on screen (a WorkDesk, the Browser page)
let sources = new Map<string, Command[]>()
const listeners = new Set<() => void>()
let snapshot: Command[] = []

function publish(): void {
  snapshot = [...sources.values()].flat()
  listeners.forEach((l) => l())
}

/** Offers commands to the palette for as long as the caller is mounted; an empty list offers none. Sources come in the order they first appeared, so put what is local first. */
export function usePaletteCommands(source: string, commands: Command[]): void {
  useEffect(() => {
    // a later source goes first: what was opened last is what you are in
    sources = new Map([[source, commands], ...[...sources].filter(([k]) => k !== source)])
    publish()
  })
  useEffect(
    () => () => {
      sources.delete(source)
      publish()
    },
    [source]
  )
}

export function usePaletteList(): Command[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => snapshot
  )
}

/** Where a file typed into the palette is opened: in the WorkDesk on screen (its folders), or on the Files page. */
export interface FileOpener {
  /** the WorkDesk whose folders are searched, or the id of the Files page */
  deskId: string
  open: (path: string, line?: number) => void
}

const openers = new Map<string, { opener: FileOpener; priority: number }>()

/** Offers where files typed into the palette go, for as long as the caller is mounted and `opener` is set; the higher priority is the more local one. */
export function usePaletteFileOpener(source: string, opener: FileOpener | undefined, priority: number): void {
  useEffect(() => {
    if (opener) openers.set(source, { opener, priority })
    else openers.delete(source)
  })
  useEffect(() => () => void openers.delete(source), [source])
}

export const currentFileOpener = (): FileOpener | undefined => [...openers.values()].sort((a, b) => b.priority - a.priority)[0]?.opener

/** Something typed that is a path (`src/app/main.ts`, `main.ts:42`) rather than a command: one word with a slash or an extension. */
export function pathQuery(query: string): { path: string; line?: number } | undefined {
  const t = query.trim()
  if (!t || /\s/.test(t) || t.length < 3) return undefined
  const m = /^(.*?)(?::(\d+))?$/.exec(t)
  const path = m?.[1] ?? t
  if (!path.includes('/') && !/\.[a-z0-9]{1,8}$/i.test(path)) return undefined
  return { path, line: m?.[2] ? Number(m[2]) : undefined }
}

/** The files of the other WorkDesks that fit a typed path, as palette entries labelled with their WorkDesk (at most 8 per WorkDesk, 20 in all). `here` is the WorkDesk whose files are listed first already. */
export function otherDeskFileCommands(desks: readonly DeskFiles[], here: string | undefined, query: string, line: number | undefined, open: (deskId: string, path: string, line?: number) => void): Command[] {
  const out: Command[] = []
  for (const d of desks) {
    if (d.deskId === here) continue
    const found = d.roots.flatMap((r) => filterFiles(r.files, query).slice(0, 8).map((file) => ({ root: r, file })))
    for (const { root, file } of found.slice(0, 8)) {
      out.push({
        id: `file:${d.deskId}:${root.path}/${file}`,
        title: file.split('/').pop() ?? file,
        hint: `${root.label}/${file}`,
        group: d.deskName,
        run: () => open(d.deskId, `${root.path}/${file}`, line)
      })
    }
  }
  return out.slice(0, 20)
}

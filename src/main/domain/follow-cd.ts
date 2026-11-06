/**
 * Terminals follow `cd`: the folder a terminal is in right now (tmux `pane_current_path`) decides which branch group
 * its Tab is listed under, instead of the folder it started in. A Tab put under a branch by hand (`PaneTab.branch`)
 * stays there.
 */

/** The branch folder a path is in (the deepest one when branches are nested), or nothing. */
export function branchPathOf(branchRoots: readonly string[], abs: string | undefined): string | undefined {
  if (!abs) return undefined
  return branchRoots.filter((r) => abs === r || abs.startsWith(r + '/')).sort((a, b) => b.length - a.length)[0]
}

/** What the branch of a Pane is worked out from. */
export interface PaneWhere {
  id: string
  kind: 'terminal' | 'browser' | 'file'
  /** the folder a terminal started in */
  cwd?: string
  /** the path of a file */
  path?: string
}

/**
 * The branch a Tab is listed under: the one put there by hand (when it is still a branch of the WorkDesk), else the
 * branch every Pane that has one agrees on. A terminal counts with its live folder, when known.
 */
export function tabBranchPath(opts: { manual?: string; roots: readonly string[]; panes: readonly PaneWhere[]; live: Readonly<Record<string, string>> }): string | undefined {
  const { manual, roots, panes, live } = opts
  if (manual && roots.includes(manual)) return manual
  const found = new Set<string>()
  for (const p of panes) {
    const where = p.kind === 'terminal' ? (live[p.id] ?? p.cwd) : p.kind === 'file' ? p.path : undefined
    const b = branchPathOf(roots, where)
    if (b) found.add(b)
  }
  return found.size === 1 ? [...found][0] : undefined
}

/** WorkDesk id -> Pane id -> folder, for every terminal on the tmux server */
export type PaneCwds = Record<string, Record<string, string>>

/** `tmux list-panes -a -F '#{session_name}\t#{window_name}\t#{pane_current_path}'` as folders per WorkDesk (the hidden view sessions are skipped). */
export function parsePaneCwds(out: string): PaneCwds {
  const result: PaneCwds = {}
  for (const line of out.split('\n')) {
    const [session, window, path] = line.split('\t')
    if (!session?.startsWith('workdesk-') || session.startsWith('workdesk-view-') || !window || !path?.trim()) continue
    const desk = session.slice('workdesk-'.length)
    ;(result[desk] ??= {})[window] = path.trim()
  }
  return result
}

export function samePaneCwds(a: PaneCwds, b: PaneCwds): boolean {
  const da = Object.keys(a)
  if (da.length !== Object.keys(b).length) return false
  return da.every((d) => {
    const x = a[d]
    const y = b[d]
    if (!y) return false
    const ks = Object.keys(x)
    return ks.length === Object.keys(y).length && ks.every((k) => x[k] === y[k])
  })
}

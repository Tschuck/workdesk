/** Passive time tracking: seconds per WorkDesk per day, counted only for the WorkDesk on screen while the user is there. */

/** day (local `YYYY-MM-DD`) -> WorkDesk id -> seconds */
export type TimeLog = Record<string, Record<string, number>>

/** no input for this long: the user is away, nothing is counted */
export const IDLE_LIMIT_S = 5 * 60
/** a gap longer than this between two ticks (sleep, a stalled app) is not counted */
export const MAX_GAP_S = 90
export const KEEP_DAYS = 90

export const dayKey = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Is the user working in the WorkDesk on screen right now? Another window in front (a terminal, Slack) does not stop it: the user is still on the WorkDesk's topic. */
export function isWorking(s: { shownDesk?: string; idleSeconds: number; locked?: boolean }): boolean {
  return !!s.shownDesk && !s.locked && s.idleSeconds < IDLE_LIMIT_S
}

/** A WorkDesk is on screen and the user has not touched anything for the idle limit: the counting stopped, and they are told. */
export function isIdleOnDesk(s: { shownDesk?: string; idleSeconds: number; locked?: boolean }): boolean {
  return !!s.shownDesk && !s.locked && s.idleSeconds >= IDLE_LIMIT_S
}

/**
 * The WorkDesk a page of the Browser belongs to, by its address: a page attached to a WorkDesk, a pull request or ticket it holds, or a
 * pull request it reviews (also its sub-pages: `/pull/806/files`). Query and fragment do not count; none when no WorkDesk has it.
 */
export function deskOfPage(desks: readonly { id: string; refs?: readonly { url: string }[]; items?: readonly { url?: string }[]; reviews?: readonly { url: string }[] }[], url: string): string | undefined {
  const clean = (u: string): string => u.split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase()
  const page = clean(url)
  if (!/^https?:\/\//.test(page)) return undefined
  const owns = (known?: string): boolean => {
    if (!known) return false
    const k = clean(known)
    return k !== '' && (page === k || page.startsWith(k + '/'))
  }
  return desks.find((d) => [...(d.refs ?? []).map((r) => r.url), ...(d.items ?? []).map((i) => i.url), ...(d.reviews ?? []).map((r) => r.url)].some(owns))?.id
}

/**
 * The WorkDesk a folder or workspace file open in VS Code belongs to: one inside the WorkDesk's own folder (its `.code-workspace`) or inside
 * one of its Branch folders. Accepts a `file://` address or a path; none when no WorkDesk has it.
 */
export function deskOfEditorPath(desks: readonly { id: string; branches?: readonly { path: string }[] }[], deskDir: (id: string) => string, target: string): string | undefined {
  let path = target
  if (path.startsWith('file://')) {
    try {
      path = decodeURIComponent(new URL(path).pathname)
    } catch {
      return undefined
    }
  }
  const inside = (dir: string): boolean => dir !== '' && (path === dir || path.startsWith(dir.replace(/\/+$/, '') + '/'))
  return desks.find((d) => inside(deskDir(d.id)) || (d.branches ?? []).some((b) => inside(b.path)))?.id
}

/** The seconds a tick counts: the time since the last one, if it is not too long ago. */
export const tickSeconds = (lastMs: number | undefined, nowMs: number): number => {
  if (lastMs === undefined || nowMs <= lastMs) return 0
  const s = (nowMs - lastMs) / 1000
  return s > MAX_GAP_S ? 0 : s
}

export function addSeconds(log: TimeLog, deskId: string, nowMs: number, seconds: number): TimeLog {
  if (seconds <= 0) return log
  const day = dayKey(nowMs)
  return { ...log, [day]: { ...log[day], [deskId]: (log[day]?.[deskId] ?? 0) + seconds } }
}

/** Drops the days older than `keep` days. */
export function prune(log: TimeLog, nowMs: number, keep: number = KEEP_DAYS): TimeLog {
  const first = dayKey(nowMs - keep * 86_400_000)
  return Object.fromEntries(Object.entries(log).filter(([day]) => day >= first))
}

/** The time of a WorkDesk that went into another one: it counts for that one, day by day. */
export function mergeDeskTime(log: TimeLog, from: string, to: string): TimeLog {
  if (from === to) return log
  const out: TimeLog = {}
  for (const [day, per] of Object.entries(log)) {
    if (!(from in per)) {
      out[day] = per
      continue
    }
    const { [from]: seconds, ...rest } = per
    out[day] = { ...rest, [to]: (rest[to] ?? 0) + seconds }
  }
  return out
}

export interface DaySummary {
  day: string
  total: number
  /** longest first; WorkDesks that are gone are left out of the list but stay in the total */
  entries: { deskId: string; name: string; seconds: number }[]
}

export function daySummary(log: TimeLog, day: string, names: Readonly<Record<string, string>>, onlyListed = false): DaySummary {
  const per = log[day] ?? {}
  const entries = Object.entries(per)
    .filter(([id]) => id in names)
    .map(([deskId, seconds]) => ({ deskId, name: names[deskId], seconds }))
    .sort((a, b) => b.seconds - a.seconds)
  // time of WorkDesks that are cleared belongs to no Profile: a view of one Profile counts only the ones it lists
  const total = onlyListed ? entries.reduce((a, e) => a + e.seconds, 0) : Object.values(per).reduce((a, b) => a + b, 0)
  return { day, total, entries }
}

/** Seconds of one WorkDesk for the last `days` days (today first). */
export function deskDays(log: TimeLog, deskId: string, nowMs: number, days: number): { day: string; seconds: number }[] {
  return Array.from({ length: days }, (_, i) => {
    const day = dayKey(nowMs - i * 86_400_000)
    return { day, seconds: log[day]?.[deskId] ?? 0 }
  })
}

/** `1 h 05 min`, `12 min`, `< 1 min`, `0 min` */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0 min'
  const min = Math.floor(seconds / 60)
  if (min < 1) return '< 1 min'
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}

/** The seven days of a week as `YYYY-MM-DD`, Monday first; `offset` 0 is the week of `nowMs`, -1 the one before. */
export function weekDays(nowMs: number, offset = 0): string[] {
  const d = new Date(nowMs)
  const sinceMonday = (d.getDay() + 6) % 7
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMonday + offset * 7 + i, 12)
    return dayKey(day.getTime())
  })
}

/** The ISO week number of a date (weeks start on Monday, week 1 holds the first Thursday of the year). */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7)
}

export interface WeekSummary {
  days: { day: string; seconds: number }[]
  total: number
  /** longest first; each with its seconds per day of the week */
  rows: { deskId: string; name: string; perDay: number[]; seconds: number }[]
  /** time of WorkDesks that are cleared (no name any more); left out when only the listed WorkDesks are counted */
  cleared: number
}

/** A week: the time per day and per WorkDesk. `onlyListed`: a view of one Profile counts only the WorkDesks it lists. */
export function weekSummary(log: TimeLog, days: readonly string[], names: Readonly<Record<string, string>>, onlyListed = false): WeekSummary {
  const per = new Map<string, number[]>()
  let cleared = 0
  const dayTotals = days.map(() => 0)
  days.forEach((day, i) => {
    for (const [id, secs] of Object.entries(log[day] ?? {})) {
      if (!(id in names)) {
        if (!onlyListed) (cleared += secs), (dayTotals[i] += secs)
        continue
      }
      const row = per.get(id) ?? days.map(() => 0)
      row[i] += secs
      per.set(id, row)
      dayTotals[i] += secs
    }
  })
  const rows = [...per].map(([deskId, perDay]) => ({ deskId, name: names[deskId], perDay, seconds: perDay.reduce((a, b) => a + b, 0) })).sort((a, b) => b.seconds - a.seconds)
  return { days: days.map((day, i) => ({ day, seconds: dayTotals[i] })), total: dayTotals.reduce((a, b) => a + b, 0), rows, cleared }
}

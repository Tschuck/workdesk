import { useCallback, useEffect, useState } from 'react'
import type { SkillStatus } from '../main/claude/skills'
import { cleanError } from './ProfilesSettings'

/** Skills for Claude Code inside a WorkDesk (open, close, review, …): copied into the `skills` folder of a Claude config directory. */
export function SkillsPanel({ dirs }: { dirs: string[] }) {
  const [skills, setSkills] = useState<Record<string, SkillStatus[]>>({})
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    const entries = await Promise.all(dirs.map(async (d) => [d, await window.workdesk.claudeSkills(d)] as const))
    setSkills(Object.fromEntries(entries))
  }, [dirs.join('\u0000')])
  useEffect(() => void load().catch((e) => setError(cleanError(e))), [load])

  const act = async (dir: string, call: (p: string) => Promise<SkillStatus[]>) => {
    setBusy(dir)
    setError(undefined)
    try {
      const next = await call(dir)
      setSkills((s) => ({ ...s, [dir]: next }))
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(undefined)
    }
  }
  const api = window.workdesk
  const first = Object.values(skills)[0] ?? []

  return (
    <div className="panel">
      <div className="page-head"><h3>Skills</h3></div>
      <p className="hint">
        Skills for Claude Code in your WorkDesks: open, park or clear a WorkDesk, add a branch, review its branches, keep its Todos, report where you stand, answer review comments, open a pull request and write a handoff. They use the <code>workdesk</code> command the terminals of a WorkDesk know. Installing copies them into the <code>skills</code> folder of the configuration directory; your own skills there stay untouched, and Remove deletes exactly these.
      </p>
      {error && <div className="error" onClick={() => setError(undefined)}>{error}</div>}
      <ul className="todos">
        {dirs.map((d) => {
          const list = skills[d] ?? []
          const have = list.filter((s) => s.state === 'installed').length
          const outdated = list.filter((s) => s.state === 'outdated').length
          const any = list.some((s) => s.state !== 'missing')
          return (
            <li key={d}>
              <span className="title">{d}</span>
              <span className={have === list.length && list.length > 0 ? 'badge' : 'chip small'}>
                {have}/{list.length} installed{outdated ? `, ${outdated} to update` : ''}
              </span>
              <span className="actions">
                <button disabled={busy === d || (have === list.length && list.length > 0)} onClick={() => void act(d, api.claudeSkillsInstall)}>{any ? 'Update skills' : 'Install skills'}</button>
                {any && <button disabled={busy === d} onClick={() => void act(d, api.claudeSkillsUninstall)}>Remove skills</button>}
              </span>
            </li>
          )
        })}
        {dirs.length === 0 && <li className="empty">Register a Claude config directory above first.</li>}
      </ul>
      {first.length > 0 && (
        <ul className="skill-list">
          {first.map((s) => (
            <li key={s.name}><code>{s.name}</code> <span className="hint">{s.description}</span></li>
          ))}
        </ul>
      )}
    </div>
  )
}

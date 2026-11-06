import { useEffect, useState } from 'react'
import { REPEATS } from '../main/domain/recurrence'
import type { Schedule } from '../main/domain/schedule'
import { useTemplates } from './TemplatesSettings'
import { Field, Modal, PageHead } from './Modal'
import './desk-todos.css'

type Repeat = Schedule['repeat']

const when = (ms: number): string => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

/** Repeating WorkDesks: a schedule makes a planned WorkDesk from a template when it is time and none from it is open. */
export function RepeatingDesks() {
  const api = window.workdesk
  const [list, setList] = useState<Schedule[]>([])
  const [error, setError] = useState<string>()
  const templates = useTemplates()
  const [picked, setPicked] = useState<string>()
  const templateId = picked ?? templates[0]?.id ?? ''
  const [name, setName] = useState('')
  const [repeat, setRepeat] = useState<Repeat>('weekly')
  const [time, setTime] = useState('09:00')
  const [adding, setAdding] = useState(false)
  useEffect(() => void api.schedulesList().then(setList), [api])

  const act = async (action: () => Promise<Schedule[]>): Promise<boolean> => {
    try {
      setList(await action())
      setError(undefined)
      return true
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      return false
    }
  }

  return (
    <section>
      <PageHead title="Repeating WorkDesks" addLabel="Add a repeating WorkDesk" onAdd={() => (setError(undefined), setAdding(true))} />
      <p className="hint">
        A schedule is not a copy: when its time has come and no WorkDesk from it is open (planned, running or parked; a cleared one is gone), it plans a new WorkDesk from the template. Nothing is started, you get a notification.
        If the app was closed over several runs, you get one WorkDesk, not several. The schedules are kept in the Status Repo (<code>schedules.json</code>).
      </p>
      {adding && (
        <Modal
          title="Repeat a WorkDesk"
          submitLabel="Repeat"
          error={error}
          canSubmit={!!name.trim() && !!templateId}
          onClose={() => setAdding(false)}
          onSubmit={() => void act(() => api.scheduleAdd({ templateId, name, repeat, time })).then((ok) => ok && (setName(''), setAdding(false)))}
        >
          <Field label="Template"><select value={templateId} onChange={(e) => setPicked(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field label="Name of the WorkDesks"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Repeat"><select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>{REPEATS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></Field>
          <Field label="Time of day"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </Modal>
      )}
      {error && !adding && <p className="error">{error}</p>}
      <ul className="schedule-list">
        {list.map((s) => (
          <li key={s.id} className={s.paused ? 'paused' : ''}>
            <span className="schedule-name"><strong>{s.name}</strong> · {templates.find((t) => t.id === s.templateId)?.name ?? 'deleted template'} · {REPEATS.find((r) => r.value === s.repeat)?.label} at {s.time}</span>
            {s.pausedReason && (
              <select value="" aria-label="Choose another template" onChange={(e) => e.target.value && void act(() => api.scheduleTemplate(s.id, e.target.value))}>
                <option value="">choose another template…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            <span className="hint">{s.paused ? `paused${s.pausedReason ? `: ${s.pausedReason}` : ''}` : `next ${when(s.nextAt)}`}</span>
            <button onClick={() => void act(() => api.schedulePause(s.id, !s.paused))}>{s.paused ? 'Resume' : 'Pause'}</button>
            <button className="danger" title="The WorkDesks it made stay" onClick={() => void act(() => api.scheduleDelete(s.id))}>Delete</button>
          </li>
        ))}
        {list.length === 0 && <li className="empty">No repeating WorkDesks yet.</li>}
      </ul>
    </section>
  )
}

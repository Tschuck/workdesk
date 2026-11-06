import { useEffect, useState } from 'react'
import { stageLabel, STAGES } from '../main/domain/stage'
import type { DeskTemplate } from '../main/domain/templates'
import type { Stage } from '../main/domain/types'
import './desk-todos.css'

/** Tell the rest of the app (the palette) that the list of templates changed. */
export const TEMPLATES_CHANGED = 'workdesk-templates-changed'
export const announceTemplates = (): void => {
  window.dispatchEvent(new Event(TEMPLATES_CHANGED))
}

/** The list of templates for a palette or a form; reads again when they change. */
export function useTemplates(): DeskTemplate[] {
  const [list, setList] = useState<DeskTemplate[]>([])
  useEffect(() => {
    const load = () => void window.workdesk.templatesList().then(setList, () => undefined)
    load()
    window.addEventListener(TEMPLATES_CHANGED, load)
    return () => window.removeEventListener(TEMPLATES_CHANGED, load)
  }, [])
  return list
}

const paneSummary = (t: DeskTemplate): string => {
  const kinds = t.panes.join(' + ')
  return t.tabs && t.tabs.length > 1 ? `${t.tabs.length} tabs, first: ${kinds}` : kinds
}

/** Settings → Templates: the built-in templates (duplicate only) and your own (rename, Stage, Todos, order, duplicate, delete). */
export function TemplatesSettings() {
  const api = window.workdesk
  const list = useTemplates()
  const [error, setError] = useState<string>()
  const [confirming, setConfirming] = useState<string>()
  const act = async (action: () => Promise<unknown>) => {
    try {
      await action()
      setError(undefined)
      announceTemplates()
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  return (
    <section>
      <h2>Templates</h2>
      <p className="hint">
        A template is a preset for a new WorkDesk: its Stage, a checklist of Todos and the Tabs with their Panes. Save one from a WorkDesk (right-click it in the left panel → <em>Save as template…</em>), start one from the command palette, or repeat one under <em>Repeating WorkDesks</em>.
        Yours are kept in the Status Repo (<code>templates.json</code>). The built-in ones cannot be changed, only duplicated.
      </p>
      {error && <p className="error">{error}</p>}
      <ul className="template-list">
        {list.map((t, i) => {
          const mineIndex = list.filter((x) => !x.builtin).findIndex((x) => x.id === t.id)
          const mineCount = list.filter((x) => !x.builtin).length
          return (
            <li key={t.id + (t.builtin ? '' : t.name)} className="template-row">
              <div className="template-head">
                {t.builtin ? <strong>{t.name}</strong> : <input className="template-name" defaultValue={t.name} aria-label="Name" onBlur={(e) => e.target.value !== t.name && void act(() => api.templateEdit(t.id, { name: e.target.value }))} />}
                {t.builtin && <span className="chip small">built-in</span>}
                <span className="hint">{paneSummary(t)}</span>
                <span className="grow" />
                {!t.builtin && <button disabled={mineIndex === 0} title="Move up" onClick={() => void act(() => api.templateMove(t.id, -1))}>↑</button>}
                {!t.builtin && <button disabled={mineIndex === mineCount - 1} title="Move down" onClick={() => void act(() => api.templateMove(t.id, 1))}>↓</button>}
                <button onClick={() => void act(() => api.templateDuplicate(t.id))}>Duplicate</button>
                {!t.builtin && (confirming === t.id ? (
                  <>
                    <button className="danger" onClick={() => (setConfirming(undefined), void act(() => api.templateDelete(t.id)))}>Delete for good</button>
                    <button onClick={() => setConfirming(undefined)}>Keep</button>
                  </>
                ) : (
                  <button className="danger" onClick={() => setConfirming(t.id)}>Delete</button>
                ))}
              </div>
              <div className="template-body">
                <label className="field inline">
                  <span>Stage</span>
                  <select disabled={!!t.builtin} value={t.stage} onChange={(e) => void act(() => api.templateEdit(t.id, { stage: e.target.value as Stage }))}>
                    {STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Todos (one per line)</span>
                  <textarea
                    key={t.todos.join('\n')}
                    readOnly={!!t.builtin}
                    rows={Math.min(8, Math.max(3, t.todos.length + 1))}
                    defaultValue={t.todos.join('\n')}
                    onBlur={(e) => {
                      const todos = e.target.value.split('\n')
                      if (todos.map((x) => x.trim()).filter(Boolean).join('\n') !== t.todos.join('\n')) void act(() => api.templateEdit(t.id, { todos }))
                    }}
                  />
                </label>
              </div>
              {i === list.length - 1 && list.every((x) => x.builtin) && <p className="hint">No templates of your own yet.</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

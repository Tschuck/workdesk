import { setDeskTabsPosition, useDeskTabsOverride, useDeskTabsPosition, type TabsPosition } from './tabs-layout'
import { useEffect, useState } from 'react'
import type { AppState } from '../shared/api'
import { useAccounts } from './accounts'
import { stageLabel, STAGES } from '../main/domain/stage'
import type { Stage, WorkDesk } from '../main/domain/types'


interface Props {
  desk: WorkDesk
  run: (action: () => Promise<AppState>) => Promise<void>
  onClose: () => void
}

/** Settings of one WorkDesk: its name and its Stage. (Park, Clear and the .env actions are next to the title.) */
export function DeskSettings({ desk, run, onClose }: Props) {
  const api = window.workdesk
  const [name, setName] = useState(desk.name)
  useEffect(() => setName(desk.name), [desk.name])
  const accounts = useAccounts()
  const override = useDeskTabsOverride(desk.id)
  const tabsPos = useDeskTabsPosition(desk.id)

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide desk-settings" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>WorkDesk settings</h3>

        <label className="field">
          <span>Name</span>
          <input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== desk.name && void run(() => api.renameDesk(desk.id, name.trim()))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>

        <div className="detail-row">
          <label className="field inline">
            <span>Stage</span>
            <select
              value={desk.stageOverridden ? desk.stage : 'auto'}
              onChange={(e) => void run(() => api.setDeskStage(desk.id, e.target.value as Stage | 'auto'))}
              title="Set by hand, or let the tool work it out where it can"
            >
              <option value="auto">{(desk.reviews ?? []).length > 0 ? `automatic (${stageLabel(desk.stage)})` : `${stageLabel(desk.stage)} (not set by hand)`}</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>{stageLabel(s)}</option>
              ))}
            </select>
          </label>
          <span className="chip small" title="Whether it runs">{desk.presence}</span>
        </div>

        <label className="field inline" title="Where the tabs of this WorkDesk are. Kept on this machine.">
          <span>Tabs</span>
          <select value={override ?? 'default'} onChange={(e) => setDeskTabsPosition(desk.id, e.target.value === 'default' ? undefined : (e.target.value as TabsPosition))}>
            <option value="default">like all WorkDesks (Settings → Tabs)</option>
            <option value="top">in a row on top</option>
            <option value="left">a list at the left</option>
            <option value="right">a list at the right</option>
          </select>
        </label>

        <label className="field inline" title="The list of tabs shows one run per branch, under a heading of the branch. Only for a WorkDesk with more than one branch.">
          <input
            type="checkbox"
            checked={!!desk.groupTabsByBranch}
            disabled={desk.branches.length < 2 && !desk.groupTabsByBranch}
            onChange={(e) => void run(() => api.setDeskGroupByBranch(desk.id, e.target.checked))}
          />
          <span>Group the tabs by branch{desk.branches.length < 2 ? ' (needs more than one branch)' : ''}</span>
        </label>
        {tabsPos === 'top' && <p className="hint">Grouping shows in a list of tabs at the side, not in a row on top: choose “a list at the left” or “at the right” under Tabs above to see it.</p>}

        {accounts && accounts.accounts.length > 1 && (
          <label className="field" title="New terminals of this WorkDesk start with CLAUDE_CONFIG_DIR of this Account, so `claude` in them uses its login. Terminals that are already open keep theirs.">
            <span>Claude Account</span>
            <select
              value={desk.claudeAccountId && accounts.accounts.some((a) => a.account.id === desk.claudeAccountId) ? desk.claudeAccountId : ''}
              onChange={(e) => void run(() => api.setDeskClaudeAccount(desk.id, e.target.value || null))}
            >
              <option value="">default ({accounts.accounts.find((a) => a.isDefault)?.account.name})</option>
              {accounts.accounts.map((a) => <option key={a.account.id} value={a.account.id}>{a.account.name}</option>)}
            </select>
          </label>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

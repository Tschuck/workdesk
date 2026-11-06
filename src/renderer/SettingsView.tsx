import { applyTheme, currentTheme, THEMES } from './theme'
import { useEffect, useState } from 'react'
import type { CodeThemes, EditorFont } from '../main/vscode-themes'
import { APP_CODE_THEME, chooseCodeFont, chooseCodeTheme, fontFromVscode, resolveCodeTheme } from './code-theme'
import { setTabsPosition, useTabsPosition, type TabsArea, type TabsPosition } from './tabs-layout'
import { setWaitingPolicy, useWaitingPolicy, type WaitingPolicy } from './waiting-policy'
import { ClaudeView } from './ClaudeView'
import { GithubSettings } from './GithubSettings'
import { GitHostsSettings, ProviderConnection } from './ProviderSettings'
import { NotionSettings } from './NotionSettings'
import { ProjectsView } from './ProjectsView'
import { BrowserSessionsPanel, SitePermissionsPanel, TrackerBlockingPanel } from './BrowserSessionsPanel'
import { DefaultBrowserPanel } from './DefaultBrowserPanel'
import { HistoryPanel } from './HistoryPanel'
import { HistoryOverview } from './HistoryOverview'
import { FavoritesSettings, SearchEnginesPanel } from './FavoritesSettings'
import { ExtensionsPanel } from './ExtensionsPanel'
import { AutoHibernatePanel } from './AutoHibernatePanel'
import { StatusReposSettings } from './StatusReposSettings'
import { ProfilesSettings, useProfilesState } from './ProfilesSettings'
import { ShortcutsPanel } from './ShortcutsPanel'
import { requestProfilesDialog } from './profiles-request'
import { ProfileDetail } from './ProfileDetail'
import { cssColor } from '../main/domain/profiles'
import { BlockedSitesPanel } from './BlockedSitesPanel'
import { RepeatingDesks } from './RepeatingDesks'
import { TemplatesSettings } from './TemplatesSettings'

export type SettingsSection = 'appearance' | 'behavior' | 'projects' | 'github' | 'gitlab' | 'jira' | 'git-hosts' | 'notion' | 'claude' | 'browser' | 'browser-search' | 'browser-favorites' | 'browser-history' | 'browser-sessions' | 'browser-blocked' | 'browser-security' | 'extensions' | 'shortcuts' | 'repeating' | 'templates' | 'backup' | 'profiles' | 'profile'

const PROFILES_GROUP = 'Profiles'
const PROFILE_GROUP = 'Profile settings'

export const SECTIONS: { id: SettingsSection; label: string; group: string }[] = [
  // what does not depend on the Profile in view
  { id: 'appearance', label: 'Appearance', group: '' },
  { id: 'behavior', label: 'Behavior', group: '' },
  { id: 'shortcuts', label: 'Shortcuts', group: '' },
  { id: 'templates', label: 'Templates', group: '' },
  { id: 'repeating', label: 'Repeating WorkDesks', group: '' },
  { id: 'backup', label: 'Status Repos', group: '' },
  { id: 'claude', label: 'Claude', group: '' },
  { id: 'browser', label: 'General', group: 'Browser' },
  { id: 'browser-search', label: 'Search engines', group: 'Browser' },
  { id: 'browser-favorites', label: 'Favorites', group: 'Browser' },
  { id: 'browser-history', label: 'History', group: 'Browser' },
  { id: 'browser-sessions', label: 'Sessions', group: 'Browser' },
  { id: 'browser-blocked', label: 'Blocked sites', group: 'Browser' },
  { id: 'browser-security', label: 'Security', group: 'Browser' },
  { id: 'extensions', label: 'Extensions', group: 'Browser' },
  // the Profiles themselves, then what belongs to the Profile in view (its Projects and logins)
  { id: 'profiles', label: 'Profiles', group: PROFILES_GROUP },
  { id: 'profile', label: 'Details', group: PROFILE_GROUP },
  { id: 'projects', label: 'Projects', group: PROFILE_GROUP },
  { id: 'github', label: 'GitHub', group: PROFILE_GROUP },
  { id: 'gitlab', label: 'GitLab (untested)', group: PROFILE_GROUP },
  { id: 'jira', label: 'Jira (untested)', group: PROFILE_GROUP },
  { id: 'git-hosts', label: 'Git hosts', group: PROFILE_GROUP },
  { id: 'notion', label: 'Notion', group: PROFILE_GROUP }
]

/** One page of the Browser settings (each is an entry of the navigation): the default browser, search engines, favorites, history, sessions, and what pages may do or see. */
function BrowserSettings({ section }: { section: SettingsSection }) {
  return (
    <>
      {section === 'browser' && (
        <>
          <DefaultBrowserPanel />
          <AutoHibernatePanel />
        </>
      )}
      {section === 'browser-search' && <SearchEnginesPanel />}
      {section === 'browser-blocked' && <BlockedSitesPanel />}
      {section === 'browser-favorites' && <FavoritesSettings />}
      {section === 'browser-history' && <HistoryOverview />}
      {section === 'browser-sessions' && <BrowserSessionsPanel />}
      {section === 'browser-security' && (
        <>
          <TrackerBlockingPanel />
          <HistoryPanel />
          <SitePermissionsPanel />
        </>
      )}
    </>
  )
}

const TAB_AREAS: { id: TabsArea; label: string }[] = [
  { id: 'browser', label: 'Browser' },
  { id: 'desks', label: 'WorkDesks' },
  { id: 'files', label: 'Files' }
]
const TAB_POSITIONS: { id: TabsPosition; label: string }[] = [
  { id: 'top', label: 'On top' },
  { id: 'left', label: 'List on the left' },
  { id: 'right', label: 'List on the right' }
]

/** One place's choice: its tabs as a row on top, or as a list at one side. */
function TabsPositionRow({ area, label }: { area: TabsArea; label: string }) {
  const position = useTabsPosition(area)
  return (
    <div className="tabs-setting" role="radiogroup" aria-label={`Tabs of ${label}`}>
      <strong>{label}</strong>
      {TAB_POSITIONS.map((o) => (
        <label key={o.id} className={position === o.id ? 'selected' : ''}>
          <input type="radio" name={`tabs-${area}`} checked={position === o.id} onChange={() => setTabsPosition(area, o.id)} />
          {o.label}
        </label>
      ))}
    </div>
  )
}

/** Settings → Behavior: how the app acts rather than how it looks. */
function Behavior() {
  return (
    <section>
      <h2>Behavior</h2>
      <QuitSetting />
      <WaitingSetting />
    </section>
  )
}

/** What happens to a running WorkDesk that moves to Waiting (a waiting Stage, nothing that needs you). */
function WaitingSetting() {
  const value = useWaitingPolicy()
  const options: { id: WaitingPolicy; label: string; hint: string }[] = [
    { id: 'ask', label: 'Ask me', hint: 'A question each time: park it, or keep it active.' },
    { id: 'park', label: 'Park it', hint: 'Shuts its terminals and editor window down to free memory. Asks anyway when a program (a dev server, Claude) is running in it.' },
    { id: 'keep', label: 'Keep it active', hint: 'Nothing happens; it is only listed under Waiting.' }
  ]
  return (
    <>
      <h3>When a WorkDesk moves to Waiting</h3>
      <div className="quit-setting">
        {options.map((o) => (
          <label key={o.id} className="check" title={o.hint}>
            <input type="radio" name="waiting-policy" checked={value === o.id} onChange={() => setWaitingPolicy(o.id)} /> {o.label} <span className="hint">{o.hint}</span>
          </label>
        ))}
      </div>
    </>
  )
}

/** What happens to the terminals when WorkDesk quits (the same choice as the WorkDesk menu and the question's "remember"). */
function QuitSetting() {
  const api = window.workdesk
  const [value, setValue] = useState<'ask' | 'keep' | 'stop'>()
  useEffect(() => void api.quitGet().then(setValue), [api])
  const options = [
    { id: 'ask', label: 'Ask me', hint: 'A question when terminals are running (nothing is asked when none are open).' },
    { id: 'keep', label: 'Keep terminals running', hint: 'They go on in the background, so Claude can finish; open WorkDesk again to continue.' },
    { id: 'stop', label: 'Stop terminals', hint: 'Ends every shell and everything running in it.' }
  ] as const
  return (
    <>
      <h3>When quitting</h3>
      <div className="quit-setting">
        {options.map((o) => (
          <label key={o.id} className="check" title={o.hint}>
            <input type="radio" name="quit-behavior" checked={value === o.id} onChange={() => void api.quitSet(o.id).then(setValue)} /> {o.label} <span className="hint">{o.hint}</span>
          </label>
        ))}
      </div>
    </>
  )
}

/** The colour theme of the app and its terminals, and where the tabs are; the choices are kept for the next start. */
function Appearance() {
  const [id, setId] = useState(() => currentTheme().id)
  return (
    <section>
      <h2>Appearance</h2>
      <h2>Tabs</h2>
      <p className="hint">Where the tabs are, for each place on its own: a row on top (as in a browser), or a list at the left or the right of the content (it fits many tabs and long titles). Kept on this machine.</p>
      <div className="tabs-settings">
        {TAB_AREAS.map((a) => (
          <TabsPositionRow key={a.id} area={a.id} label={a.label} />
        ))}
      </div>
      <h2 className="settings-sub">Colours</h2>
      <p className="hint">The colours of the app and of its terminals. Gruvbox Dark is the default.</p>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button key={t.id} className={'theme-card' + (t.id === id ? ' on' : '')} onClick={() => setId(applyTheme(t.id, true).id)}>
            <span className="theme-swatch" style={{ background: t.palette.bg, borderColor: t.palette.fg + '55' }}>
              {[t.palette.fgBright, t.palette.yellow, t.palette.green, t.palette.red, t.palette.blue, t.palette.purple].map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            <span className="theme-name">{t.name}</span>
          </button>
        ))}
      </div>
      <CodeTheme />
    </section>
  )
}

/** The colours of the editor of a File pane: those of the app, or a theme of an extension installed in VS Code. */
function CodeTheme() {
  const [list, setList] = useState<CodeThemes>()
  const [id, setId] = useState<string>()
  const [font, setFont] = useState<EditorFont>()
  const [vsFont, setVsFont] = useState(fontFromVscode)
  useEffect(() => {
    void window.workdesk.codeFont().then(setFont, () => setFont({}))
    void window.workdesk.codeThemes().then(setList, () => setList({ themes: [] }))
    void resolveCodeTheme().then(setId)
  }, [])
  return (
    <>
      <h2 className="settings-sub">Code colours</h2>
      <p className="hint">The colours of the editor in a File pane. Take the colours of the app, or a theme of an extension installed in your VS Code (the one it uses is marked). The editor knows fewer kinds of words than VS Code does, so it looks close but not the same.</p>
      <select
        value={id ?? APP_CODE_THEME}
        onChange={(e) => (setId(e.target.value), chooseCodeTheme(e.target.value))}
      >
        <option value={APP_CODE_THEME}>The colours of the app</option>
        {(list?.themes ?? []).map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}{t.label === list?.current ? ' (used by VS Code)' : ''}
          </option>
        ))}
      </select>
      {list && list.themes.length === 0 && <p className="hint">No theme found in ~/.vscode/extensions.</p>}
      <label className="field inline" title="The font family, size, letter spacing and line height of the editor in your VS Code">
        <input type="checkbox" checked={vsFont} disabled={!font?.fontFamily && !font?.fontSize} onChange={(e) => (setVsFont(e.target.checked), chooseCodeFont(e.target.checked))} />
        <span>
          Use the font of my VS Code
          {font && (font.fontFamily || font.fontSize) ? ` (${[font.fontFamily, font.fontSize && `${font.fontSize} px`, font.letterSpacing && `spacing ${font.letterSpacing}`, font.lineHeight && `line height ${font.lineHeight}`].filter(Boolean).join(', ')})` : ' (nothing set there)'}
        </span>
      </label>
    </>
  )
}

/** Everything that is set up once and rarely changed: look, Projects, Claude, the Browser, where the data is backed up. Sections are listed on the left. */
export function SettingsView({ section, onSection }: { section: SettingsSection; onSection: (s: SettingsSection) => void }) {
  const api = window.workdesk
  const { state: profiles } = useProfilesState()
  const config = profiles?.config
  const active = config?.profiles.find((p) => p.id === config.active)
  const groups = [...new Set(SECTIONS.map((s) => s.group))]
  const items = (g: string) =>
    SECTIONS.filter((s) => s.group === g).map((s) => (
      <button key={s.id} className={s.id === section ? 'active' : ''} onClick={() => onSection(s.id)}>{s.label}</button>
    ))
  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings">
        <strong>Settings</strong>
        {groups.map((g) =>
          g === PROFILES_GROUP ? (
            <div key={g} className="settings-group">
              <span className="settings-group-name settings-group-head">
                {g}
                <button className="settings-group-add" title="Add a Profile" aria-label="Add a Profile" onClick={() => (onSection('profiles'), requestProfilesDialog({ add: true }))}>+</button>
              </span>
              <button className={section === 'profiles' ? 'active' : ''} onClick={() => onSection('profiles')}>All Profiles</button>
              {(config?.profiles ?? []).map((p) => (
                <button key={p.id} className="settings-profile" title={`${p.name}: its details, Status Repo, Claude Account, logins`} onClick={() => (void api.profilesSetActive(p.id), onSection('profile'))}>
                  <span className="profile-dot" style={{ background: cssColor(p.color) }} />
                  {p.name}
                </button>
              ))}
            </div>
          ) : g === PROFILE_GROUP ? (
            <div key={g} className="settings-group">
              <span className="settings-group-name">Settings of the Profile</span>
              <select
                className="settings-profile-select"
                aria-label="The Profile whose settings are shown"
                title="The Profile in view: its Projects and logins are what the pages below show"
                value={active?.id ?? ''}
                onChange={(e) => e.target.value && void api.profilesSetActive(e.target.value)}
              >
                {(config?.profiles ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {items(g)}
            </div>
          ) : (
            <div key={g} className="settings-group">
              <span className="settings-group-name">{g || 'WorkDesk'}</span>
              {items(g)}
            </div>
          )
        )}
      </nav>
      <div className="settings-body">
        {section === 'appearance' && <Appearance />}
        {section === 'behavior' && <Behavior />}
        {section === 'profiles' && <ProfilesSettings onOpenProfile={(id) => (void api.profilesSetActive(id), onSection('profile'))} />}
        {section === 'profile' && <ProfileDetail />}
        {section === 'projects' && <ProjectsView />}
        {section === 'github' && <GithubSettings />}
        {section === 'gitlab' && <ProviderConnection kind="gitlab" />}
        {section === 'jira' && <ProviderConnection kind="jira" />}
        {section === 'git-hosts' && <GitHostsSettings />}
        {section === 'notion' && <NotionSettings />}
        {section === 'claude' && <ClaudeView />}
        {section.startsWith('browser') && <BrowserSettings section={section} />}
        {section === 'extensions' && <ExtensionsPanel />}
        {section === 'shortcuts' && <ShortcutsPanel />}
        {section === 'templates' && <TemplatesSettings />}
        {section === 'repeating' && <RepeatingDesks />}
        {section === 'backup' && <StatusReposSettings />}
      </div>
    </div>
  )
}

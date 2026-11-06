import { useEffect, useState } from 'react'
import { MAX_DELAY_MINUTES, MIN_DELAY_MINUTES, parseExclude } from '../main/domain/hibernate'
import { setAutoHibernate, useAutoHibernate } from './auto-hibernate'

/** Settings → Browser → General: unload pages of Tabs that have been out of sight for a while. */
export function AutoHibernatePanel() {
  const s = useAutoHibernate()
  const [exclude, setExclude] = useState(s.exclude.join('\n'))
  useEffect(() => setExclude(s.exclude.join('\n')), [s.exclude])
  return (
    <section>
      <h2>Hibernate unused pages</h2>
      <p className="hint">
        A loaded page costs about 70 to 80 MB, even a blank one. A browser Tab that stays out of sight (another Tab, another WorkDesk) for the delay below is unloaded: it keeps its address, title and icon,
        is shown dimmed in the list of Tabs, and loads again on its address, scrolled to where you were, when you open it. Terminals are never touched, and neither are pinned Tabs, Tabs that play sound
        or Tabs on a host of the list below.
      </p>
      <label className="check">
        <input type="checkbox" checked={s.enabled} onChange={(e) => setAutoHibernate({ enabled: e.target.checked })} /> Hibernate pages that are out of sight
      </label>
      <p>
        <label>
          After{' '}
          <input
            type="number"
            min={MIN_DELAY_MINUTES}
            max={MAX_DELAY_MINUTES}
            value={s.delayMinutes}
            disabled={!s.enabled}
            style={{ width: 72 }}
            onChange={(e) => setAutoHibernate({ delayMinutes: Number(e.target.value) })}
          />{' '}
          minutes out of sight
        </label>
      </p>
      <p className="hint">Never hibernate these hosts (one per line; a host also covers its subdomains, e.g. <code>meet.google.com</code> or <code>slack.com</code>):</p>
      <textarea
        rows={4}
        style={{ width: '100%', maxWidth: 420 }}
        value={exclude}
        disabled={!s.enabled}
        spellCheck={false}
        onChange={(e) => setExclude(e.target.value)}
        onBlur={() => setAutoHibernate({ exclude: parseExclude(exclude) })}
      />
    </section>
  )
}

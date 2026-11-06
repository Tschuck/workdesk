import { useEffect, useState } from 'react'

/** Make WorkDesk the app that opens web links from other apps (the packaged app only). */
export function DefaultBrowserPanel() {
  const api = window.workdesk
  const [state, setState] = useState<{ canBe: boolean; isDefault: boolean }>()
  useEffect(() => void api.defaultBrowser().then(setState), [api])
  return (
    <section>
      <h2>Default browser</h2>
      <p className="hint">
        With WorkDesk as the default browser, a link clicked in another app opens here: on the page that shows it already (in a WorkDesk or on the Browser page), else as a new tab of the Browser page. macOS asks you to confirm the change; you can also pick WorkDesk in System Settings → Desktop &amp; Dock → Default web browser.
      </p>
      {!state ? null : !state.canBe ? (
        <p className="hint">Only the installed app can be the default browser (this one is a development run).</p>
      ) : state.isDefault ? (
        <p>✓ WorkDesk is your default browser.</p>
      ) : (
        <button className="primary" onClick={() => void api.makeDefaultBrowser().then(setState)}>Make WorkDesk the default browser</button>
      )}
    </section>
  )
}

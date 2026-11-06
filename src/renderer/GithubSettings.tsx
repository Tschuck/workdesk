import { GithubSetup } from './GithubSetup'

/** Settings → GitHub: how the app logs in to read pull requests. */
export function GithubSettings() {
  return (
    <section>
      <h2>GitHub</h2>
      <GithubSetup onReady={() => undefined} />
    </section>
  )
}

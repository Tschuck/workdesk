const TOOL_DIRS = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']

/**
 * An app started from Finder or the Dock gets a minimal PATH without Homebrew, so `tmux`,
 * `gh` and `code` would look "not installed". Add the usual tool folders after what is there.
 */
export function withToolPaths(path: string | undefined, dirs: readonly string[] = TOOL_DIRS): string {
  const current = (path ?? '').split(':').filter(Boolean)
  return [...current, ...dirs.filter((d) => !current.includes(d))].join(':')
}

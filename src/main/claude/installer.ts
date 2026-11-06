import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { HOOK_EVENTS, type HookEventName } from '../domain/claude-events'

/** Our hook commands are recognised by the CLI file name. */
export const HOOK_MARKER = 'workdesk.mjs'

export const hookCommand = (cliPath: string, event: HookEventName): string => `node "${cliPath}" hook ${event}`

interface HookGroup {
  matcher?: string
  hooks?: { type?: string; command?: string }[]
}
type Settings = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>

const settingsFile = (configDir: string): string => join(configDir, 'settings.json')

async function readSettings(configDir: string): Promise<Settings> {
  let text: string
  try {
    text = await readFile(settingsFile(configDir), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as Settings
  } catch {
    throw new Error(`${settingsFile(configDir)} is not valid JSON; fix it before installing hooks`)
  }
}

async function writeSettings(configDir: string, settings: Settings): Promise<void> {
  const file = settingsFile(configDir)
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.workdesk-tmp`
  await writeFile(tmp, JSON.stringify(settings, null, 2) + '\n')
  await rename(tmp, file)
}

const isOurs = (group: HookGroup): boolean => (group.hooks ?? []).some((h) => h.command?.includes(HOOK_MARKER))

export async function isInstalled(configDir: string): Promise<boolean> {
  const hooks = (await readSettings(configDir)).hooks ?? {}
  return HOOK_EVENTS.every((e) => (hooks[e] ?? []).some(isOurs))
}

/** Add our hooks to a Claude config dir; everything else in settings.json stays as it is. */
export async function installHooks(configDir: string, cliPath: string): Promise<void> {
  const settings = await readSettings(configDir)
  const hooks = { ...(settings.hooks ?? {}) }
  for (const event of HOOK_EVENTS) {
    const others = (hooks[event] ?? []).filter((g) => !isOurs(g))
    hooks[event] = [...others, { hooks: [{ type: 'command', command: hookCommand(cliPath, event) }] }]
  }
  await writeSettings(configDir, { ...settings, hooks })
}

/** Remove exactly our hooks again, dropping event lists and `hooks` when they end up empty. */
export async function uninstallHooks(configDir: string): Promise<void> {
  const settings = await readSettings(configDir)
  if (!settings.hooks) return
  const hooks: Record<string, HookGroup[]> = {}
  for (const [event, groups] of Object.entries(settings.hooks)) {
    const kept = groups.filter((g) => !isOurs(g))
    if (kept.length > 0) hooks[event] = kept
  }
  const { hooks: _old, ...rest } = settings
  await writeSettings(configDir, Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest)
}

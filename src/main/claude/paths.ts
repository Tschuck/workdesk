import { homedir } from 'node:os'
import { join } from 'node:path'

/** Where the app listens for hook events; mirrors the default in cli/workdesk.mjs. */
export function socketPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['WORKDESK_SOCKET'] || join(homedir(), 'Library', 'Application Support', 'WorkDesk', 'hook.sock')
}

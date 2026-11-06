import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const STORAGE = join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'storage.json')

/** the folder or workspace file of the VS Code window that was active last, from VS Code's `storage.json` */
export function lastActiveTarget(storageJson: string): string | undefined {
  try {
    const w = (JSON.parse(storageJson) as { windowsState?: { lastActiveWindow?: { folder?: string; workspaceIdentifier?: { configURIPath?: string } } } }).windowsState?.lastActiveWindow
    return w?.workspaceIdentifier?.configURIPath ?? w?.folder
  } catch {
    return undefined
  }
}

/** is VS Code the app in front? (`lsappinfo` needs no permission, unlike asking System Events) */
export function vsCodeInFront(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', 'lsappinfo info -only bundleid "$(lsappinfo front)"'], { timeout: 2000 }, (err, out) => resolve(!err && /com\.microsoft\.VSCode/i.test(out)))
  })
}

/** the folder or workspace file open in the VS Code window in front; none when VS Code is not in front */
export async function frontEditorTarget(): Promise<string | undefined> {
  if (!(await vsCodeInFront())) return undefined
  return lastActiveTarget(await readFile(STORAGE, 'utf8').catch(() => ''))
}

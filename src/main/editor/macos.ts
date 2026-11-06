import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { EditorWindows } from './windows'

const run = promisify(execFile)

/** VS Code names a workspace window "<file name> (Workspace)". */
export const windowTitle = (deskId: string): string => `${deskId} (Workspace)`

const PROCESS = 'Code'

const q = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** AppleScript that runs `body` for each VS Code window whose title contains the WorkDesk's title. */
function forWindow(deskId: string, body: string): string {
  return `tell application "System Events"
  if not (exists process ${q(PROCESS)}) then return 0
  tell process ${q(PROCESS)}
    set found to 0
    repeat with w in windows
      if name of w contains ${q(windowTitle(deskId))} then
        set found to found + 1
${body}
      end if
    end repeat
    return found
  end tell
end tell`
}

export const scripts = {
  count: (deskId: string) => forWindow(deskId, ''),
  /** back from the Dock if it was minimised, then to the front; size and place stay as the user left them */
  raise: (deskId: string) =>
    forWindow(
      deskId,
      `        set value of attribute "AXMinimized" of w to false
        perform action "AXRaise" of w
        set frontmost to true`
    ),
  minimize: (deskId: string) => forWindow(deskId, `        set value of attribute "AXMinimized" of w to true`),
  close: (deskId: string) =>
    forWindow(deskId, `        click (first button of w whose subrole is "AXCloseButton")`)
}

export type ScriptRunner = (script: string) => Promise<string>
export type CodeRunner = (args: string[]) => Promise<void>

export const osascript: ScriptRunner = async (script) => (await run('osascript', ['-e', script])).stdout.trim()

export function findCodeBinary(exists: (p: string) => boolean = existsSync): string {
  const candidates = [
    '/opt/homebrew/bin/code',
    '/usr/local/bin/code',
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
  ]
  const found = candidates.find(exists)
  if (!found) throw new Error('VS Code CLI `code` not found; install it via "Shell Command: Install code in PATH"')
  return found
}

export const runCode: CodeRunner = async (args) => void (await run(findCodeBinary(), args))

/** A file to open so VS Code reveals the Branch's folder in the explorer. */
export function revealFile(folder: string, list: (dir: string) => string[] = (d) => readdirSync(d)): string | undefined {
  const names = list(folder)
  const pick = ['README.md', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'].find((n) => names.includes(n))
  return pick ? join(folder, pick) : names.find((n) => !n.startsWith('.')) && join(folder, names.find((n) => !n.startsWith('.'))!)
}

export class MacEditorWindows implements EditorWindows {
  constructor(
    private readonly script: ScriptRunner = osascript,
    private readonly code: CodeRunner = runCode,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly reveal: (folder: string) => string | undefined = revealFile
  ) {}

  private async count(deskId: string): Promise<number> {
    return Number(await this.script(scripts.count(deskId))) || 0
  }

  private async ensureOpen(deskId: string, workspaceFile: string, extra: string[] = []): Promise<void> {
    if ((await this.count(deskId)) > 0) {
      // No --reuse-window: that forces the LAST ACTIVE window, which can be another WorkDesk's, and replaces it.
      // Naming the workspace file makes VS Code go to the window that already has it open.
      if (extra.length) await this.code([workspaceFile, ...extra])
      return
    }
    await this.code(['--new-window', workspaceFile, ...extra])
    for (let i = 0; i < 50; i++) {
      if ((await this.count(deskId)) > 0) return
      await this.sleep(200)
    }
    throw new Error(`VS Code did not open a window for ${deskId}`)
  }

  async isOpen(deskId: string): Promise<boolean> {
    return (await this.count(deskId)) > 0
  }

  async openEditor(deskId: string, workspaceFile: string): Promise<void> {
    await this.ensureOpen(deskId, workspaceFile)
    await this.script(scripts.raise(deskId))
  }

  async minimizeEditors(deskIds: readonly string[]): Promise<void> {
    for (const id of deskIds) await this.script(scripts.minimize(id))
  }

  async closeEditor(deskId: string): Promise<void> {
    await this.script(scripts.close(deskId))
  }

  async openFile(deskId: string, workspaceFile: string, file: string, line?: number): Promise<void> {
    await this.ensureOpen(deskId, workspaceFile, ['--goto', line ? `${file}:${line}` : file])
    await this.script(scripts.raise(deskId))
  }

  async focusFolder(deskId: string, workspaceFile: string, folderPath: string): Promise<void> {
    const file = this.reveal(folderPath)
    await this.ensureOpen(deskId, workspaceFile, file ? ['--goto', file] : [])
    await this.script(scripts.raise(deskId))
  }
}

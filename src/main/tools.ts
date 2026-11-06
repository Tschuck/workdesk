import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { findCodeBinary } from './editor/macos'
import type { ToolCheck } from './tools-shared'

const run = promisify(execFile)

type Runner = (file: string, args: string[]) => Promise<string>
const defaultRun: Runner = async (file, args) => (await run(file, args)).stdout.trim().split('\n')[0]

/** First-run checks: the tools WorkDesk shells out to. */
export async function checkTools(exec: Runner = defaultRun, codePath: () => string = findCodeBinary): Promise<ToolCheck[]> {
  const probe = async (name: string, required: boolean, hint: string, file: () => string, args: string[]): Promise<ToolCheck> => {
    try {
      return { name, required, ok: true, version: await exec(file(), args), hint }
    } catch {
      return { name, required, ok: false, hint }
    }
  }
  return Promise.all([
    probe('git', true, 'Install the Xcode command line tools: xcode-select --install', () => 'git', ['--version']),
    probe('tmux', true, 'Install it with: brew install tmux', () => 'tmux', ['-V']),
    probe('code', true, 'In VS Code run "Shell Command: Install \'code\' command in PATH"', codePath, ['--version']),
    probe('gh', false, 'Optional, for GitHub without a token: brew install gh && gh auth login', () => 'gh', ['--version'])
  ])
}

export { missingRequired, type ToolCheck } from './tools-shared'

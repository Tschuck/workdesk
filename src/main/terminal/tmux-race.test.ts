import { execFileSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { createTmux } from './tmux'

const hasTmux = (() => {
  try {
    execFileSync('tmux', ['-V'])
    return true
  } catch {
    return false
  }
})()

// a throwaway server of its own, never the one WorkDesk uses
const socket = `wd-race-${process.pid}`
const tmux = (...args: string[]) => execFileSync('tmux', ['-L', socket, ...args], { encoding: 'utf8' })

describe.skipIf(!hasTmux)('windows of one session made at the same time', () => {
  afterAll(() => {
    try {
      tmux('kill-server')
    } catch {
      // no server
    }
  })

  it('all get their window, e.g. when a reactivated WorkDesk shows two Panes at once', async () => {
    const t = createTmux(socket)
    // the first Pane runs a program, the second is a plain shell: both are asked for together
    await Promise.all([
      t.ensureWindow('workdesk-x', 'claude-pane', '/tmp', 'sleep 60'),
      t.ensureWindow('workdesk-x', 'shell-pane', '/tmp'),
      t.ensureWindow('workdesk-x', 'third-pane', '/tmp')
    ])
    expect(tmux('list-windows', '-t', '=workdesk-x', '-F', '#{window_name}').trim().split('\n').sort()).toEqual(['claude-pane', 'shell-pane', 'third-pane'])
  })
})

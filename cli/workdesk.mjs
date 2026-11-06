#!/usr/bin/env node
// `workdesk hook <event>`: called by Claude Code hooks. Forwards the event to the running
// WorkDesk app over a unix socket. It must never fail or block Claude: every problem exits 0 silently.
import { execFileSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TIMEOUT_MS = 800
const done = () => process.exit(0)

const [command, event] = process.argv.slice(2)
const socketPath = process.env.WORKDESK_SOCKET || join(homedir(), 'Library', 'Application Support', 'WorkDesk', 'hook.sock')

// `workdesk desk|branch|todo|review …`: commands for the running app, answered as JSON (see `workdesk help`)
const CONTROL = ['desk', 'branch', 'todo', 'review', 'pane']
if (CONTROL.includes(command)) {
  const { parseControl, HELP } = await import('./control-args.mjs')
  const parsed = parseControl(process.argv.slice(2))
  if (parsed.error) {
    console.error(parsed.error + '\n\n' + HELP)
    process.exit(2)
  }
  const reply = await new Promise((resolve) => {
    const socket = createConnection(socketPath)
    let data = ''
    socket.setTimeout(120_000, () => (socket.destroy(), resolve({ ok: false, error: 'WorkDesk did not answer' })))
    socket.on('error', () => resolve({ ok: false, error: 'WorkDesk is not running (no socket at ' + socketPath + ')' }))
    socket.on('connect', () => socket.write(JSON.stringify({ control: parsed.control, cwd: process.cwd(), args: parsed.args }) + '\n'))
    socket.on('data', (c) => (data += c))
    socket.on('close', () => {
      try {
        resolve(JSON.parse(data.split('\n')[0]))
      } catch {
        resolve({ ok: false, error: 'No answer from WorkDesk' })
      }
    })
  })
  if (reply.ok) console.log(JSON.stringify(reply.data, null, 2))
  else console.error('workdesk: ' + reply.error)
  process.exit(reply.ok ? 0 : 1)
}

if (command === 'help' || command === '--help' || !command) {
  const { HELP } = await import('./control-args.mjs')
  console.log(HELP)
  process.exit(0)
}

// the hook command must never fail or block Claude: every problem exits 0 silently
setTimeout(done, TIMEOUT_MS * 2).unref()
if (command !== 'hook' || !event) done()

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    if (process.stdin.isTTY) return resolve('')
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

/** Which tmux session and window (our Pane id) Claude runs in, when it runs in one. */
function tmuxPane() {
  if (!process.env.TMUX_PANE) return {}
  try {
    const out = execFileSync('tmux', ['display-message', '-p', '-t', process.env.TMUX_PANE, '#{session_name}\t#{window_name}'], {
      timeout: 300,
      encoding: 'utf8'
    }).trim()
    const [session, window] = out.split('\t')
    return session?.startsWith('workdesk-') && !session.startsWith('workdesk-view-')
      ? { tmuxSession: session, paneId: window }
      : session?.startsWith('workdesk-view-')
        ? { paneId: window }
        : {}
  } catch {
    return {}
  }
}

let input = {}
try {
  input = JSON.parse((await readStdin()) || '{}')
} catch {
  input = {}
}

const payload = {
  event,
  sessionId: input.session_id,
  cwd: input.cwd || process.cwd(),
  message: input.message,
  configDir: process.env.CLAUDE_CONFIG_DIR,
  ...tmuxPane()
}

const socket = createConnection(socketPath)
socket.setTimeout(TIMEOUT_MS, done)
socket.on('error', done)
socket.on('connect', () => socket.end(JSON.stringify(payload) + '\n'))
socket.on('close', done)

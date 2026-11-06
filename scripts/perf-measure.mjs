#!/usr/bin/env node
// Measures the built app (run `npx electron-vite build` first) with a throw-away data folder:
//   node scripts/perf-measure.mjs [--desks 1,5,15] [--json out.json] [--budget budget.json]
// Reports startup time (spawn -> first render), memory per process (from the app's own Performance reader) and the
// time from a key press in the file editor to the next painted frame, for each number of desks.
// Needs the Electron binary and `tmux` (terminals); never touches ~/workdesk.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const counts = arg('desks', '1,5,15').split(',').map(Number)
// --hibernate: also look at every Tab once (so each page is loaded), set the delay of auto-hibernate to a minute and measure again after it
const hibernate = process.argv.includes('--hibernate')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let port = 0

async function connect() {
  for (let i = 0; i < 200; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // not up yet
    }
    await sleep(100)
  }
  throw new Error('no page to attach to')
}

function client(url) {
  const ws = new WebSocket(url)
  let id = 0
  const waiting = new Map()
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && waiting.has(d.id)) {
      const { ok, fail } = waiting.get(d.id)
      waiting.delete(d.id)
      d.error ? fail(new Error(d.error.message)) : ok(d.result)
    }
  }
  const open = new Promise((r) => (ws.onopen = r))
  const send = (method, params = {}) => new Promise((ok, fail) => (waiting.set(++id, { ok, fail }), ws.send(JSON.stringify({ id, method, params }))))
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed')
    return r.result.value
  }
  return { open, send, evaluate, close: () => ws.close() }
}

async function run(n) {
  port = 9300 + Math.floor(Math.random() * 500)
  // its own tmux server, so the terminals of the run never mix with the ones of the real app
  const socket = `workdesk-perf-${process.pid}-${n}`
  const dir = mkdtempSync(join(tmpdir(), 'workdesk-perf-'))
  mkdirSync(join(dir, 'root'))
  mkdirSync(join(dir, 'ud'))
  // a source file big enough to be worth tokenising
  const source = Array.from({ length: 3000 }, (_, i) => `export function f${i}(a: number, b: string): string { return b.repeat(a) + '${i}' }\n`).join('')
  const started = Date.now()
  const proc = spawn(join(repo, 'node_modules/.bin/electron'), [repo, `--user-data-dir=${join(dir, 'ud')}`, `--remote-debugging-port=${port}`], {
    env: { ...process.env, WORKDESK_ROOT: join(dir, 'root'), WORKDESK_NO_USAGE: '1', WORKDESK_TMUX_SOCKET: socket },
    stdio: 'ignore'
  })
  try {
    const c = client(await connect())
    await c.open
    await c.send('Runtime.enable')
    // the window may be behind others: let the page believe it has the focus, or the editor ignores the keys
    await c.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    // first render: the left panel is there
    for (let i = 0; i < 300 && !(await c.evaluate(`!!document.body.innerText.includes('Dashboard')`)); i++) await sleep(50)
    const startupMs = Date.now() - started
    const api = (call) => c.evaluate(`(async () => { const r = await (${call}); return JSON.stringify(r ?? null) })()`)
    const ids = []
    for (let i = 0; i < n; i++) {
      const st = JSON.parse(await api(`window.workdesk.startPlainDesk([], 'Perf desk ${i + 1}')`))
      const desk = st.desks.find((d) => d.name === `Perf desk ${i + 1}`)
      ids.push(desk.id)
      // each desk gets 2 terminals, 1 page and 1 file, the usual mix
      await api(`window.workdesk.addTab('${desk.id}', 'terminal')`)
      await api(`window.workdesk.addTab('${desk.id}', 'terminal')`)
      await api(`window.workdesk.addTab('${desk.id}', 'browser', 'about:blank')`)
      const scratch = JSON.parse(await api(`window.workdesk.filesNewScratch('${desk.id}')`)).replace(/\.md$/, '.ts')
      mkdirSync(dirname(scratch), { recursive: true })
      writeFileSync(scratch, source)
      await api(`window.workdesk.addTab('${desk.id}', 'file', ${JSON.stringify(scratch)})`)
    }
    // the page learns about desks made behind its back on a reload
    await c.evaluate(`localStorage.setItem('workdesk.perf', '1')`)
    if (hibernate) await c.evaluate(`localStorage.setItem('workdesk.autoHibernate', '{"enabled":true,"delayMinutes":1,"exclude":[]}')`)
    await c.send('Page.reload')
    await sleep(1500)
    for (let i = 0; i < 100 && !(await c.evaluate(`document.body.innerText.includes('Perf desk 1')`)); i++) await sleep(100)
    // visit every desk by clicking it in the left panel, as a user would
    for (let i = 0; i < n; i++) {
      await c.evaluate(`(() => { const el = [...document.querySelectorAll('.desks .name')].find((e) => e.textContent === 'Perf desk ${i + 1}'); el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); return !!el })()`)
      await sleep(700)
    }
    await sleep(3000)
    let loadedMb, hibernatedMb, wokeUp
    if (hibernate) {
      // open every browser Tab of every desk, then leave them
      for (let i = 0; i < n; i++) {
        await c.evaluate(`(() => { const el = [...document.querySelectorAll('.desks .name')].find((e) => e.textContent === 'Perf desk ${i + 1}'); el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })) })()`)
        await sleep(400)
        await c.evaluate(`(() => { const t = [...document.querySelectorAll('.desk-view.on .tab')].find((x) => /Browser/.test(x.textContent)); t?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); t?.click() })()`)
        await sleep(1200)
      }
      loadedMb = JSON.parse(await api('window.workdesk.performance()')).app.memoryMb
      // go to the Dashboard, so no desk is on screen, and wait for the clock
      await c.evaluate(`[...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent === 'Dashboard')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
      await sleep(100_000)
      hibernatedMb = JSON.parse(await api('window.workdesk.performance()')).app.memoryMb
      // coming back to a Tab that was put to sleep loads its page again
      await c.evaluate(`document.querySelector('.desks .name')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`)
      await sleep(500)
      await c.evaluate(`(() => { const t = [...document.querySelectorAll('.desk-view.on .tab')].find((x) => /Browser/.test(x.textContent)); t?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); t?.click() })()`)
      await sleep(2500)
      wokeUp = await c.evaluate(`document.querySelectorAll('.desk-view.on .tab-pane.on webview').length === 1 && !document.querySelector('.desk-view.on .tab-pane.on .hibernated-page')`)
    }
    const perf = JSON.parse(await api('window.workdesk.performance()'))
    // typing latency in the editor of the last desk: key press -> next painted frame
    await c.evaluate(`(() => {
      const tab = [...document.querySelectorAll('.tab')].find((t) => /untitled/.test(t.textContent)); tab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); tab?.click()
      return !!tab })()`)
    await sleep(2500)
    const typing = await c.evaluate(`(async () => {
      const ed = window.__monaco?.editor.getEditors().find((e) => e.getContainerDomNode().offsetParent)
      if (!ed) return null
      ed.focus()
      const lat = []
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now()
        ed.trigger('perf', 'type', { text: 'a' })
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
        lat.push(performance.now() - t0)
        await new Promise((r) => setTimeout(r, 40))
      }
      return JSON.stringify(lat)
    })()`)
    const lat = (typing ? JSON.parse(typing) : []).sort((a, b) => a - b)
    const jsHeap = await c.evaluate('Math.round(performance.memory.usedJSHeapSize / 1048576)')
    const q = (p) => (lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] * 10) / 10 : null)
    c.close()
    return {
      desks: n,
      startupMs,
      appMemoryMb: perf.app.memoryMb,
      appProcesses: perf.app.processes,
      parts: perf.app.parts.map((p) => `${p.name}:${p.memoryMb}`),
      totalMemoryMb: perf.total.memoryMb,
      rendererHeapMb: jsHeap,
      ...(hibernate ? { allPagesLoadedMb: loadedMb, afterHibernateMb: hibernatedMb, pageLoadsAgainOnReturn: wokeUp } : {}),
      typingMs: { samples: lat.length, p50: q(0.5), p95: q(0.95) }
    }
  } finally {
    const gone = new Promise((r) => proc.once('exit', r))
    proc.kill()
    await Promise.race([gone, sleep(5000)])
    await new Promise((r) => spawn('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' }).once('exit', r))
  }
}

const results = []
for (const n of counts) {
  const r = await run(n)
  results.push(r)
  console.log(JSON.stringify(r))
}
const out = arg('json')
if (out) writeFileSync(out, JSON.stringify(results, null, 2))
const budgetFile = arg('budget')
if (budgetFile) {
  const budget = JSON.parse(readFileSync(budgetFile, 'utf8'))
  const bad = results.flatMap((r) => {
    const b = budget[String(r.desks)]
    if (!b) return []
    return [['startupMs', r.startupMs], ['appMemoryMb', r.appMemoryMb], ['typingP95Ms', r.typingMs.p95]].filter(([k, v]) => b[k] !== undefined && v !== null && v > b[k]).map(([k, v]) => `${r.desks} desks: ${k} ${v} > ${b[k]}`)
  })
  if (bad.length) {
    console.error('over budget:\n' + bad.join('\n'))
    process.exit(1)
  }
}

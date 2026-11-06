import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dayKey } from './domain/time-tracking'
import { TimeTracker, type PresenceProbe } from './time-tracker'

function setup() {
  const state = { now: new Date(2026, 5, 10, 12).getTime(), idle: 0, locked: false }
  const probe: PresenceProbe = { now: () => state.now, idleSeconds: () => state.idle, locked: () => state.locked }
  return { state, probe }
}

describe('TimeTracker', () => {
  it('tells once when five minutes without input stop the counting, and again after the user was back', async () => {
    const { state, probe } = setup()
    const told: string[] = []
    const t = new TimeTracker(join(await mkdtemp(join(tmpdir(), 'tt-')), 't.json'), probe, (id) => void told.push(id))
    t.start(1_000_000)
    t.setShown('d1')
    state.idle = 301
    for (let i = 0; i < 3; i++) (state.now += 15_000, t.tick())
    expect(told).toEqual(['d1'])
    // back at the keyboard, then away again
    state.idle = 0
    state.now += 15_000
    t.tick()
    state.idle = 400
    state.now += 15_000
    t.tick()
    expect(told).toEqual(['d1', 'd1'])
    // a locked screen is no "idle in a WorkDesk"
    state.locked = true
    state.now += 15_000
    t.tick()
    expect(told).toHaveLength(2)
    t.stop()
  })
  it('counts the shown desk while the user is there', async () => {
    const { state, probe } = setup()
    const t = new TimeTracker(join(await mkdtemp(join(tmpdir(), 'tt-')), 't.json'), probe)
    t.start(1_000_000)
    t.setShown('d1')
    state.now += 30_000
    t.tick()
    expect(t.data()[dayKey(state.now)]).toEqual({ d1: 30 })
    t.stop()
  })
  it('does not count idle time, a hidden window or a page without a desk', async () => {
    const { state, probe } = setup()
    const t = new TimeTracker(join(await mkdtemp(join(tmpdir(), 'tt-')), 't.json'), probe)
    t.start(1_000_000)
    state.now += 20_000
    t.tick() // no desk shown
    t.setShown('d1')
    state.now += 20_000
    state.idle = 600
    t.tick()
    state.idle = 0
    state.locked = true
    state.now += 20_000
    t.tick()
    expect(t.data()).toEqual({})
    t.stop()
  })
  it('switching desks credits the time before the switch to the first one', async () => {
    const { state, probe } = setup()
    const t = new TimeTracker(join(await mkdtemp(join(tmpdir(), 'tt-')), 't.json'), probe)
    t.start(1_000_000)
    t.setShown('d1')
    state.now += 10_000
    t.setShown('d2')
    state.now += 5_000
    t.tick()
    expect(t.data()[dayKey(state.now)]).toEqual({ d1: 10, d2: 5 })
    t.stop()
  })
  it('counts the desk of the VS Code window in front instead of the one shown, and goes back when VS Code is left', async () => {
    const { state, probe } = setup()
    const t = new TimeTracker(join(await mkdtemp(join(tmpdir(), 'tt-')), 't.json'), probe)
    t.start(1_000_000)
    t.setShown('d1')
    state.now += 10_000
    t.setEditorDesk('d2')
    state.now += 20_000
    t.setEditorDesk(undefined)
    state.now += 5_000
    t.tick()
    expect(t.data()[dayKey(state.now)]).toEqual({ d1: 15, d2: 20 })
    t.stop()
  })
  it('counts VS Code time while the app shows no desk', async () => {
    const { state, probe } = setup()
    const t = new TimeTracker(join(await mkdtemp(join(tmpdir(), 'tt-')), 't.json'), probe)
    t.start(1_000_000)
    t.setEditorDesk('d2')
    state.now += 30_000
    t.tick()
    expect(t.data()[dayKey(state.now)]).toEqual({ d2: 30 })
    t.stop()
  })
  it('saves to the file and loads it again', async () => {
    const { state, probe } = setup()
    const file = join(await mkdtemp(join(tmpdir(), 'tt-')), 't.json')
    const t = new TimeTracker(file, probe)
    t.start(1_000_000)
    t.setShown('d1')
    state.now += 10_000
    t.tick()
    await t.flush()
    t.stop()
    expect(JSON.parse(await readFile(file, 'utf8'))[dayKey(state.now)]).toEqual({ d1: 10 })
    const again = new TimeTracker(file, probe)
    await again.load()
    expect(again.data()[dayKey(state.now)]).toEqual({ d1: 10 })
  })
})

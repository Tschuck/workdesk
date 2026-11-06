import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyHookEvent, parseHookEvent, type HookEvent } from '../domain/claude-events'
import { matchCwd } from '../domain/match'
import { openSignals } from '../domain/signal'
import { Osc133Scanner } from '../terminal/osc133'
import { FocusAcknowledger } from './focus-ack'

const ev = (event: HookEvent['event'], over: Partial<HookEvent> = {}): HookEvent => ({ event, sessionId: 's1', cwd: '/r/d/api', ...over })

describe('hook events to Signals', () => {
  it('raises needs-input and finished, without duplicates', () => {
    let s = applyHookEvent([], ev('Notification', { message: 'Claude needs permission', paneId: 'p1' }), 'a', 1, '/r/d/api')
    s = applyHookEvent(s, ev('Notification'), 'dup', 2)
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ type: 'claude-needs-input', paneId: 'p1', sessionId: 's1', branchPath: '/r/d/api', message: 'Claude needs permission', read: false })
  })

  it('Stop replaces needs-input by finished', () => {
    let s = applyHookEvent([], ev('Notification'), 'a', 1)
    s = applyHookEvent(s, ev('Stop'), 'b', 2)
    expect(openSignals({ signals: s }).map((x) => x.type)).toEqual(['claude-finished'])
  })

  it('a new prompt clears the Signals of that session only', () => {
    let s = applyHookEvent([], ev('Stop'), 'a', 1)
    s = applyHookEvent(s, ev('Stop', { sessionId: 's2' }), 'b', 2)
    s = applyHookEvent(s, ev('UserPromptSubmit'), 'c', 3)
    expect(openSignals({ signals: s }).map((x) => x.sessionId)).toEqual(['s2'])
  })

  it('SessionStart raises nothing', () => {
    expect(applyHookEvent([], ev('SessionStart'), 'a', 1)).toEqual([])
  })

  it('parses payloads defensively', () => {
    expect(parseHookEvent({ event: 'Stop', cwd: '/x', sessionId: 'z' })).toMatchObject({ event: 'Stop', cwd: '/x', sessionId: 'z' })
    expect(parseHookEvent({ event: 'Nope', cwd: '/x' })).toBeUndefined()
    expect(parseHookEvent({ event: 'Stop' })).toBeUndefined()
    expect(parseHookEvent('x')).toBeUndefined()
    expect(parseHookEvent(null)).toBeUndefined()
  })
})

describe('cwd matching', () => {
  const desks = [
    { id: 'rev', branches: [{ project: 'api', branch: 'a', path: '/r/rev/api', index: 1 }, { project: 'api', branch: 'b', path: '/r/rev/api--2-b', index: 2 }] },
    { id: 'rev-2', branches: [] }
  ]
  it('finds the WorkDesk and Branch by folder', () => {
    expect(matchCwd('/r', desks, '/r/rev/api/src')).toEqual({ deskId: 'rev', branchPath: '/r/rev/api' })
    expect(matchCwd('/r', desks, '/r/rev/api--2-b')).toEqual({ deskId: 'rev', branchPath: '/r/rev/api--2-b' })
    expect(matchCwd('/r', desks, '/r/rev')).toEqual({ deskId: 'rev', branchPath: undefined })
    expect(matchCwd('/r', desks, '/r/rev-2/x')?.deskId).toBe('rev-2')
  })
  it('ignores folders outside any WorkDesk, including look-alike prefixes', () => {
    expect(matchCwd('/r', desks, '/elsewhere')).toBeUndefined()
    expect(matchCwd('/r', desks, '/r/reviews')).toBeUndefined()
  })
})

describe('OSC 133 scanner', () => {
  it('reports finished commands, also across chunks', () => {
    const s = new Osc133Scanner()
    expect(s.push('out\x1b]133;D;0\x07more')).toEqual([{ exitCode: 0 }])
    expect(s.push('\x1b]133;D;')).toEqual([])
    expect(s.push('2\x07')).toEqual([{ exitCode: 2 }])
    expect(s.push('\x1b]133;D\x1b\\')).toEqual([{}])
    expect(s.push('\x1b]133;A\x07plain')).toEqual([])
  })
})

describe('focus acknowledgement', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('acknowledges after ~2 s of focus and not when focus is lost', () => {
    const ack = vi.fn()
    const f = new FocusAcknowledger(ack)
    f.setFocused('d', 'p', true)
    vi.advanceTimersByTime(1500)
    f.setFocused('d', 'p', false)
    vi.advanceTimersByTime(5000)
    expect(ack).not.toHaveBeenCalled()
    f.setFocused('d', 'p', true)
    vi.advanceTimersByTime(2000)
    expect(ack).toHaveBeenCalledExactlyOnceWith('d', 'p')
  })
})

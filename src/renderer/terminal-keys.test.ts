import { describe, expect, it } from 'vitest'
import { cycleDelta, recentDelta, decodeOsc52, isCopyKey, isTerminalReply, NEW_LINE, terminalKey, WORD_BACK, WORD_FORWARD, type KeyLike } from './terminal-keys'

const key = (over: Partial<KeyLike>): KeyLike => ({ type: 'keydown', key: 'Enter', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...over })

describe('Shift+Enter in a terminal', () => {
  it('sends a new line instead of a submit, once', () => {
    expect(terminalKey(key({ shiftKey: true }))).toEqual({ swallow: true, send: NEW_LINE })
    expect(terminalKey(key({ shiftKey: true, type: 'keypress' }))).toEqual({ swallow: true })
    expect(terminalKey(key({ shiftKey: true, type: 'keyup' }))).toEqual({ swallow: true })
    expect(NEW_LINE).toBe('\u001b\r')
  })

  it('leaves Enter and other combinations alone', () => {
    expect(terminalKey(key({}))).toEqual({ swallow: false })
    expect(terminalKey(key({ shiftKey: true, ctrlKey: true }))).toEqual({ swallow: false })
    expect(terminalKey(key({ shiftKey: true, altKey: true }))).toEqual({ swallow: false })
    expect(terminalKey(key({ shiftKey: true, metaKey: true }))).toEqual({ swallow: false })
    expect(terminalKey(key({ key: 'a', shiftKey: true }))).toEqual({ swallow: false })
  })
})

describe('jumping over words', () => {
  it('maps Ctrl+Left/Right and Option+Left/Right to word back and forward, once', () => {
    expect(terminalKey(key({ key: 'ArrowLeft', ctrlKey: true }))).toEqual({ swallow: true, send: WORD_BACK })
    expect(terminalKey(key({ key: 'ArrowRight', ctrlKey: true }))).toEqual({ swallow: true, send: WORD_FORWARD })
    expect(terminalKey(key({ key: 'ArrowLeft', altKey: true }))).toEqual({ swallow: true, send: WORD_BACK })
    expect(terminalKey(key({ key: 'ArrowRight', altKey: true }))).toEqual({ swallow: true, send: WORD_FORWARD })
    expect(terminalKey(key({ key: 'ArrowLeft', ctrlKey: true, type: 'keyup' }))).toEqual({ swallow: true })
    expect(WORD_BACK).toBe('\u001bb')
    expect(WORD_FORWARD).toBe('\u001bf')
  })

  it('does not touch plain arrows, Shift, Cmd, or Ctrl+Option together', () => {
    expect(terminalKey(key({ key: 'ArrowLeft' }))).toEqual({ swallow: false })
    expect(terminalKey(key({ key: 'ArrowLeft', ctrlKey: true, shiftKey: true }))).toEqual({ swallow: false })
    // Command+arrows belong to the WorkDesk (move between Panes): the terminal sends nothing for them
    expect(terminalKey(key({ key: 'ArrowLeft', metaKey: true }))).toEqual({ swallow: true })
    expect(terminalKey(key({ key: 'ArrowUp', metaKey: true, type: 'keyup' }))).toEqual({ swallow: true })
    // Command+Shift+arrows split the Pane, also not for the terminal
    expect(terminalKey(key({ key: 'ArrowUp', metaKey: true, shiftKey: true }))).toEqual({ swallow: true })
    expect(terminalKey(key({ key: 'ArrowLeft', ctrlKey: true, altKey: true }))).toEqual({ swallow: false })
    expect(terminalKey(key({ key: 'ArrowUp', ctrlKey: true }))).toEqual({ swallow: false })
  })
})

describe('Ctrl+Tab', () => {
  it('cycles forward and backward, on key down only', () => {
    expect(cycleDelta(key({ key: 'Tab', ctrlKey: true }))).toBe(1)
    expect(cycleDelta(key({ key: 'Tab', ctrlKey: true, shiftKey: true }))).toBe(-1)
    expect(cycleDelta(key({ key: 'Tab', ctrlKey: true, type: 'keyup' }))).toBe(0)
    expect(cycleDelta(key({ key: 'Tab' }))).toBe(0)
    expect(cycleDelta(key({ key: 'Tab', ctrlKey: true, metaKey: true }))).toBe(0)
    expect(cycleDelta(key({ key: 'Tab', ctrlKey: true, altKey: true }))).toBe(0)
  })

  it('keeps the terminal from taking it as a Tab character', () => {
    expect(terminalKey(key({ key: 'Tab', ctrlKey: true }))).toEqual({ swallow: true })
    expect(terminalKey(key({ key: 'Tab', ctrlKey: true, shiftKey: true }))).toEqual({ swallow: true })
    // a plain Tab still reaches the shell for completion
    expect(terminalKey(key({ key: 'Tab' }))).toEqual({ swallow: false })
  })
})

describe('copying from a terminal', () => {
  it('copies on Command+C only when something is selected', () => {
    expect(isCopyKey(key({ key: 'c', metaKey: true }), true)).toBe(true)
    expect(isCopyKey(key({ key: 'C', metaKey: true }), true)).toBe(true)
    expect(isCopyKey(key({ key: 'c', metaKey: true }), false)).toBe(false)
    // Ctrl+C is still the interrupt; keys other than a key down do nothing
    expect(isCopyKey(key({ key: 'c', ctrlKey: true }), true)).toBe(false)
    expect(isCopyKey(key({ type: 'keyup', key: 'c', metaKey: true }), true)).toBe(false)
    expect(isCopyKey(key({ key: 'c', metaKey: true, shiftKey: true }), true)).toBe(false)
  })

  it('reads what tmux puts on the clipboard with OSC 52, umlauts included, and ignores reads', () => {
    expect(decodeOsc52('c;' + Buffer.from('hello world').toString('base64'))).toBe('hello world')
    expect(decodeOsc52(';' + Buffer.from('Grüße ✓').toString('base64'))).toBe('Grüße ✓')
    expect(decodeOsc52('c;?')).toBeUndefined()
    expect(decodeOsc52('c;')).toBeUndefined()
    expect(decodeOsc52('no separator')).toBeUndefined()
    expect(decodeOsc52('c;***not base64***')).toBeUndefined()
  })
})

describe('Opt+Tab', () => {
  it('walks through the recent Tabs, on key down only, and is not Ctrl+Tab', () => {
    expect(recentDelta(key({ key: 'Tab', altKey: true }))).toBe(1)
    expect(recentDelta(key({ key: 'Tab', altKey: true, shiftKey: true }))).toBe(-1)
    expect(recentDelta(key({ key: 'Tab', altKey: true, type: 'keyup' }))).toBe(0)
    expect(recentDelta(key({ key: 'Tab', altKey: true, ctrlKey: true }))).toBe(0)
    expect(recentDelta(key({ key: 'Tab', altKey: true, metaKey: true }))).toBe(0)
    expect(recentDelta(key({ key: 'Tab' }))).toBe(0)
    expect(terminalKey(key({ key: 'Tab', altKey: true }))).toEqual({ swallow: true })
  })
})


describe('the answers of the terminal itself', () => {
  it('knows device attributes, mode reports and colour answers', () => {
    for (const r of ['\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b[?2026;2$y', '\x1b[?1004;1$y', '\x1b]11;rgb:1c1c/1c1c/1c1c\x1b\\', '\x1b]10;rgb:ebeb/dbdb/b2b2\x07']) expect(isTerminalReply(r)).toBe(true)
  })
  it('does not take what is typed', () => {
    for (const k of ['a', '\r', '\x1b', '\x1b[A', '\x1b[1;5C', '\x1bb', '\x1b[200~paste\x1b[201~', 'c']) expect(isTerminalReply(k)).toBe(false)
  })
})

import { navDirection, splitDirection } from './pane-nav'

export interface KeyLike {
  type: string
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

/** Escape + carriage return: "Meta+Enter", which Claude Code (and readline) take as a new line, not a submit. */
export const NEW_LINE = '\x1b\r'
/** Escape + b / f: "Meta+b / Meta+f", backward and forward by a word in shells and in Claude Code. */
export const WORD_BACK = '\x1bb'
export const WORD_FORWARD = '\x1bf'

export interface KeyAction {
  /** keep the terminal (xterm.js) from handling the key itself */
  swallow: boolean
  /** bytes to write to the program instead */
  send?: string
}

/**
 * Keys a terminal pane treats specially. Everything is sent once, on key down; the other events of the key
 * (key press, key up) are swallowed so nothing else follows.
 * - Shift+Enter: a new line, not a submit (xterm.js sends the same carriage return as for Enter)
 * - Ctrl+Left/Right and Option+Left/Right: jump over words (shells do not know the Ctrl+arrow sequences)
 * - Command+arrows: move between the Panes of the Tab (the WorkDesk does that), so the terminal ignores them
 * - Ctrl+Tab: switches the WorkDesk's Tab, so the terminal must not take it as a Tab character
 */
export function terminalKey(e: KeyLike): KeyAction {
  const down = e.type === 'keydown'
  const send = (bytes: string): KeyAction => (down ? { swallow: true, send: bytes } : { swallow: true })
  if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) return send(NEW_LINE)
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey && !e.metaKey && e.ctrlKey !== e.altKey) {
    return send(e.key === 'ArrowLeft' ? WORD_BACK : WORD_FORWARD)
  }
  if (navDirection(e) || splitDirection(e)) return { swallow: true }
  if (cycleDelta(e) !== 0 || recentDelta(e) !== 0) return { swallow: true }
  return { swallow: false }
}

/** Ctrl+Tab is the next Tab, Ctrl+Shift+Tab the previous one; 0 for any other key. Only on key down. */
export function cycleDelta(e: KeyLike): 1 | -1 | 0 {
  if (e.type !== 'keydown' || e.key !== 'Tab' || !e.ctrlKey || e.altKey || e.metaKey) return 0
  return e.shiftKey ? -1 : 1
}

/** Opt+Tab walks back through the Tabs in the order they were used (Shift: forward again); 0 for any other key. Only on key down. */
export function recentDelta(e: KeyLike): 1 | -1 | 0 {
  if (e.type !== 'keydown' || e.key !== 'Tab' || !e.altKey || e.ctrlKey || e.metaKey) return 0
  return e.shiftKey ? -1 : 1
}

/** Command+C: copy what is selected in the terminal instead of sending Ctrl+C. Only on key down, and only with a selection. */
export const isCopyKey = (e: KeyLike, hasSelection: boolean): boolean =>
  e.type === 'keydown' && hasSelection && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c'

/**
 * OSC 52, "set the clipboard": `<targets>;<base64 text>`. tmux sends it when you select with the mouse in
 * copy mode (`set-clipboard external`). A "?" asks to read the clipboard, which a terminal should not hand out.
 */
export function decodeOsc52(data: string): string | undefined {
  const at = data.indexOf(';')
  if (at === -1) return undefined
  const payload = data.slice(at + 1)
  if (payload === '?' || payload === '') return undefined
  try {
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}

/**
 * What xterm.js answers to a program's questions about the terminal: device attributes (`ESC [ ? 1 ; 2 c`, `ESC [ > 0 ; 276 ; 0 c`),
 * a mode report (`ESC [ ? 2026 ; 2 $ y`), a colour (`ESC ] 11 ; rgb:… ESC \`). Typed keys never look like this.
 */
export const isTerminalReply = (data: string): boolean => /^\x1b\[[?>][\d;]*c$/.test(data) || /^\x1b\[\??[\d;]+\$y$/.test(data) || /^\x1b\]1[012];[^\x07\x1b]*(\x07|\x1b\\)$/.test(data)

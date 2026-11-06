import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { WebglAddon } from '@xterm/addon-webgl'
import { useEffect, useRef, useState } from 'react'
import { pollWhileFocused } from './poll'
import { setTerminalTitle } from './terminal-titles'
import { HiddenOutput, useTerminalActive } from './terminal-active'
import { decodeOsc52, isCopyKey, isTerminalReply, terminalKey } from './terminal-keys'
import { currentTheme, onThemeChange } from './theme'
import { findLinks, type TermRow } from './terminal-links'
import { useOpenLink } from './OpenLink'

interface Props {
  deskId: string
  paneId: string
  cwd: string
}

/** Shows a Pane's tmux window; unmounting only detaches, the shell keeps running in tmux. */
/** the size of the last terminal that was on screen */
let lastSize: { cols: number; rows: number } | undefined

export function TerminalPane({ deskId, paneId, cwd }: Props) {
  const host = useRef<HTMLDivElement>(null)
  // on screen or not: a hidden terminal draws nothing (its output is kept for later) and does not poll
  const active = useTerminalActive()
  const activeRef = useRef(active)
  activeRef.current = active
  // what the effect below hands out for the active state to use
  const show = useRef<(on: boolean) => void>(() => undefined)
  // what the link under the mouse offers (and, for a moment, that it was copied)
  const [hint, setHint] = useState<string>()
  // links open as a browser Tab of the WorkDesk (the effect below lives longer than a render, so it asks the ref)
  const openLink = useOpenLink()
  const openLinkRef = useRef(openLink)
  openLinkRef.current = openLink
  // where the shell is now, shown above the terminal so the prompt can stay short
  const [where, setWhere] = useState<{ display: string; cwd: string; branch?: string }>()
  useEffect(() => {
    if (!active) return
    let alive = true
    const look = () => void window.workdesk.terminalInfo(deskId, paneId).then((i) => alive && setWhere((cur) => (cur && i && cur.cwd === i.cwd && cur.branch === i.branch ? cur : i)), () => undefined)
    const off = pollWhileFocused(look, 3000)
    return () => {
      alive = false
      off()
    }
  }, [deskId, paneId, active])

  useEffect(() => {
    const api = window.workdesk
    const term = new Terminal({
      fontFamily: 'ui-monospace, Menlo, monospace',
      fontSize: 12,
      cursorBlink: true,
      // tmux has the mouse (selecting, scrolling): Option+drag selects in the terminal itself, as in Terminal.app
      macOptionClickForcesSelection: true,
      theme: currentTheme().xterm
    })
    const offTheme = onThemeChange((t) => (term.options.theme = t.xterm))
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current!)
    // A terminal that is not on screen has no size (its box is 0 wide) and keeps xterm's default of 80x24. If that went to tmux, the window
    // would be cut to 80x24 for everybody (the dots around the small box), so only a real size is ever sent.
    const sized = (): boolean => !!host.current && host.current.clientWidth > 0 && host.current.clientHeight > 0
    if (sized()) fit.fit()

    // tmux copies a mouse selection to the clipboard with OSC 52
    const osc52 = term.parser.registerOscHandler(52, (data) => {
      const text = decodeOsc52(data)
      if (text) void api.writeClipboard(text)
      return true
    })
    // links in the output (Claude prints pull requests and tickets): ⌘-click opens, ⌥⌘-click copies. tmux has the plain click and the mouse.
    // A link that goes on in the next row is found as one (tmux draws such rows as rows of their own).
    let hintTimer: ReturnType<typeof setTimeout> | undefined
    const links = term.registerLinkProvider({
      provideLinks(y, done) {
        const buf = term.buffer.active
        const first = Math.max(1, y - 6)
        const rows: TermRow[] = []
        for (let i = first; i <= Math.min(buf.length, y + 6); i++) {
          const line = buf.getLine(i - 1)
          rows.push({ text: line?.translateToString(true) ?? '', wrapped: line?.isWrapped })
        }
        const at = y - first + 1
        done(
          findLinks(rows, term.cols)
            .filter((l) => l.start.y <= at && l.end.y >= at)
            .map((l) => ({
              range: { start: { x: l.start.x, y: l.start.y + first - 1 }, end: { x: l.end.x, y: l.end.y + first - 1 } },
              text: l.url,
              hover: () => (clearTimeout(hintTimer), setHint('⌘-click opens the link in a Tab, ⌥⌘-click copies it')),
              leave: () => setHint(undefined),
              activate: (e, url) => {
                if (!e.metaKey) return
                if (e.altKey) {
                  void api.writeClipboard(url)
                  setHint('Link copied')
                  hintTimer = setTimeout(() => setHint(undefined), 1500)
                } else openLinkRef.current(url)
              }
            }))
        )
      }
    })
    // a hidden terminal keeps what it is sent; shown again it writes that, or has tmux repaint when too much came
    const hidden = new HiddenOutput()
    let webgl: WebglAddon | undefined
    // the title its program sets (tmux passes it on), for the list of tabs
    const offTitle = term.onTitleChange((t) => setTerminalTitle(paneId, t))
    const offData = api.onTerminalData((id, data) => {
      if (id !== paneId) return
      if (activeRef.current) term.write(data)
      else hidden.push(data)
    })
    // the shell (or the program the pane was started with, e.g. claude) ended: say so, the pane stays until it is closed
    const offExit = api.onTerminalExit((id) => id === paneId && term.write('\r\n\x1b[2m[This terminal has ended. Close the pane with × or ⌘W.]\x1b[0m\r\n'))
    let shown: boolean | undefined
    let replaying = 0
    show.current = (on) => {
      if (on === shown) return
      shown = on
      term.options.cursorBlink = on
      if (!on) {
        webgl?.dispose()
        webgl = undefined
        return
      }
      // the GPU draws what is on screen (a browser allows only a few WebGL contexts, so hidden terminals give theirs back)
      try {
        webgl = new WebglAddon()
        webgl.onContextLoss(() => (webgl?.dispose(), (webgl = undefined)))
        term.loadAddon(webgl)
      } catch {
        webgl = undefined
      }
      const pending = hidden.take()
      // what tmux asked while the terminal was out of sight (it asks about the terminal when it starts) is read now: the answers are too late for tmux
      // and would reach the shell as typed text (`1;2c0;276;0c2026;2$y`), so they are not sent
      if (pending && 'write' in pending) (replaying++, term.write(pending.write, () => void replaying--))
      else if (pending) {
        term.reset()
        // a resize makes tmux repaint the whole screen
        if (sized()) {
          fit.fit()
          api.terminalResize(paneId, Math.max(term.cols - 1, 2), term.rows)
          setTimeout(() => api.terminalResize(paneId, term.cols, term.rows), 30)
        }
      }
    }
    show.current(activeRef.current)
    // Shift+Enter is a new line, Ctrl/Option+arrows jump over words, Ctrl+Tab is left to the WorkDesk's Tabs
    term.attachCustomKeyEventHandler((e) => {
      // Command+C with a selection copies it; without one it is left alone
      if (isCopyKey(e, term.hasSelection())) {
        void api.writeClipboard(term.getSelection())
        return false
      }
      const k = terminalKey(e)
      if (k.send) api.terminalInput(paneId, k.send)
      return !k.swallow
    })
    const input = term.onData((data) => {
      if (replaying > 0 && isTerminalReply(data)) return
      api.terminalInput(paneId, data)
    })
    const area = term.textarea!
    const onFocus = () => api.paneFocus(deskId, paneId, true)
    const onBlur = () => api.paneFocus(deskId, paneId, false)
    area.addEventListener('focus', onFocus)
    area.addEventListener('blur', onBlur)
    // attached out of sight: with the size the other terminals had, not xterm's default
    if (sized()) lastSize = { cols: term.cols, rows: term.rows }
    void api.terminalAttach(deskId, paneId, cwd, sized() ? term.cols : (lastSize?.cols ?? 120), sized() ? term.rows : (lastSize?.rows ?? 36))

    const observer = new ResizeObserver(() => {
      if (!sized()) return
      fit.fit()
      lastSize = { cols: term.cols, rows: term.rows }
      api.terminalResize(paneId, term.cols, term.rows)
    })
    observer.observe(host.current!)

    return () => {
      observer.disconnect()
      area.removeEventListener('focus', onFocus)
      area.removeEventListener('blur', onBlur)
      api.paneFocus(deskId, paneId, false)
      offData()
      offTitle.dispose()
      offExit()
      show.current = () => undefined
      webgl?.dispose()
      offTheme()
      osc52.dispose()
      links.dispose()
      clearTimeout(hintTimer)
      input.dispose()
      api.terminalDetach(paneId)
      term.dispose()
    }
  }, [deskId, paneId, cwd])

  // shown or hidden after the terminal was made
  useEffect(() => show.current(active), [active])

  return (
    <div className="terminal-wrap">
      <div className="path-bar">
        <input readOnly value={where?.display ?? ''} placeholder="…" title={where?.cwd ?? ''} onFocus={(e) => e.target.select()} aria-label="Folder of this terminal" />
        {where?.branch && <code className="path-branch" title="Branch checked out in this folder">{where.branch}</code>}
        {hint && <span className="hint term-hint">{hint}</span>}
      </div>
      <div className="terminal" ref={host} />
    </div>
  )
}

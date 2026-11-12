/**
 * Selecting in a terminal works like in Terminal.app: dragging, a double click (a word) or a triple click (a line)
 * selects and the selection stays; Command+C copies it. tmux keeps the mouse (the app scrolls with it), so this is
 * done with tmux's own selection: its default bindings copy as soon as the mouse is let go and leave copy mode.
 *
 * Command+C and "typed after selecting" have no tmux key, so the terminal sends two sequences of its own that tmux
 * knows as `User0` and `User1` (`user-keys`). In the stream of the pty they stay in order with what is typed.
 */

/** Command+C without a selection of the terminal itself: copy tmux's selection (via OSC 52), it stays selected */
export const COPY_KEY = '\x1b[9001~'
/** sent before the first key typed after selecting: the selection goes and copy mode ends, so the key reaches the shell */
export const END_SELECTION_KEY = '\x1b[9002~'

/** a mouse report of xterm.js (SGR `ESC [ <`, or the old `ESC [ M`): a click, a drag or the wheel, not typed */
export const isMouseReport = (data: string): boolean => data.startsWith('\x1b[<') || data.startsWith('\x1b[M')

// in the root table the two keys do nothing: `select-pane` on the pane that has them already
const NOTHING = 'select-pane'
// selecting with the mouse goes on as tmux does it when the program in the pane wants the mouse itself (claude, vim)
const passOrEnter = (select: string) => `select-pane -t = ; if-shell -F "#{||:#{pane_in_mode},#{mouse_any_flag}}" { send-keys -M } { copy-mode -H ; send-keys -X ${select} }`

/** One tmux command line (commands split by `;` arguments) that sets the bindings on the server; both copy-mode tables. */
export function copyBindings(): string[] {
  const commands: string[][] = [
    ['set-option', '-s', 'user-keys[0]', COPY_KEY],
    ['set-option', '-s', 'user-keys[1]', END_SELECTION_KEY],
    ['bind-key', '-T', 'root', 'User0', NOTHING],
    ['bind-key', '-T', 'root', 'User1', NOTHING],
    // dragging enters copy mode like tmux's default, but without the position indicator at the top
    ['bind-key', '-T', 'root', 'MouseDrag1Pane', 'if-shell -F "#{||:#{pane_in_mode},#{mouse_any_flag}}" { send-keys -M } { copy-mode -M -H }'],
    ['bind-key', '-T', 'root', 'DoubleClick1Pane', passOrEnter('select-word')],
    ['bind-key', '-T', 'root', 'TripleClick1Pane', passOrEnter('select-line')]
  ]
  for (const table of ['copy-mode', 'copy-mode-vi']) {
    commands.push(
      ['bind-key', '-T', table, 'User0', 'send-keys -X copy-pipe-no-clear'],
      ['bind-key', '-T', table, 'User1', 'send-keys -X cancel'],
      // letting go keeps the selection (no copy)
      ['bind-key', '-T', table, 'MouseDragEnd1Pane', 'send-keys -X stop-selection'],
      ['bind-key', '-T', table, 'DoubleClick1Pane', 'select-pane ; send-keys -X select-word'],
      ['bind-key', '-T', table, 'TripleClick1Pane', 'select-pane ; send-keys -X select-line'],
      // a click takes the selection away; at the bottom it also ends copy mode, scrolled up it stays where it is
      ['bind-key', '-T', table, 'MouseDown1Pane', 'select-pane ; if-shell -F "#{==:#{scroll_position},0}" { send-keys -X cancel } { send-keys -X clear-selection }']
    )
  }
  return commands.flatMap((c, i) => (i === 0 ? c : [';', ...c]))
}

import { setPaneControls, usePaneControls } from './pane-controls'

const GROUPS: { title: string; rows: [keys: string[][], what: string][] }[] = [
  {
    title: 'Panes',
    rows: [
      [[['⌘', '← → ↑ ↓']], 'Move the focus to the neighbouring pane (also from a browser page)'],
      [[['⌘', '⇧', '← → ↑ ↓']], 'Split the focused pane in that direction; then choose Terminal or Browser (arrows, Enter, T or B)'],
      [[['⌘', 'W']], 'Close the focused pane (asks first when something is running)']
    ]
  },
  {
    title: 'Tabs and WorkDesks',
    rows: [
      [[['⌘', 'T']], 'New tab; then choose Terminal or Browser (on the Browser page: a new page tab)'],
      [[['Ctrl', 'Tab'], ['Ctrl', '⇧', 'Tab']], 'Next / previous tab of the WorkDesk'],
      [[['⌘', '1…9']], 'Switch to the WorkDesk at that place in the left panel'],
      [[['⌘', 'F']], 'Search in the web page that is shown'],
      [[['⌥', '⌘', 'I']], 'Developer tools of the web page that is shown (⇧ for the app\'s own)'],
      [[['⌘', 'R']], 'Reload the web page that is shown']
    ]
  },
  {
    title: 'Terminal',
    rows: [
      [[['⇧', 'Enter']], 'New line without submitting (also in Claude Code)'],
      [[['Ctrl', '← →'], ['⌥', '← →']], 'Jump over a word'],
      [[['⌘', 'C']], 'Copy the selection (without one it is left alone; Ctrl+C stays the interrupt)'],
      [[['⌥', 'drag']], 'Select text in the terminal itself instead of in tmux']
    ]
  },
  {
    title: 'File panes',
    rows: [
      [[['Ctrl', '-'], ['Ctrl', '⇧', '-']], 'Back / forward through the places the cursor was, across files'],
      [[['⌘', 'S']], 'Save the file'],
      [[['⌘', 'B']], 'Show or hide the files, changes and search on the left'],
      [[['⌥', '⇧', 'F7']], 'Find usages of the name at the cursor or of the selection (text based, whole words, in the branch scope)'],
      [[['⌥', '⇧', 'F6']], 'Rename the symbol at the cursor: preview with a checkbox per match, then apply (text based)']
    ]
  },
  {
    title: 'App',
    rows: [
      [[['⌥', '⌘', 'T']], 'Capture a Todo from anywhere (global): into the WorkDesk you are in, else into Today'],
      [[['⌥', '⌘', 'Q']], 'Quit and stop all terminals without asking']
    ]
  }
]

/** What the keyboard can do. Not configurable yet; the buttons on the panes can be hidden for working by keyboard. */
export function ShortcutsPanel() {
  const shown = usePaneControls()
  return (
    <section>
      <h2>Shortcuts</h2>
      <label className="field inline">
        <input type="checkbox" checked={shown} onChange={(e) => setPaneControls(e.target.checked)} />
        <span>Show the buttons on each pane (split, move, close)</span>
      </label>
      <p className="hint">Hide them when you work with the keyboard; everything they do has a shortcut below. The tab bar keeps its buttons.</p>
      <table className="shortcuts">
        <tbody>
          {GROUPS.flatMap((g) => [
            <tr key={g.title}><th colSpan={2}>{g.title}</th></tr>,
            ...g.rows.map(([combos, what]) => (
              <tr key={g.title + what}>
                <td>
                  {combos.map((keys, i) => (
                    <div key={i}>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</div>
                  ))}
                </td>
                <td>{what}</td>
              </tr>
            ))
          ])}
        </tbody>
      </table>
    </section>
  )
}

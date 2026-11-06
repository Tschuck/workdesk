// Turns `workdesk desk open beta` and friends into one control request for the app.
export const HELP = `workdesk <group> <command> [options]   (run in a WorkDesk terminal; answers are JSON)

  desk list                          all WorkDesks
  desk current                       the WorkDesk of this folder
  desk open [<id|name>]              bring it to the front (starts a planned one)
  desk start <title> [--todo <id>…]  a Plain WorkDesk
  desk combine <id|name>…            take those WorkDesks into this one (branch folders, pull requests, Todos, time), then clear them
  desk claude <prompt…> [--name <tab>]  a new Terminal Tab in that WorkDesk that runs Claude with the prompt (use --desk)
  desk park [<id|name>]              shut its terminals down, keep everything
  desk clear [<id|name>] [--yes]     without --yes: only the unsaved work it would lose

  pane read <pane|tab> [--lines <n>]  what a terminal Pane shows (also a running Claude session; the pane id is under claudeSessions of "desk list"), default 200 lines
  pane send <pane|tab> <text…> [--no-enter]  type into it as if by hand, then Enter

  branch add <project> <branch> [--base <branch>]
  branch remove <project> <branch>   takes the folder out of the WorkDesk, keeps the branch

  todo list | add <title> | done <id> | reopen <id>

  review state [--root <project|path>] [--preset <name>]   --preset: only the changed files of that Review preset
  review comment <file> <line> <text…> [--root <project|path>]
  review note <text…> [--root <project|path>]   a comment on the review as a whole
  review preset list                 the Review presets of this WorkDesk (which changed files a review shows)
  review preset add <name> [--description <text>] [--include <glob>]… [--exclude <glob>]… [--file <path>]…
  review preset remove <name>

Options: --desk <id|name> acts on another WorkDesk than this folder's.`

/** @returns {{control?: string, args?: object, error?: string}} */
export function parseControl(argv) {
  const [group, command, ...rest] = argv
  const args = {}
  const words = []
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--yes') args.confirm = true
    else if (a === '--no-enter') args.enter = false
    else if (a === '--lines') args.lines = Number(rest[++i])
    else if (a === '--desk' || a === '--name' || a === '--root' || a === '--base' || a === '--preset') args[a.slice(2)] = rest[++i]
    else if (a === '--todo') (args.todos ??= []).push(rest[++i])
    else if (a === '--include' || a === '--exclude') (args[a.slice(2)] ??= []).push(rest[++i])
    else if (a === '--file') (args.files ??= []).push(rest[++i])
    else if (a === '--description') args.description = rest[++i]
    else words.push(a)
  }
  const need = (n, what) => (words.length < n ? `Missing ${what}` : undefined)
  const control = `${group}.${command}`
  switch (control) {
    case 'desk.list':
    case 'desk.current':
    case 'todo.list':
      return { control, args }
    case 'desk.open':
    case 'desk.park':
    case 'desk.clear':
      if (words[0]) args.desk = words[0]
      return { control, args }
    case 'desk.combine':
      if (need(1, 'the WorkDesk to take in')) return { error: need(1, 'the WorkDesk to take in') }
      return { control, args: { ...args, others: words } }
    case 'pane.read':
      if (need(1, 'a Pane id or Tab name')) return { error: need(1, 'a Pane id or Tab name') }
      return { control, args: { ...args, target: words.join(' ') } }
    case 'pane.send':
      if (need(2, 'a Pane id or Tab name, and a text')) return { error: need(2, 'a Pane id or Tab name, and a text') }
      return { control, args: { ...args, target: words[0], text: words.slice(1).join(' ') } }
    case 'desk.claude':
      if (need(1, 'a prompt')) return { error: need(1, 'a prompt') }
      return { control, args: { ...args, prompt: words.join(' ') } }
    case 'desk.start':
      if (need(1, 'a title')) return { error: need(1, 'a title') }
      return { control, args: { ...args, title: words.join(' ') } }
    case 'branch.add':
    case 'branch.remove':
      if (need(2, 'a project and a branch')) return { error: need(2, 'a project and a branch') }
      return { control, args: { ...args, project: words[0], branch: words[1] } }
    case 'todo.add':
      if (need(1, 'a title')) return { error: need(1, 'a title') }
      return { control, args: { ...args, title: words.join(' ') } }
    case 'todo.done':
    case 'todo.reopen':
      if (need(1, 'a Todo id')) return { error: need(1, 'a Todo id') }
      return { control: 'todo.resolve', args: { ...args, id: words[0], resolved: command === 'done' } }
    case 'review.state':
      return { control, args }
    case 'review.preset': {
      const action = words[0] ?? 'list'
      if (!['list', 'add', 'remove'].includes(action)) return { error: 'Use: review preset list | add <name> … | remove <name>' }
      if (action !== 'list' && !words[1]) return { error: 'Missing the name of the preset' }
      return { control, args: { ...args, action, name: words.slice(1).join(' ') } }
    }
    case 'review.note':
      if (need(1, 'a text')) return { error: need(1, 'a text') }
      return { control, args: { ...args, text: words.join(' ') } }
    case 'review.comment':
      if (need(3, 'a file, a line and a text')) return { error: need(3, 'a file, a line and a text') }
      return { control, args: { ...args, file: words[0], line: Number(words[1]), text: words.slice(2).join(' ') } }
    default:
      return { error: `Unknown command: ${[group, command].filter(Boolean).join(' ')}` }
  }
}

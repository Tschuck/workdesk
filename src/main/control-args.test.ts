import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module of the CLI
import { parseControl } from '../../cli/control-args.mjs'

describe('workdesk CLI arguments', () => {
  it('reads and sends to a Pane', () => {
    expect(parseControl(['pane', 'read', 'p1', '--lines', '50', '--desk', 'a'])).toEqual({ control: 'pane.read', args: { lines: 50, desk: 'a', target: 'p1' } })
    expect(parseControl(['pane', 'send', 'p1', 'yes', 'please', '--no-enter'])).toEqual({ control: 'pane.send', args: { enter: false, target: 'p1', text: 'yes please' } })
    expect(parseControl(['pane', 'send', 'p1']).error).toBeDefined()
  })
  it('turns words and options into a request', () => {
    expect(parseControl(['desk', 'open', 'Beta'])).toEqual({ control: 'desk.open', args: { desk: 'Beta' } })
    expect(parseControl(['desk', 'clear', '--yes', '--desk', 'a'])).toEqual({ control: 'desk.clear', args: { confirm: true, desk: 'a' } })
    expect(parseControl(['branch', 'add', 'api', 'feat/x', '--base', 'main'])).toEqual({ control: 'branch.add', args: { base: 'main', project: 'api', branch: 'feat/x' } })
    expect(parseControl(['todo', 'done', 't1'])).toEqual({ control: 'todo.resolve', args: { id: 't1', resolved: true } })
    expect(parseControl(['pr', 'add', 'https://github.com/o/r/pull/7', '--title', 'Fix it'])).toEqual({ control: 'pr.add', args: { pr: 'https://github.com/o/r/pull/7', title: 'Fix it' } })
    expect(parseControl(['pr', 'add'])).toMatchObject({ error: expect.stringContaining('Missing') })
    expect(parseControl(['review', 'comment', 'a.ts', '12', 'rename', 'this'])).toEqual({ control: 'review.comment', args: { file: 'a.ts', line: 12, text: 'rename this' } })
  })
  it('says what is missing', () => {
    expect(parseControl(['branch', 'add', 'api'])).toMatchObject({ error: expect.stringContaining('project and a branch') })
    expect(parseControl(['desk', 'nope'])).toMatchObject({ error: expect.stringContaining('Unknown') })
  })
})

import { describe, expect, it } from 'vitest'
import { COPY_KEY, copyBindings, END_SELECTION_KEY, isMouseReport } from './tmux-copy'

const commands = () => {
  const out: string[][] = [[]]
  for (const a of copyBindings()) a === ';' ? out.push([]) : out[out.length - 1].push(a)
  return out
}
const binding = (table: string, key: string) => commands().find((c) => c[0] === 'bind-key' && c[2] === table && c[3] === key)?.[4]

describe('selecting in a terminal', () => {
  it('knows the two keys of the terminal', () => {
    expect(commands()).toContainEqual(['set-option', '-s', 'user-keys[0]', COPY_KEY])
    expect(commands()).toContainEqual(['set-option', '-s', 'user-keys[1]', END_SELECTION_KEY])
  })

  it('keeps the selection when the mouse is let go, in both copy-mode tables', () => {
    for (const table of ['copy-mode', 'copy-mode-vi']) {
      expect(binding(table, 'MouseDragEnd1Pane')).toBe('send-keys -X stop-selection')
      expect(binding(table, 'DoubleClick1Pane')).not.toContain('copy')
      expect(binding(table, 'TripleClick1Pane')).not.toContain('copy')
    }
    expect(binding('root', 'DoubleClick1Pane')).not.toContain('copy-pipe')
    expect(binding('root', 'MouseDrag1Pane')).toContain('copy-mode -M -H')
  })

  it('copies on Command+C and leaves the selection, ends copy mode on typing', () => {
    expect(binding('copy-mode', 'User0')).toBe('send-keys -X copy-pipe-no-clear')
    expect(binding('copy-mode', 'User1')).toBe('send-keys -X cancel')
    expect(binding('root', 'User0')).toBe('select-pane')
  })

  it('tells mouse reports from typed keys', () => {
    expect(isMouseReport('\x1b[<0;10;5M')).toBe(true)
    expect(isMouseReport('\x1b[M !!')).toBe(true)
    expect(isMouseReport('a')).toBe(false)
    expect(isMouseReport('\x1b[A')).toBe(false)
  })
})

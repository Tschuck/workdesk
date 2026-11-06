import { describe, expect, it } from 'vitest'
import { toMonacoTheme } from './vscode-theme'

describe('VS Code theme in Monaco', () => {
  it('colours keywords like the storage of VS Code (orange) rather than like keyword.control (red), and decorators like punctuation', () => {
    const t = toMonacoTheme({ tokenColors: [{ scope: 'storage.type', settings: { foreground: '#fe8019' } }, { scope: 'keyword', settings: { foreground: '#fb4934' } }, { scope: 'punctuation', settings: { foreground: '#a89984' } }] })
    expect(t.rules.filter((r) => r.token === 'keyword')).toEqual([{ token: 'keyword', foreground: 'fe8019' }])
    expect(t.rules).toContainEqual({ token: 'annotation', foreground: 'a89984' })
  })

  it('maps scopes to the tokens of Monaco, the most specific one winning, and keeps the editor colours', () => {
    const t = toMonacoTheme({
      type: 'dark',
      colors: { 'editor.background': '#1d2021', 'editor.lineHighlightBackground': '#3c383660', 'activityBar.background': '#000000' },
      tokenColors: [
        { settings: { foreground: '#ebdbb2' } },
        { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#928374', fontStyle: 'italic' } },
        { scope: 'constant.numeric', settings: { foreground: '#d3869b' } },
        { scope: 'entity.name.type.class', settings: { foreground: '#fabd2f' } },
        { scope: ['string.other.link.title.markdown', 'storage.type.annotation', 'constant.other.caps'], settings: { fontStyle: 'underline bold' } },
        { scope: 'text.html entity.name.tag', settings: { fontStyle: 'bold' } }
      ]
    })
    expect(t.base).toBe('vs-dark')
    expect(t.colors).toEqual({ 'editor.background': '#1d2021', 'editor.lineHighlightBackground': '#3c383660', 'editor.foreground': '#ebdbb2' })
    expect(t.rules[0]).toEqual({ token: '', foreground: 'ebdbb2' })
    expect(t.rules).toContainEqual({ token: 'comment', foreground: '928374', fontStyle: 'italic' })
    expect(t.rules).toContainEqual({ token: 'number', foreground: 'd3869b' })
    expect(t.rules).not.toContainEqual({ token: 'constant', foreground: 'd3869b' })
    // scopes of one language or one place do not style every string or keyword
    expect(t.rules.some((r) => r.fontStyle?.includes('bold') || r.fontStyle?.includes('underline'))).toBe(false)
    expect(t.rules).toContainEqual({ token: 'type.identifier', foreground: 'fabd2f' })
  })
})

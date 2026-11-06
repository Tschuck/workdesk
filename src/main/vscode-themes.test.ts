import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listCodeThemes, loadCodeTheme, parseJsonc, readEditorFont } from './vscode-themes'

describe('vscode themes', () => {
  it('reads JSON with comments and trailing commas', () => {
    expect(parseJsonc('{ // a\n "a": "x // not a comment", /* b */ "b": [1,2,], }')).toEqual({ a: 'x // not a comment', b: [1, 2] })
  })

  it('lists the themes of the installed extensions and the one in use, and loads one with its include', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'themes-'))
    await mkdir(join(dir, 'ext-1.0', 'themes'), { recursive: true })
    await writeFile(join(dir, 'ext-1.0', 'package.json'), JSON.stringify({ contributes: { themes: [{ label: 'Hard', uiTheme: 'vs-dark', path: './themes/hard.json' }] } }))
    await writeFile(join(dir, 'ext-1.0', 'themes', 'base.json'), '{ "colors": { "a": "#111" }, "tokenColors": [{ "scope": "x" }] }')
    await writeFile(join(dir, 'ext-1.0', 'themes', 'hard.json'), '{ "include": "./base.json", "colors": { "b": "#222" }, "tokenColors": [{ "scope": "y" }] }')
    await writeFile(join(dir, 'settings.json'), '{ // x\n "workbench.colorTheme": "Hard", }')
    const list = await listCodeThemes(dir, join(dir, 'settings.json'))
    expect(list).toEqual({ themes: [{ id: 'ext-1.0/themes/hard.json', label: 'Hard', dark: true }], current: 'Hard' })
    const t = await loadCodeTheme('ext-1.0/themes/hard.json', dir)
    expect(t.colors).toEqual({ a: '#111', b: '#222' })
    expect(t.tokenColors).toEqual([{ scope: 'x' }, { scope: 'y' }])
    await expect(loadCodeTheme('../../etc/passwd', dir)).rejects.toThrow()
  })

  it('reads the font of the editor from the settings of VS Code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'font-'))
    await writeFile(join(dir, 's.json'), '{ "editor.fontFamily": "JetBrains Mono", "editor.fontSize": 12, "editor.lineHeight": 1.6, "editor.letterSpacing": 0.5, "editor.fontLigatures": true, // x\n }')
    expect(await readEditorFont(join(dir, 's.json'))).toEqual({ fontFamily: 'JetBrains Mono', fontSize: 12, lineHeight: 1.6, letterSpacing: 0.5, fontLigatures: true })
    expect(await readEditorFont(join(dir, 'none.json'))).toEqual({})
  })
})

import { textmateThemeToMonacoTheme } from '@shikijs/monaco'
import { EncodedTokenMetadata, INITIAL } from '@shikijs/vscode-textmate'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import type * as Monaco from 'monaco-editor'
import type { VsCodeTheme } from './vscode-theme'

/**
 * The colours of VS Code in the editor: TextMate grammars (Shiki's engine) in place of Monaco's own tokenizers, so a theme of VS Code
 * is used as it is. Past the limits below a file goes back to Monaco's tokenizer (cheap, coarser), and the pane says so.
 */
type MonacoApi = typeof Monaco

/** past this many characters (or a line this long) the tokenizer of Monaco colours the file */
export const MAX_CHARS = 400_000
export const MAX_LINE = 2_000

interface Lang {
  /** the grammar of Shiki */
  grammar: string
  load: () => Promise<unknown>
  /** Monaco's own tokenizer of the language, for what is past the limits */
  basic?: () => Promise<{ language: Monaco.languages.IMonarchLanguage; conf: Monaco.languages.LanguageConfiguration }>
}

const basic = (load: () => Promise<unknown>) => load as Lang['basic']

// by the language of Monaco; a grammar and Monaco's tokenizer are only loaded when a file of the language is opened
const LANGS: Record<string, Lang> = {
  // TSX is a superset for what a .ts file needs, and Monaco has one language for both
  typescript: { grammar: 'tsx', load: () => import('shiki/langs/tsx.mjs'), basic: basic(() => import('monaco-editor/languages/definitions/typescript/typescript.js')) },
  javascript: { grammar: 'javascript', load: () => import('shiki/langs/javascript.mjs'), basic: basic(() => import('monaco-editor/languages/definitions/javascript/javascript.js')) },
  json: { grammar: 'json', load: () => import('shiki/langs/json.mjs') },
  yaml: { grammar: 'yaml', load: () => import('shiki/langs/yaml.mjs'), basic: basic(() => import('monaco-editor/languages/definitions/yaml/yaml.js')) },
  markdown: { grammar: 'markdown', load: () => import('shiki/langs/markdown.mjs'), basic: basic(() => import('monaco-editor/languages/definitions/markdown/markdown.js')) },
  css: { grammar: 'css', load: () => import('shiki/langs/css.mjs') },
  scss: { grammar: 'scss', load: () => import('shiki/langs/scss.mjs') },
  html: { grammar: 'html', load: () => import('shiki/langs/html.mjs') },
  shell: { grammar: 'shellscript', load: () => import('shiki/langs/shellscript.mjs'), basic: basic(() => import('monaco-editor/languages/definitions/shell/shell.js')) },
  python: { grammar: 'python', load: () => import('shiki/langs/python.mjs'), basic: basic(() => import('monaco-editor/languages/definitions/python/python.js')) },
  go: { grammar: 'go', load: () => import('shiki/langs/go.mjs'), basic: basic(() => import('monaco-editor/languages/definitions/go/go.js')) },
  rust: { grammar: 'rust', load: () => import('shiki/langs/rust.mjs'), basic: basic(() => import('monaco-editor/languages/definitions/rust/rust.js')) },
  java: { grammar: 'java', load: () => import('shiki/langs/java.mjs'), basic: basic(() => import('monaco-editor/languages/definitions/java/java.js')) },
  sql: { grammar: 'sql', load: () => import('shiki/langs/sql.mjs'), basic: basic(() => import('monaco-editor/languages/definitions/sql/sql.js')) },
  dockerfile: { grammar: 'dockerfile', load: () => import('shiki/langs/dockerfile.mjs'), basic: basic(() => import('monaco-editor/languages/definitions/dockerfile/dockerfile.js')) },
  xml: { grammar: 'xml', load: () => import('shiki/langs/xml.mjs'), basic: basic(() => import('monaco-editor/languages/definitions/xml/xml.js')) },
  ini: { grammar: 'ini', load: () => import('shiki/langs/ini.mjs'), basic: basic(() => import('monaco-editor/languages/definitions/ini/ini.js')) }
}

let highlighter: Promise<HighlighterCore> | undefined
const getHighlighter = (): Promise<HighlighterCore> => (highlighter ??= createHighlighterCore({ themes: [], langs: [], engine: createOnigurumaEngine(import('shiki/wasm')) }))

class State {
  constructor(readonly stack: typeof INITIAL) {}
  clone(): State {
    return this
  }
  equals(other: unknown): boolean {
    return other === this
  }
}

const norm = (c: string | undefined): string | undefined => (c ? (c.startsWith('#') ? c.slice(1) : c).toLowerCase() : undefined)
// the bits of vscode-textmate's FontStyle (a const enum, which cannot be imported here)
const styleOf = (bits: number): string => [bits & 1 ? 'italic' : '', bits & 2 ? 'bold' : '', bits & 4 ? 'underline' : ''].filter(Boolean).join(' ')

let colorMap: string[] = []
/** the token of Monaco for a colour of the theme and a font style (italic 1, bold 2, underline 4): one rule of the theme paints each */
const tokenFor = (colorIndex: number, bits: number): string => `tm${colorIndex}_${bits & 7}`
const registered = new Set<string>()
let themeSeq = 0

/** Use a theme of VS Code for the TextMate grammars; returns the rules for the Monaco theme (which must be set after this). */
export async function setTextmateTheme(monaco: MonacoApi, vs: VsCodeTheme): Promise<Monaco.editor.IStandaloneThemeData> {
  const h = await getHighlighter()
  const name = `vscode-${++themeSeq}`
  await h.loadTheme({ name, type: vs.type === 'light' ? 'light' : 'dark', colors: vs.colors ?? {}, tokenColors: (vs.tokenColors ?? []) as never, settings: (vs.tokenColors ?? []) as never })
  const tm = textmateThemeToMonacoTheme(h.getTheme(name)) as unknown as Monaco.editor.IStandaloneThemeData
  colorMap = [...h.setTheme(name).colorMap]
  // a token for every colour and style of the grammars, not the scopes of the theme: no guessing which rule a colour came from
  const rules: Monaco.editor.ITokenThemeRule[] = []
  colorMap.forEach((c, i) => {
    const color = norm(c)
    if (color) for (let bits = 0; bits < 8; bits++) rules.push({ token: tokenFor(i, bits), foreground: color, fontStyle: styleOf(bits) })
  })
  const theme: Monaco.editor.IStandaloneThemeData = { base: tm.base, inherit: false, colors: tm.colors, rules }
  // the grammars already in use take the new colours at once
  for (const lang of registered) provide(monaco, h, lang)
  return theme
}

function provide(monaco: MonacoApi, h: HighlighterCore, lang: string): void {
  const grammar = LANGS[lang].grammar
  monaco.languages.setTokensProvider(lang, {
    getInitialState: () => new State(INITIAL),
    tokenize(line, state) {
      const s = state as State
      if (line.length >= MAX_LINE) return { endState: s, tokens: [{ startIndex: 0, scopes: '' }] }
      const result = h.getLanguage(grammar).tokenizeLine2(line, s.stack, 500)
      const tokens: Monaco.languages.IToken[] = []
      for (let i = 0; i < result.tokens.length / 2; i++) {
        const meta = result.tokens[2 * i + 1]
        tokens.push({ startIndex: result.tokens[2 * i], scopes: tokenFor(EncodedTokenMetadata.getForeground(meta), EncodedTokenMetadata.getFontStyle(meta)) })
      }
      return { endState: new State(result.ruleStack), tokens }
    }
  })
}

const basicIds = new Set<string>()

/**
 * Make a model ready for colours: its grammar is loaded and takes over its language. Past the limits the model goes to Monaco's
 * own tokenizer instead; the answer says which one colours it (`simplified` is for the warning).
 */
export async function prepareModel(monaco: MonacoApi, model: Monaco.editor.ITextModel, enabled: boolean): Promise<{ simplified: boolean }> {
  const lang = model.getLanguageId()
  const spec = LANGS[lang]
  if (!enabled || !spec) return { simplified: false }
  const tooBig = model.getValueLength() > MAX_CHARS || model.getLinesContent().some((l) => l.length > MAX_LINE)
  if (tooBig) {
    if (!spec.basic) return { simplified: false }
    const id = `basic-${lang}`
    if (!basicIds.has(id)) {
      const def = await spec.basic()
      monaco.languages.register({ id })
      monaco.languages.setMonarchTokensProvider(id, def.language)
      monaco.languages.setLanguageConfiguration(id, def.conf)
      basicIds.add(id)
    }
    monaco.editor.setModelLanguage(model, id)
    return { simplified: true }
  }
  if (!registered.has(lang)) {
    const h = await getHighlighter()
    await h.loadLanguage((await spec.load()) as never)
    registered.add(lang)
    provide(monaco, h, lang)
  }
  return { simplified: false }
}

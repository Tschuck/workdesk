// Monaco for the File pane: the editor, the tokenizers of the common languages, and the language services of TypeScript/JavaScript,
// JSON, CSS and HTML (each runs in a worker). This file is loaded when the first File pane opens, not at the start of the app.
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { APP_CODE_THEME, onCodeFontChange, onCodeThemeChange, resolveCodeTheme, resolveFont, type FontOptions } from './code-theme'
import { currentTheme, onThemeChange, type Theme } from './theme'
import { setTextmateTheme, prepareModel } from './tm-monaco'
import { toMonacoTheme, type VsCodeTheme } from './vscode-theme'

;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_id: string, label: string): Worker {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

// A file is looked at alone: Monaco does not know the project (no tsconfig, no node_modules), so type errors
// ("cannot find module") would be wrong. Syntax errors are right, and are shown.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false, noSuggestionDiagnostics: true })
  defaults.setEagerModelSync(false)
}

/** The colours of the app as a theme of VS Code, so that one way colours the editor whichever theme is chosen. */
function appAsVsCode(t: Theme): VsCodeTheme {
  const p = t.palette
  return {
    type: t.id.includes('light') ? 'light' : 'dark',
    colors: {
      'editor.background': p.bg,
      'editor.foreground': p.fg,
      'editorLineNumber.foreground': p.fg + '66',
      'editorLineNumber.activeForeground': p.fgBright,
      'editor.lineHighlightBackground': p.fg + '1a',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': p.yellow + '44',
      'editorCursor.foreground': p.yellow,
      'editorWidget.background': p.bgDark,
      'editorSuggestWidget.background': p.bgDark,
      'scrollbarSlider.background': p.fg + '33'
    },
    tokenColors: [
      { settings: { foreground: p.fg } },
      { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: p.fg, fontStyle: 'italic' } },
      { scope: ['string'], settings: { foreground: p.green } },
      { scope: ['constant', 'constant.numeric'], settings: { foreground: p.purple } },
      { scope: ['keyword', 'storage'], settings: { foreground: p.red } },
      { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'], settings: { foreground: p.yellow } },
      { scope: ['entity.name.tag'], settings: { foreground: p.red } },
      { scope: ['entity.other.attribute-name'], settings: { foreground: p.yellow } },
      { scope: ['punctuation'], settings: { foreground: p.fg } }
    ]
  }
}

/** the theme of VS Code that is in use, when one is; else the colours of the app */
let vsTheme: VsCodeTheme | undefined
/** the TextMate grammars colour the files; false when they could not start (then Monaco's tokenizers do) */
let textmate = false
/** why the grammars did not start, to say so in the pane */
let textmateError: string | undefined
let round = 0

/** Define the theme of the editor: the colours of the TextMate grammars, and for what Monaco's own tokenizers colour the mapped ones. */
async function redefine(): Promise<void> {
  const mine = ++round
  const vs = vsTheme ?? appAsVsCode(currentTheme())
  const basic = toMonacoTheme(vs)
  try {
    const tm = await setTextmateTheme(monaco, vs)
    if (mine !== round) return
    monaco.editor.defineTheme('workdesk', { ...tm, rules: [...basic.rules, ...tm.rules] })
    textmate = true
    textmateError = undefined
  } catch (e) {
    console.warn('TextMate grammars did not start, Monaco colours the files:', e)
    if (mine !== round) return
    textmate = false
    textmateError = e instanceof Error ? e.message : String(e)
    monaco.editor.defineTheme('workdesk', basic)
  }
  monaco.editor.setTheme('workdesk')
}

async function useCodeTheme(id: string): Promise<void> {
  try {
    vsTheme = id === APP_CODE_THEME ? undefined : ((await window.workdesk.codeTheme(id)) as VsCodeTheme)
  } catch {
    vsTheme = undefined
  }
  await redefine()
}

const started = (async () => {
  // something that is shown at once: the colours of the app by Monaco, until the grammars and the chosen theme are there
  monaco.editor.defineTheme('workdesk', toMonacoTheme(appAsVsCode(currentTheme())))
  await resolveCodeTheme().then(useCodeTheme)
})()
onThemeChange(() => void redefine())
onCodeThemeChange((id) => void useCodeTheme(id))

/** the font of the editors: the app's, or the one of your VS Code; every editor takes it, new ones too */
let font: FontOptions | undefined
const applyFont = (ed: monaco.editor.ICodeEditor): void => font && ed.updateOptions(font)
monaco.editor.onDidCreateEditor(applyFont)
const loadFont = (): Promise<void> => resolveFont().then((f) => ((font = f), monaco.editor.getEditors().forEach(applyFont)))
onCodeFontChange(() => void loadFont())
const fontReady = loadFont()

/** Get a model ready for colours; `simplified` when it is too large for the grammars and Monaco's own tokenizer colours it. */
export async function prepareCodeModel(model: monaco.editor.ITextModel): Promise<{ simplified: boolean; failed?: string }> {
  await Promise.all([started, fontReady])
  return { ...(await prepareModel(monaco, model, textmate)), ...(textmateError ? { failed: textmateError } : {}) }
}

export { monaco }

// scripts/perf-measure.mjs types into the editor through Monaco itself (a synthetic key press does not reach its input element)
try {
  if (localStorage.getItem('workdesk.perf')) (window as unknown as { __monaco: typeof monaco }).__monaco = monaco
} catch {
  // no storage, no hook
}

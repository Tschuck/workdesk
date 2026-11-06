/** A colour theme of VS Code (its JSON file), as far as the editor of a File pane can use it. */
interface TokenRule {
  scope?: string | string[]
  settings?: { foreground?: string; fontStyle?: string }
}
export interface VsCodeTheme {
  name?: string
  type?: string
  colors?: Record<string, string>
  tokenColors?: TokenRule[]
}

export interface MonacoTheme {
  base: 'vs' | 'vs-dark' | 'hc-black'
  inherit: boolean
  rules: { token: string; foreground?: string; fontStyle?: string }[]
  colors: Record<string, string>
}

/**
 * TextMate scope (a prefix of it) → the tokens of Monaco's tokenizers that mean the same. Monaco's grammars are coarser than
 * TextMate's: a function name is an `identifier` like any other, so there is no colour for functions, only for what it can tell apart.
 */
/** the third value ranks scopes that colour the same Monaco token: the higher one wins whatever the order of the theme */
const SCOPES: [string, string[], number?][] = [
  ['comment', ['comment']],
  ['string', ['string']],
  ['string.regexp', ['regexp']],
  ['constant', ['constant', 'number']],
  ['constant.numeric', ['number', 'number.float', 'number.hex']],
  ['constant.language', ['constant', 'keyword.constant']],
  ['variable', ['variable', 'identifier']],
  ['variable.other.property', ['variable.property', 'string.key.json', 'key']],
  ['support.type.property-name', ['string.key.json', 'key']],
  ['keyword', ['keyword']],
  ['keyword.operator', ['operator', 'delimiter']],
  ['storage', ['keyword']],
  // Monaco calls `const`, `export`, `class`, `public`, `new`, `async`… and `if`, `return` all `keyword`; most of them are storage in VS Code (orange)
  ['storage.type', ['keyword'], 3],
  ['storage.modifier', ['keyword'], 3],
  ['entity.name.type', ['type', 'type.identifier']],
  ['entity.name.class', ['type', 'type.identifier']],
  ['support.class', ['type', 'type.identifier']],
  ['support.type', ['type', 'type.identifier']],
  ['entity.name.function', ['predefined']],
  ['support.function', ['predefined']],
  ['entity.name.tag', ['tag', 'metatag']],
  ['entity.other.attribute-name', ['attribute.name', 'attribute.value']],
  ['punctuation', ['delimiter', 'delimiter.bracket']],
  ['markup.heading', ['keyword.md', 'string.md']]
]

/** kinds of name that a theme styles on their own (a decorator is bold, a constant in capitals too), not as every word of the table's kind */
const NARROW = new Set(['decorator', 'annotation', 'caps', 'target', 'link', 'url', 'uri', 'markdown', 'tag'])
/** a scope is one of the table's, or goes one step further (`storage.type.annotation` is a step too far, `entity.name.type.class` is not) */
const fits = (scope: string, key: string): boolean => {
  const extra = scope.slice(key.length + 1).split('.')
  return scope === key || (extra.length <= 1 && !NARROW.has(extra[0]))
}

const hex = (c: string): string => c.replace('#', '')
/** Monaco takes #rrggbb and #rrggbbaa; a rule colour has no alpha */
const rule_ = (c: string): string => hex(c.length === 9 ? c.slice(0, 7) : c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c)

/** The part of the colours of a theme that the editor uses: the editor itself, its widgets, its gutter and scrollbars. */
const EDITOR_COLORS = /^(editor|editorCursor|editorLineNumber|editorIndentGuide|editorWidget|editorSuggestWidget|editorHoverWidget|editorBracket\w*|editorGutter|editorWhitespace|editorOverviewRuler|editorError|editorWarning|editorInfo|editorRuler|editorCodeLens|editorLink|input|scrollbar\w*|scrollbarSlider|minimap\w*|list|focusBorder|widget|peekView\w*|foreground)\b/

/** Turn a VS Code theme into a Monaco theme: its editor colours as they are, its token colours by the scope table above. */
export function toMonacoTheme(vs: VsCodeTheme): MonacoTheme {
  const best = new Map<string, { rank: number; rule: MonacoTheme['rules'][number] }>()
  let foreground: string | undefined
  let punctuation: string | undefined
  for (const t of vs.tokenColors ?? []) {
    const s = t.settings ?? {}
    const scopes = (Array.isArray(t.scope) ? t.scope : typeof t.scope === 'string' ? t.scope.split(',') : []).map((x) => x.trim())
    if (scopes.length === 0 && s.foreground) foreground = s.foreground
    for (const scope of scopes) {
      if (scope === 'punctuation' && s.foreground) punctuation = s.foreground
      // only the general scopes: `string.other.link.title.markdown` or `text.html entity.name.tag` colour a part of one language, and
      // would colour every string or tag of the editor
      if (/\s/.test(scope)) continue
      // the most specific entry of the table for the scope
      let entry: (typeof SCOPES)[number] | undefined
      for (const e of SCOPES) if ((scope === e[0] || scope.startsWith(e[0] + '.')) && fits(scope, e[0]) && (!entry || e[0].length > entry[0].length)) entry = e
      if (!entry) continue
      const rule = { ...(s.foreground ? { foreground: rule_(s.foreground) } : {}), ...(s.fontStyle !== undefined ? { fontStyle: s.fontStyle.trim() } : {}) }
      for (const token of entry[1]) {
        const rank = entry[2] ?? 0
        const was = best.get(token)
        if (!was || rank >= was.rank) best.set(token, { rank, rule: { token, ...rule } })
      }
    }
  }
  const rules: MonacoTheme['rules'] = [...best.values()].map((b) => b.rule)
  // decorators are `annotation` in Monaco; VS Code colours them like the rest of what is not a word of the language
  if (punctuation) rules.push({ token: 'annotation', foreground: rule_(punctuation) })
  const colors: Record<string, string> = {}
  for (const [k, v] of Object.entries(vs.colors ?? {})) if (EDITOR_COLORS.test(k) && typeof v === 'string') colors[k] = v
  const fg = colors['editor.foreground'] ?? foreground
  if (fg) colors['editor.foreground'] = fg.length === 9 ? fg.slice(0, 7) : fg
  if (foreground) rules.unshift({ token: '', foreground: rule_(foreground) })
  return { base: vs.type === 'light' ? 'vs' : vs.type === 'hc' ? 'hc-black' : 'vs-dark', inherit: true, rules, colors }
}

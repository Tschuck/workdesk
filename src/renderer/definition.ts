/** Words that introduce a name in the languages we read: TypeScript / JavaScript, Python, Go, Rust, Java, C#, Kotlin, Swift. */
const DECLARATIONS = ['class', 'interface', 'type', 'enum', 'function', 'const', 'let', 'var', 'namespace', 'module', 'def', 'func', 'fn', 'struct', 'trait', 'record', 'object', 'protocol', 'fun', 'proc']

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const declaration = (term: string): string => `(^|[^A-Za-z0-9_$])(${DECLARATIONS.join('|')}) +${escape(term.trim())}($|[^A-Za-z0-9_$])`
/** words that come before a method or property name: `public abc(`, `private async abc(`, `static get abc(`, `public void abc(` (a return type may follow) */
const MODIFIERS = 'public|private|protected|internal|static|async|abstract|override|readonly|get|set|final|synchronized|virtual|open|suspend|pub|export|default|extern|inline|unsafe|native'
/** `public abc(`, `private async abc<T>(`, `public static Map<K,V> abc(`, `protected abc = () =>`: modifiers, maybe a return type, the name, then `(`, `<`, `=`, `:` or `;` */
const member = (term: string): string => `(^|[^A-Za-z0-9_$])(${MODIFIERS}) +((${MODIFIERS}) +)*([A-Za-z0-9_$<>,.?*&:]+ +)*${escape(term.trim())} *[(<=:;]`
/** a method of a class, written with no modifier: `abc(a, b) {`, `async abc(): Promise<void> {` at the start of a line that ends in `{` */
const bareMethod = (term: string): string => `^ *(async +)?${escape(term.trim())} *(<[^(]*>)? *\\(.*\\) *(:[^=]*)?\\{ *$`
/** a method with a receiver: Go `func (s *Server) abc(`, Ruby `def self.abc` */
const receiver = (term: string): string => `(func *\\([^)]*\\) *${escape(term.trim())} *[(\\[])|(def +[A-Za-z_]+\\.${escape(term.trim())}($|[^A-Za-z0-9_$]))`
/** a value set at the start of a line: `CLOUDFLARE_ACCOUNT_ID=abc` of an env file, `export FOO="x"`, `foo = 1` */
const assignment = (term: string): string => `^ *(export +)?${escape(term.trim())} *=([^=]|$)`

/**
 * Where `term` is defined: a declaration word, spaces, the name (`class Foo`, `export const Foo = {`, `interface Foo<T> {`, `def foo(`), a method
 * (`public foo(`, `private async foo(`, `foo() {`, Go `func (s *S) foo(`),
 * or a value set at the start of a line (`FOO=bar` of an env file; ranked after the declarations, see `definitionRank`).
 * Only what both `grep -E` and JavaScript read the same way (no `\b`, `\s`), so it serves git grep and the search of non-git folders.
 */
export function definitionPattern(term: string): string {
  return `${declaration(term)}|${receiver(term)}|${member(term)}|${bareMethod(term)}|${assignment(term)}`
}

/** 0 for a declaration (`class Foo`, `function foo`, a method with a receiver), 1 for a method or property of a class (`public foo(`, `foo() {`), 2 for a value set (`FOO=bar`): lower comes first. */
export function definitionRank(term: string, line: string): 0 | 1 | 2 {
  if (new RegExp(`${declaration(term)}|${receiver(term)}`).test(line)) return 0
  return new RegExp(`${member(term)}|${bareMethod(term)}`).test(line) ? 1 : 2
}

/** The name on the clipboard, if it is one: a bare identifier (a copied `FooService` or `fooBar()` → `fooBar`); anything else is not a name to look up. */
export function clipboardTerm(text: string): string {
  const m = /^\s*([A-Za-z_$][\w$]*)\s*(?:\(\))?[;,]?\s*$/.exec(text)
  return m?.[1] ?? ''
}

/** the tokenizers of Monaco for single languages: loaded for files that are too large for the TextMate grammars */
declare module 'monaco-editor/languages/definitions/*' {
  export const language: import('monaco-editor').languages.IMonarchLanguage
  export const conf: import('monaco-editor').languages.LanguageConfiguration
}

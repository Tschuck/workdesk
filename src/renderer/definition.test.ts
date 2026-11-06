import { describe, expect, it } from 'vitest'
import { clipboardTerm, definitionPattern, definitionRank } from './definition'

const finds = (term: string, line: string): boolean => new RegExp(definitionPattern(term)).test(line)

describe('Go to definition', () => {
  it('finds the declaration of a name', () => {
    expect(finds('Foo', 'export class Foo {')).toBe(true)
    expect(finds('Foo', 'export abstract class Foo<T> extends Bar {')).toBe(true)
    expect(finds('Foo', 'interface Foo {')).toBe(true)
    expect(finds('Foo', 'export type Foo = {')).toBe(true)
    expect(finds('foo', 'export const foo = {')).toBe(true)
    expect(finds('foo', 'export async function foo(a: number) {')).toBe(true)
    expect(finds('foo', 'def foo(self):')).toBe(true)
    expect(finds('foo', 'func foo() error {')).toBe(true)
    expect(finds('Foo', 'class Foo:')).toBe(true)
  })
  it('does not find a longer name, a use, or another name', () => {
    expect(finds('Foo', 'class FooBar {')).toBe(false)
    expect(finds('Foo', 'class MyFoo {')).toBe(false)
    expect(finds('Foo', 'const x = new Foo()')).toBe(false)
    expect(finds('Foo', "import { Foo } from './foo'")).toBe(false)
  })
  it('takes a name with $ or dots literally', () => {
    expect(finds('$store', 'const $store = writable()')).toBe(true)
    expect(finds('a.b', 'const axb = 1')).toBe(false)
  })
})

describe('methods', () => {
  it('finds a method with modifiers, a return type or none', () => {
    expect(finds('abc', '  public abc(a: string) {')).toBe(true)
    expect(finds('abc', '  private async abc<T>(a: T): Promise<void> {')).toBe(true)
    expect(finds('abc', '  public static abc() {')).toBe(true)
    expect(finds('abc', '  public void abc(String a) {')).toBe(true)
    expect(finds('abc', '  public static Map<String,Integer> abc() {')).toBe(true)
    expect(finds('abc', '  protected abc = () => {')).toBe(true)
    expect(finds('abc', '  get abc() {')).toBe(true)
    expect(finds('abc', '  abc(a, b) {')).toBe(true)
    expect(finds('abc', '  async abc(): Promise<void> {')).toBe(true)
    expect(finds('abc', 'func (s *Server) abc(ctx context.Context) error {')).toBe(true)
    expect(finds('abc', '  def self.abc')).toBe(true)
    expect(finds('abc', 'export default function abc() {')).toBe(true)
    expect(finds('abc', 'fun abc(x: Int) {')).toBe(true)
  })
  it('does not take a call or a longer name', () => {
    expect(finds('abc', '  this.abc(1)')).toBe(false)
    expect(finds('abc', '  return abc(1)')).toBe(false)
    expect(finds('abc', '  abc(1);')).toBe(false)
    expect(finds('abc', '  public abcd(a) {')).toBe(false)
    expect(finds('abc', '  public xabc(a) {')).toBe(false)
  })
  it('ranks declarations before methods before values', () => {
    expect(definitionRank('abc', 'function abc() {')).toBe(0)
    expect(definitionRank('abc', 'func (s *S) abc() {')).toBe(0)
    expect(definitionRank('abc', '  public abc() {')).toBe(1)
    expect(definitionRank('abc', '  abc() {')).toBe(1)
    expect(definitionRank('abc', 'abc=1')).toBe(2)
  })
})

describe('values', () => {
  it('finds a value set at the start of a line, after the declarations', () => {
    expect(finds('CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID=asdf')).toBe(true)
    expect(finds('CLOUDFLARE_ACCOUNT_ID', 'export CLOUDFLARE_ACCOUNT_ID="asdf"')).toBe(true)
    expect(finds('FOO', '  FOO = 1')).toBe(true)
    expect(finds('FOO', 'MY_FOO=1')).toBe(false)
    expect(finds('FOO', 'FOO==1')).toBe(false)
    expect(definitionRank('FOO', 'const FOO = 1')).toBe(0)
    expect(definitionRank('FOO', 'FOO=1')).toBe(2)
  })
})

describe('the name from the clipboard', () => {
  it('is a bare identifier', () => {
    expect(clipboardTerm('FooService')).toBe('FooService')
    expect(clipboardTerm('  fooBar()\n')).toBe('fooBar')
    expect(clipboardTerm('$store')).toBe('$store')
  })
  it('is nothing for text, paths or code', () => {
    expect(clipboardTerm('src/foo.ts')).toBe('')
    expect(clipboardTerm('const a = 1')).toBe('')
    expect(clipboardTerm('')).toBe('')
  })
})

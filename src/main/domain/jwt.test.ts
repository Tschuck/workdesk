import { describe, expect, it } from 'vitest'
import { cleanToken, decodeJwt, jwtFileText } from './jwt'

const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')
const jwt = (payload: unknown, header: unknown = { alg: 'ES256', typ: 'JWT' }, sig = 'c2ln') => `${b64(header)}.${b64(payload)}.${sig}`

describe('decoding a JWT', () => {
  it('reads header and payload and says what the times mean', () => {
    const now = 1_700_000_000
    const d = decodeJwt(jwt({ sub: 'did:example:1', iat: now - 3600, exp: now + 86_400 * 3, ñ: 'ü' }), now)
    expect(d.header).toEqual({ alg: 'ES256', typ: 'JWT' })
    expect(d.payload).toMatchObject({ sub: 'did:example:1', ñ: 'ü' })
    expect(d.signature).toBe('c2ln')
    expect(d.times.iat).toContain('60 min ago')
    expect(d.times.exp).toContain('in 3 days')
    expect(d.times.exp).toMatch(/^2023-11-\d\d \d\d:\d\d:\d\d UTC/)
  })
  it('takes what people paste: Bearer, quotes, line breaks', () => {
    const t = jwt({ a: 1 })
    expect(cleanToken(`Bearer ${t}`)).toBe(t)
    expect(cleanToken(`"${t}",`)).toBe(t)
    expect(cleanToken(`${t.slice(0, 10)}\n  ${t.slice(10)}`)).toBe(t)
    expect(decodeJwt(`Bearer ${t}`).payload).toEqual({ a: 1 })
  })
  it('reads the disclosures of an SD-JWT, and keeps a payload that is not JSON as text', () => {
    const sd = `${jwt({ _sd: ['x'] })}~${b64(['salt', 'given_name', 'Erika'])}~${b64(['salt2', 'https://x'])}~`
    expect(decodeJwt(sd).disclosures).toEqual([['salt', 'given_name', 'Erika'], ['salt2', 'https://x']])
    expect(decodeJwt(jwt('just text')).payload).toBe('just text')
  })
  it('says why it cannot', () => {
    expect(() => decodeJwt('')).toThrow(/Paste/)
    expect(() => decodeJwt('a.b')).toThrow(/three parts/)
    expect(() => decodeJwt('a.b.c.d.e')).toThrow(/encrypted/)
    expect(() => decodeJwt('%%%.b.c')).toThrow(/not base64url/)
  })
  it('writes the parts in order for the file', () => {
    const text = jwtFileText(decodeJwt(jwt({ a: 1 })))
    expect(Object.keys(JSON.parse(text))).toEqual(['header', 'payload', 'signature'])
    expect(text.endsWith('\n')).toBe(true)
  })
})

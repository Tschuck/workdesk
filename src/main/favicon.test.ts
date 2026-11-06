import { describe, expect, it } from 'vitest'
import { cacheFavicon } from './favicon'

const reply = (body: string, type: string, ok = true) => (async () => new Response(body, { status: ok ? 200 : 404, headers: { 'content-type': type } })) as unknown as typeof fetch

describe('cacheFavicon', () => {
  it('keeps an image as a data address', async () => {
    expect(await cacheFavicon('https://a.test/i.png', reply('PNG', 'image/png'))).toBe('data:image/png;base64,UE5H')
  })
  it('takes an ico served as octet-stream', async () => {
    expect(await cacheFavicon('https://a.test/favicon.ico', reply('x', 'application/octet-stream'))).toMatch(/^data:image\/x-icon;base64,/)
  })
  it('leaves out pages, errors, big files and other schemes', async () => {
    expect(await cacheFavicon('https://a.test/', reply('<html>', 'text/html'))).toBeUndefined()
    expect(await cacheFavicon('https://a.test/i.png', reply('x', 'image/png', false))).toBeUndefined()
    expect(await cacheFavicon('https://a.test/i.png', reply('x'.repeat(60_000), 'image/png'))).toBeUndefined()
    expect(await cacheFavicon('file:///etc/passwd')).toBeUndefined()
  })
  it('passes a small data address through', async () => {
    expect(await cacheFavicon('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
  })
})

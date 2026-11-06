import { describe, expect, it } from 'vitest'
import { askableOrigin, mayAsk, PagePermissions, wanted, type Grant, type GrantStore, type PagePermission } from './page-permissions'

class MemoryStore implements GrantStore {
  saved: Grant[] = []
  async load() { return this.saved }
  async save(g: Grant[]) { this.saved = [...g] }
}

describe('what a page asks for', () => {
  it('maps Electron permissions to camera, microphone and screen', () => {
    expect(wanted('media', ['video', 'audio'])).toEqual(['camera', 'microphone'])
    expect(wanted('media', ['audio'])).toEqual(['microphone'])
    expect(wanted('media')).toEqual(['camera', 'microphone'])
    expect(wanted('display-capture')).toEqual(['screen'])
    expect(wanted('geolocation')).toEqual([])
  })

  it('only asks about secure pages and local development', () => {
    expect(askableOrigin('https://meet.example.com/room/1')).toBe('https://meet.example.com')
    expect(askableOrigin('http://localhost:3000/x')).toBe('http://localhost:3000')
    for (const bad of ['http://example.com', 'file:///x', 'about:blank', 'nope', '']) expect(askableOrigin(bad)).toBeUndefined()
  })
})

describe('PagePermissions', () => {
  const make = (answers: boolean[]) => {
    const store = new MemoryStore()
    const asked: [string, PagePermission[]][] = []
    const p = new PagePermissions(store, async (o, w) => (asked.push([o, w]), answers.shift() ?? false))
    return { p, store, asked }
  }

  it('asks once, remembers an allow and does not ask again', async () => {
    const { p, store, asked } = make([true])
    expect(await p.request('https://meet.example.com/a', ['camera', 'microphone'])).toBe(true)
    expect(await p.request('https://meet.example.com/b', ['camera'])).toBe(true)
    expect(asked).toHaveLength(1)
    expect(store.saved.map((g) => g.permission)).toEqual(['camera', 'microphone'])
    expect(p.isAllowed('https://meet.example.com/x', ['camera'])).toBe(true)
    expect(p.isAllowed('https://other.example.com', ['camera'])).toBe(false)
  })

  it('asks again after a refusal, which is not kept', async () => {
    const { p, store, asked } = make([false, true])
    expect(await p.request('https://a.dev', ['screen'])).toBe(false)
    expect(store.saved).toEqual([])
    expect(await p.request('https://a.dev', ['screen'])).toBe(true)
    expect(asked).toHaveLength(2)
  })

  it('asks one question for requests that come at once, and none for unsafe pages', async () => {
    const { p, asked } = make([true])
    const [a, b] = await Promise.all([p.request('https://a.dev', ['camera']), p.request('https://a.dev', ['camera'])])
    expect([a, b]).toEqual([true, true])
    expect(asked).toHaveLength(1)
    expect(await p.request('http://a.dev', ['camera'])).toBe(false)
    expect(asked).toHaveLength(1)
  })

  it('can take an allow back', async () => {
    const { p, store } = make([true])
    await p.request('https://a.dev', ['camera', 'microphone'])
    expect((await p.revoke('https://a.dev', 'camera')).map((g) => g.permission)).toEqual(['microphone'])
    expect(store.saved).toHaveLength(1)
    expect(p.isAllowed('https://a.dev', ['camera'])).toBe(false)
  })
})

describe('the state a page sees before it asks', () => {
  it('says "you may ask" for the camera and microphone of secure pages only, so a page like Meet asks instead of showing "blocked"', () => {
    expect(mayAsk('media', 'https://meet.google.com')).toBe(true)
    expect(mayAsk('media', 'http://localhost:3000')).toBe(true)
    expect(mayAsk('media', 'http://example.com')).toBe(false)
    expect(mayAsk('geolocation', 'https://meet.google.com')).toBe(false)
    expect(mayAsk('notifications', 'https://meet.google.com')).toBe(false)
  })

  it('allows from the site settings without asking, once, and revoking asks again', async () => {
    const store = new MemoryStore()
    let asked = 0
    const p = new PagePermissions(store, async () => (asked++, false))
    await p.load()
    await p.allow('https://meet.google.com/abc-def', 'microphone')
    await p.allow('https://meet.google.com', 'microphone')
    await p.allow('http://example.com', 'camera')
    expect(p.list()).toEqual([{ origin: 'https://meet.google.com', permission: 'microphone' }])
    expect(await p.request('https://meet.google.com/x', ['microphone'])).toBe(true)
    expect(asked).toBe(0)
    await p.revoke('https://meet.google.com', 'microphone')
    expect(await p.request('https://meet.google.com/x', ['microphone'])).toBe(false)
    expect(asked).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import { RemoteCache } from './remote-cache'

describe('the remote cache', () => {
  const make = () => {
    let now = 0
    const changed: string[] = []
    const cache = new RemoteCache({ ttlMs: 1000, now: () => now, onChange: (k) => void changed.push(k) })
    return { cache, changed, tick: (ms: number) => (now += ms) }
  }

  it('answers from memory while fresh and reads again after the lifetime', async () => {
    const { cache, tick } = make()
    let calls = 0
    const load = async () => ++calls
    expect(await cache.get('a', load)).toBe(1)
    tick(999)
    expect(await cache.get('a', load)).toBe(1)
    tick(2)
    expect(await cache.get('a', load)).toBe(2)
  })

  it('lets callers that ask at the same time share one request', async () => {
    const { cache } = make()
    let calls = 0
    const slow = () => new Promise<number>((r) => setTimeout(() => r(++calls), 10))
    expect(await Promise.all([cache.get('a', slow), cache.get('a', slow), cache.get('a', slow)])).toEqual([1, 1, 1])
    expect(calls).toBe(1)
  })

  it('reads again on a refresh, and tells the views only when an older answer was replaced', async () => {
    const { cache, changed } = make()
    let n = 0
    await cache.get('a', async () => ++n)
    expect(changed).toEqual([])
    expect(await cache.get('a', async () => ++n, { refresh: true })).toBe(2)
    expect(changed).toEqual(['a'])
  })

  it('never keeps a failure, and does not hand out the older answer instead', async () => {
    const { cache, tick } = make()
    await cache.get('a', async () => 'old')
    tick(5000)
    await expect(cache.get('a', async () => Promise.reject(new Error('GitHub 502')))).rejects.toThrow('GitHub 502')
    expect(await cache.get('a', async () => 'new')).toBe('new')
    await expect(cache.get('b', async () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    expect(cache.fetchedAt('b')).toBeUndefined()
  })

  it('forgets by prefix and knows how old the oldest answer is', async () => {
    const { cache, changed, tick } = make()
    await cache.get('github:a', async () => 1)
    tick(300)
    await cache.get('github:b', async () => 2)
    await cache.get('notion:a', async () => 3)
    expect(cache.oldest('github:')).toBe(0)
    expect(cache.oldest('none:')).toBeUndefined()
    cache.invalidate('github:')
    expect(changed.sort()).toEqual(['github:a', 'github:b'])
    expect(cache.fetchedAt('github:a')).toBeUndefined()
    expect(cache.fetchedAt('notion:a')).toBe(300)
  })
})

import { describe, expect, it } from 'vitest'
import { jobs } from './jobs'

describe('jobs', () => {
  it('lists a job while it runs, tells every change, and drops it when it fails', async () => {
    const seen: string[][] = []
    jobs.onChange((l) => seen.push(l.map((j) => j.label)))
    let release!: () => void
    const run = jobs.track('a', () => new Promise<void>((r) => (release = r)))
    expect(jobs.snapshot().map((j) => j.label)).toEqual(['a'])
    release()
    await run
    await expect(jobs.track('b', () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    expect(jobs.snapshot()).toEqual([])
    expect(seen).toEqual([['a'], [], ['b'], []])
  })
})

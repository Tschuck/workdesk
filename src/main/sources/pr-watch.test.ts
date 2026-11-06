import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PrTodoState } from '../domain/prs'
import { WorkDeskService } from '../service'
import { FakeGit } from '../status/fake-git'
import { GithubApi } from './github/api'
import { PrWatch, watchedPrs, type PrTodoStates, type WatchedPr } from './pr-watch'

describe('watching the Pull Requests of WorkDesks', () => {
  let tmp: string
  let service: WorkDeskService
  let calls: string[]
  let ci: 'pending' | 'success'
  let prState: { state: string; merged: boolean }
  let connected: boolean
  let failing: boolean
  let ready: [string, string][]
  let changes: PrTodoStates[]
  let watch: PrWatch

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'workdesk-watch-'))
    service = new WorkDeskService(join(tmp, 'root'), new FakeGit())
    await service.load()
    calls = []
    ci = 'pending'
    prState = { state: 'open', merged: false }
    connected = true
    failing = false
    ready = []
    changes = []
    const api = new GithubApi(async () => ({}), async () => {
      calls.push('graphql')
      if (failing) throw new Error('GitHub 502')
      return {
        a0: {
          pullRequest: {
            number: 7, title: 'Fix', url: 'u', isDraft: false, state: prState.state === 'closed' ? 'CLOSED' : 'OPEN', merged: prState.merged,
            headRefName: 'h', baseRefName: 'main', mergeStateStatus: 'CLEAN', repository: { nameWithOwner: 'o/r' },
            commits: { nodes: [{ commit: { statusCheckRollup: { state: ci === 'pending' ? 'PENDING' : 'SUCCESS' } } }] },
            latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { login: 'me' } }] }, reviews: { nodes: [] }
          }
        }
      }
    })
    watch = new PrWatch({
      service,
      batch: async () => {
        if (!connected) throw new Error('not connected')
        return api.prBatch(watchedPrs(service.getState().desks).map((p) => p.id), 'me', 42)
      },
      onReady: (t: WatchedPr, s: PrTodoState) => void ready.push([t.title, s.title]),
      onChange: (s) => void changes.push(s),
      now: () => 42
    })
    await service.registerItemsDesk(
      { id: 'd1', name: 'Review me', stage: 'implement', stageOverridden: false, presence: 'active', todoIds: [], items: [{ kind: 'pr', id: 'o/r#7', title: 'Review me' }], branches: [], signals: [], createdAt: 0 },
      []
    )
  })
  afterEach(async () => {
    service.status.autoCommit.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  it('shows approved-and-running first, then announces the moment it is ready to merge, once', async () => {
    const first = await watch.refresh()
    expect(first['o/r#7']).toMatchObject({ state: 'open', ci: 'pending', myReview: 'APPROVED', fetchedAt: 42 })
    // looking for the first time announces nothing
    expect(ready).toEqual([])

    await watch.refresh()
    expect(ready).toEqual([])

    ci = 'success'
    const done = await watch.refresh()
    expect(done['o/r#7'].ci).toBe('success')
    expect(ready).toEqual([['Review me', 'Fix']])
    await watch.refresh()
    expect(ready).toHaveLength(1)
    expect(changes.length).toBeGreaterThan(0)
  })

  it('keeps asking about the Pull Requests of a parked WorkDesk: parking keeps its tabs, not its silence', async () => {
    await service.parkDesk('d1')
    await watch.refresh()
    expect(calls).toEqual(['graphql'])
  })

  it('does not announce a Pull Request that was ready the first time it was seen', async () => {
    ci = 'success'
    await watch.refresh()
    await watch.refresh()
    expect(ready).toEqual([])
  })

  it('stops asking about merged Pull Requests', async () => {
    await watch.refresh()
    prState = { state: 'closed', merged: true }
    expect((await watch.refresh())['o/r#7'].state).toBe('merged')
    const n = calls.length
    await watch.refresh()
    expect(calls.length).toBe(n)
  })

  it('keeps the last state when GitHub fails or is not connected, and asks nothing when no WorkDesk has a Pull Request', async () => {
    await watch.refresh()
    failing = true
    expect((await watch.refresh())['o/r#7'].ci).toBe('pending')
    failing = false
    connected = false
    expect((await watch.refresh())['o/r#7'].ci).toBe('pending')

    const other = new WorkDeskService(join(tmp, 'other'), new FakeGit())
    await other.load()
    let asked = 0
    const idle = new PrWatch({ service: other, batch: async () => (asked++, new Map()), onReady: () => undefined })
    await idle.refresh()
    expect(asked).toBe(0)
    other.status.autoCommit.dispose()
  })
})

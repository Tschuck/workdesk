import { lstatSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnvStore } from '../env/env-store'
import { ProjectsService } from './projects-service'

describe('.env files of a whole WorkDesk', () => {
  let tmp: string
  let svc: ProjectsService
  const wt = (name: string, project = 'backend') => ({ project, branch: name, path: join(tmp, name), index: 1 })
  const put = async (path: string, text: string) => (await mkdir(join(path, '..'), { recursive: true }), writeFile(path, text))
  const excluded: string[] = []

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'workdesk-envdesk-'))
    const desk = { id: 'd', branches: [wt('a'), wt('b')] }
    svc = new ProjectsService({} as never, { getState: () => ({ desks: [desk], todos: [] }) } as never, join(tmp, 'root'), { excludeLocally: async (_p: string, f: string[]) => void excluded.push(...f) } as never)
  })
  afterEach(() => rm(tmp, { recursive: true, force: true }))

  it('stores the real .env files of the first Branch that has them, for every app of the repository', async () => {
    await put(join(tmp, 'a', 'apps/api/.env'), 'API=1')
    await put(join(tmp, 'a', 'apps/web/.env'), 'WEB=1')
    await put(join(tmp, 'b', 'apps/api/.env'), 'API=other')
    expect((await svc.syncDeskEnv('d')).synced).toEqual(['backend/apps/api/.env', 'backend/apps/web/.env'])
    // Branch b did not overwrite what a stored
    expect(await readFile(join(tmp, 'root', '.env', 'backend', 'apps/api/.env'), 'utf8')).toBe('API=1')
    // nothing real left to store the second time round
    await svc.linkDeskEnv('d', true)
    expect((await svc.syncDeskEnv('d')).synced).toEqual([])
  })

  it('links the stored files into every Branch, keeps differing ones unless forced, and stops git seeing them', async () => {
    await new EnvStore(join(tmp, 'root')).sync('backend', await (async () => (await put(join(tmp, 'src', 'apps/api/.env'), 'API=1'), join(tmp, 'src')))())
    await put(join(tmp, 'b', 'apps/api/.env'), 'LOCAL=differs')
    const first = await svc.linkDeskEnv('d')
    expect(first.linked).toEqual(['a/apps/api/.env'])
    expect(first.conflicts).toEqual(['b/apps/api/.env'])
    expect(lstatSync(join(tmp, 'a', 'apps/api/.env')).isSymbolicLink()).toBe(true)
    expect(lstatSync(join(tmp, 'b', 'apps/api/.env')).isSymbolicLink()).toBe(false)
    expect((await svc.linkDeskEnv('d', true)).conflicts).toEqual([])
    expect(lstatSync(join(tmp, 'b', 'apps/api/.env')).isSymbolicLink()).toBe(true)
    expect(excluded).toContain('apps/api/.env')
    await expect(svc.linkDeskEnv('nope')).rejects.toThrow(/Unknown WorkDesk/)
  })
})

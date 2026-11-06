import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Candidate } from './source'
import { DEFAULT_PROFILE_ID } from '../domain/profiles'

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw err
  }
}

/** `sources/<source>/{config,tracked,skipped}.json` inside the Status Repo. Never holds secrets. */
export class SourceStore {
  constructor(
    private readonly statusDir: string,
    private readonly onWrite: () => void = () => undefined,
    /** the Profile whose settings, tracked and skipped lists are read and written; Profile #1 keeps the original files */
    private readonly profile: () => string = () => DEFAULT_PROFILE_ID
  ) {}

  private path(sourceId: string, name: string): string {
    const p = this.profile()
    return p === DEFAULT_PROFILE_ID ? join(this.statusDir, 'sources', sourceId, `${name}.json`) : join(this.statusDir, 'sources', sourceId, `profile-${p}`, `${name}.json`)
  }

  private async write(path: string, data: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(data, null, 2) + '\n')
    this.onWrite()
  }

  config<T extends object>(sourceId: string, fallback: T): Promise<T> {
    return readJson(this.path(sourceId, 'config'), fallback)
  }

  setConfig(sourceId: string, config: object): Promise<void> {
    return this.write(this.path(sourceId, 'config'), config)
  }

  tracked(sourceId: string): Promise<string[]> {
    return readJson(this.path(sourceId, 'tracked'), [])
  }

  skipped(sourceId: string): Promise<string[]> {
    return readJson(this.path(sourceId, 'skipped'), [])
  }

  async markTracked(sourceId: string, id: string): Promise<void> {
    const all = await this.tracked(sourceId)
    if (!all.includes(id)) await this.write(this.path(sourceId, 'tracked'), [...all, id])
  }

  async markSkipped(sourceId: string, id: string): Promise<void> {
    const all = await this.skipped(sourceId)
    if (!all.includes(id)) await this.write(this.path(sourceId, 'skipped'), [...all, id])
  }

  async unmarkSkipped(sourceId: string, id: string): Promise<void> {
    const all = await this.skipped(sourceId)
    if (all.includes(id)) await this.write(this.path(sourceId, 'skipped'), all.filter((x) => x !== id))
  }

  /** Candidates that were not skipped. Pull requests and tickets are no longer tracked as Todos; a WorkDesk that has one hides it. */
  async notSkipped(sourceId: string, candidates: readonly Candidate[]): Promise<Candidate[]> {
    const skipped = await this.skipped(sourceId)
    return candidates.filter((c) => !skipped.includes(c.id))
  }

  /** Candidates that are neither tracked nor skipped. */
  async open(sourceId: string, candidates: readonly Candidate[]): Promise<Candidate[]> {
    const [tracked, skipped] = await Promise.all([this.tracked(sourceId), this.skipped(sourceId)])
    return candidates.filter((c) => !tracked.includes(c.id) && !skipped.includes(c.id))
  }
}

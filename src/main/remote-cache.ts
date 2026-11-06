/** How long a remote answer is good for: lists and details are read again after this, or when the user asks. */
export const REMOTE_TTL_MS = 5 * 60_000

interface Entry {
  value: unknown
  at: number
}

/**
 * The one place remote data (GitHub, Notion) is kept. Entries are found by key and good for a while; callers that ask
 * for the same key at the same time share one request; a refresh skips the cache. A failed request is never kept, and an
 * older answer is not handed out in its place: the caller sees the error.
 */
export class RemoteCache {
  private readonly entries = new Map<string, Entry>()
  private readonly inFlight = new Map<string, Promise<unknown>>()

  constructor(
    private readonly opts: {
      ttlMs?: number
      now?: () => number
      /** an entry that already existed was replaced or dropped: views that show it should read it again */
      onChange?: (key: string) => void
    } = {}
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)()
  }

  /** The answer for `key`: the kept one while it is fresh, else the result of `load`. */
  async get<T>(key: string, load: () => Promise<T>, o: { refresh?: boolean } = {}): Promise<T> {
    const hit = this.entries.get(key)
    if (!o.refresh && hit && this.now() - hit.at < (this.opts.ttlMs ?? REMOTE_TTL_MS)) return hit.value as T
    const running = this.inFlight.get(key)
    if (running) return running as Promise<T>
    const request = load()
      .then((value) => {
        this.entries.set(key, { value, at: this.now() })
        if (hit) this.opts.onChange?.(key)
        return value
      })
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, request)
    return request
  }

  /** When the key was last read from the network, or nothing. */
  fetchedAt(key: string): number | undefined {
    return this.entries.get(key)?.at
  }

  /** The oldest read among the keys that start with `prefix`, for "updated 3 min ago". */
  oldest(prefix: string): number | undefined {
    const times = [...this.entries].filter(([k]) => k.startsWith(prefix)).map(([, e]) => e.at)
    return times.length === 0 ? undefined : Math.min(...times)
  }

  /** Forget the keys that start with `prefix`; the next ask reads them again. */
  invalidate(prefix: string): void {
    for (const key of [...this.entries.keys()]) {
      if (!key.startsWith(prefix)) continue
      this.entries.delete(key)
      this.opts.onChange?.(key)
    }
  }
}

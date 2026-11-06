import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { addSeconds, isIdleOnDesk, isWorking, mergeDeskTime, prune, tickSeconds, type TimeLog } from './domain/time-tracking'

/** What the tracker needs to know about the machine and the window; injected so it can be tested. */
export interface PresenceProbe {
  now(): number
  /** seconds since the last keyboard or mouse input of the user */
  idleSeconds(): number
  locked(): boolean
}

/**
 * Passive time tracking per WorkDesk per day. Stored locally (the app's user data folder, `time-tracking.json`),
 * not in the Status Repo: it changes every few seconds and would fill the repository with commits.
 */
export class TimeTracker {
  private log: TimeLog = {}
  private shown: string | undefined
  // the WorkDesk of the VS Code window in front (VS Code is where the user is, so it wins over the one shown in the app)
  private editor: string | undefined
  private last: number | undefined
  private dirty = false
  private timer?: NodeJS.Timeout
  // told once per stretch of idleness, not at every tick
  private idleTold = false

  constructor(
    private readonly file: string,
    private readonly probe: PresenceProbe,
    /** the user stopped touching anything for the idle limit while a WorkDesk was on screen: the counting paused */
    private readonly onIdle?: (deskId: string) => void
  ) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as TimeLog
      if (parsed && typeof parsed === 'object') this.log = parsed
    } catch {
      // first start, or an unreadable file: start empty
    }
  }

  /** the WorkDesk on screen (nothing: another page); told by the window */
  setShown(deskId: string | undefined): void {
    this.tick()
    this.shown = deskId
  }

  /** the WorkDesk whose VS Code window is in front (nothing: VS Code is not in front, or shows no WorkDesk); told by a poll */
  setEditorDesk(deskId: string | undefined): void {
    if (deskId === this.editor) return
    this.tick()
    this.editor = deskId
  }

  /** counts the time since the previous tick for the WorkDesk on screen, if the user is there */
  tick(): void {
    const now = this.probe.now()
    const seconds = tickSeconds(this.last, now)
    this.last = now
    const desk = this.editor ?? this.shown
    const present = { shownDesk: desk, idleSeconds: this.probe.idleSeconds(), locked: this.probe.locked() }
    if (isIdleOnDesk(present)) {
      if (!this.idleTold) {
        this.idleTold = true
        this.onIdle?.(desk!)
      }
    } else if (isWorking(present)) this.idleTold = false
    if (seconds <= 0 || !isWorking(present)) return
    this.log = addSeconds(this.log, desk!, now, seconds)
    this.dirty = true
  }

  /** a WorkDesk went into another: its time is the other's from now on */
  mergeDesk(from: string, to: string): void {
    this.tick()
    this.log = mergeDeskTime(this.log, from, to)
    if (this.shown === from) this.shown = to
    this.dirty = true
  }

  data(): TimeLog {
    return this.log
  }

  start(everyMs = 15_000): void {
    this.last = this.probe.now()
    this.timer = setInterval(() => {
      this.tick()
      if (this.dirty) void this.flush()
    }, everyMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async flush(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    this.log = prune(this.log, this.probe.now())
    try {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(this.file, JSON.stringify(this.log))
    } catch (err) {
      this.dirty = true
      console.error('saving the time log failed', err)
    }
  }
}

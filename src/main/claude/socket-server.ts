import { chmod, mkdir, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { dirname } from 'node:path'
import { parseHookEvent, type HookEvent } from '../domain/claude-events'
import { parseControlRequest, type ControlReply, type ControlRequest } from '../control'

/** Listens on a unix socket for the events sent by `workdesk hook`. */
export class HookServer {
  private server?: Server
  private control?: (req: ControlRequest) => Promise<ControlReply>

  /** commands (`workdesk desk …`) are answered with one line of JSON on the same connection */
  setControl(handler: (req: ControlRequest) => Promise<ControlReply>): void {
    this.control = handler
  }

  constructor(
    private readonly path: string,
    private readonly onEvent: (e: HookEvent) => void
  ) {}

  async start(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await rm(this.path, { force: true })
    this.server = createServer((conn) => {
      let data = ''
      let answering = false
      conn.setEncoding('utf8')
      conn.on('data', (c) => {
        data += c
        if (data.length > 64_000) return void conn.destroy()
        const nl = data.indexOf('\n')
        if (nl < 0 || answering) return
        let req: ControlRequest | undefined
        try {
          req = parseControlRequest(JSON.parse(data.slice(0, nl)))
        } catch {
          req = undefined
        }
        if (!req) return
        answering = true
        const reply = this.control ? this.control(req) : Promise.resolve<ControlReply>({ ok: false, error: 'WorkDesk is not ready' })
        void reply.then((r) => conn.end(JSON.stringify(r) + '\n'), (e) => conn.end(JSON.stringify({ ok: false, error: String(e) }) + '\n'))
      })
      conn.on('error', () => undefined)
      conn.on('end', () => {
        if (answering) return
        for (const line of data.split('\n').filter(Boolean)) {
          try {
            const event = parseHookEvent(JSON.parse(line))
            if (event) this.onEvent(event)
          } catch {
            // garbage on the socket is ignored
          }
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.path, resolve)
    })
    await chmod(this.path, 0o600)
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(this.path, { force: true })
  }
}

import type { Git } from './git'

/** In-memory Git double that records the calls made against it. */
export class FakeGit implements Git {
  calls: string[] = []
  repo = false
  changes = false
  remote = false
  rebase: 'ok' | 'conflict' = 'ok'
  url: string | undefined
  unreachable?: string

  async isRepo() {
    return this.repo
  }
  async init() {
    this.calls.push('init')
    this.repo = true
  }
  async hasChanges() {
    return this.changes
  }
  async commitAll(_dir: string, message: string) {
    this.calls.push(`commit:${message.split(' ')[0]}`)
    this.changes = false
  }
  async hasRemote() {
    return this.remote
  }
  async pullRebase() {
    this.calls.push('pull-rebase')
    return this.rebase
  }
  async push() {
    this.calls.push('push')
  }
  async remoteUrl() {
    return this.url
  }
  async setRemote(_dir: string, url: string | undefined) {
    this.calls.push(`set-remote:${url ?? ''}`)
    this.url = url
    this.remote = !!url
  }
  async clone(url: string, dir: string) {
    this.calls.push(`clone:${url}:${dir}`)
    this.repo = true
  }
  async checkRemote(url: string) {
    this.calls.push(`check-remote:${url}`)
    if (this.unreachable) throw new Error(this.unreachable)
  }
}

import { describe, expect, it } from 'vitest'
import { explain, NO_PROMPT_ENV, realGit } from './git'

describe('git without prompts', () => {
  it('never lets ssh or git ask for a password', () => {
    expect(NO_PROMPT_ENV.GIT_TERMINAL_PROMPT).toBe('0')
    expect(NO_PROMPT_ENV.GIT_SSH_COMMAND).toMatch(/BatchMode=yes/)
  })

  it('says what to do when the remote wanted a password', () => {
    const e = explain({ stderr: 'me@nas: Permission denied (publickey,password).\nfatal: Could not read from remote repository.' })
    expect(e.message).toMatch(/Permission denied/)
    expect(e.message).toMatch(/ssh-copy-id/)
    expect(explain({ stderr: 'fatal: not a git repository' }).message).toBe('not a git repository')
  })

  it('fails fast against an ssh remote that needs a password', async () => {
    // a port nobody listens on: the point is only that the error comes back at once, with git's message
    await expect(realGit.checkRemote('ssh://nobody@127.0.0.1:1/x.git')).rejects.toThrow(/connect|refused|Could not read/i)
  })
})

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { remoteGit } from './repo-git'

// a "git" that refuses the login the first times it is asked, as GitHub does for logins opened all at once
describe('commands that talk to the remote', () => {
  it('are tried again when the login is refused, and fail with what git said when it stays refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'remote-git-'))
    execFileSync('git', ['init', '-q', dir])
    const counter = join(dir, 'count')
    // `git config` is not a remote command, but any git command shows the retry: the alias refuses twice, then works
    execFileSync('git', ['config', 'alias.flaky', `!f() { n=$(cat ${counter} 2>/dev/null || echo 0); echo $((n+1)) > ${counter}; if [ $n -lt 2 ]; then echo 'git@github.com: Permission denied (publickey).' >&2; exit 1; fi; echo fine; }; f`], { cwd: dir })
    expect(await remoteGit(dir, ['flaky'], 3, 1)).toBe('fine')

    writeFileSync(counter, '-100')
    await expect(remoteGit(dir, ['flaky'], 3, 1)).rejects.toMatchObject({ stderr: expect.stringContaining('Permission denied (publickey)') })
    chmodSync(dir, 0o755)
  })

  it('run one at a time', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'remote-git-'))
    execFileSync('git', ['init', '-q', dir])
    const log = join(dir, 'log')
    execFileSync('git', ['config', 'alias.slow', `!f() { echo start >> ${log}; sleep 0.2; echo end >> ${log}; }; f`], { cwd: dir })
    await Promise.all([remoteGit(dir, ['slow'], 1, 1), remoteGit(dir, ['slow'], 1, 1), remoteGit(dir, ['slow'], 1, 1)])
    expect(execFileSync('cat', [log], { encoding: 'utf8' }).trim().split('\n')).toEqual(['start', 'end', 'start', 'end', 'start', 'end'])
  })
})

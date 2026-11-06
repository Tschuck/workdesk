import { describe, expect, it } from 'vitest'
import { listTitle } from './terminal-titles'

describe('a terminal title in a list', () => {
  it('shortens a shell title to the folder, and leaves what a program set', () => {
    expect(listTitle('me@laptop.local:/Users/me/workdesk/backend')).toBe('backend')
    expect(listTitle('me@host:~')).toBe('~')
    expect(listTitle('me@host:~/projects/app/')).toBe('app')
    expect(listTitle('✳ Claude Code')).toBe('✳ Claude Code')
    expect(listTitle('zsh docker')).toBe('zsh docker')
  })
})

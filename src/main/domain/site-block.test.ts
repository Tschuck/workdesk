import { describe, expect, it } from 'vitest'
import { blockedBy, cleanRule, matchRule, PASS_MS, passKey, Passes } from './site-block'

describe('rules', () => {
  it('takes what was typed as a site', () => {
    expect(cleanRule(' https://www.Reddit.com/ ')).toBe('reddit.com')
    expect(cleanRule('old.reddit.com/r/all/?x=1#y')).toBe('old.reddit.com/r/all')
    expect(cleanRule('news.ycombinator.com')).toBe('news.ycombinator.com')
    expect(cleanRule('reddit')).toBeUndefined()
    expect(cleanRule('')).toBeUndefined()
    expect(cleanRule('not a site.com')).toBeUndefined()
  })
  it('covers the site and its subdomains, or only a path of it', () => {
    expect(matchRule('https://www.reddit.com/r/programming/comments/1/x/', ['reddit.com'])).toBe('reddit.com')
    expect(matchRule('https://old.reddit.com/', ['reddit.com'])).toBe('reddit.com')
    expect(matchRule('https://notreddit.com/', ['reddit.com'])).toBeUndefined()
    expect(matchRule('https://reddit.com.evil.org/', ['reddit.com'])).toBeUndefined()
    expect(matchRule('https://reddit.com/r/all/top', ['reddit.com/r/all'])).toBe('reddit.com/r/all')
    expect(matchRule('https://reddit.com/r/allthethings', ['reddit.com/r/all'])).toBeUndefined()
    expect(matchRule('https://reddit.com/r/programming', ['reddit.com/r/all'])).toBeUndefined()
  })
  it('leaves everything that is not a web page alone', () => {
    expect(matchRule('about:blank', ['reddit.com'])).toBeUndefined()
    expect(matchRule('file:///reddit.com', ['reddit.com'])).toBeUndefined()
    expect(matchRule('nonsense', ['reddit.com'])).toBeUndefined()
  })
})

describe('passes', () => {
  it('are for one page and for a while', () => {
    const passes = new Passes()
    const post = 'https://www.reddit.com/r/programming/comments/1/x/?utm=1#c'
    expect(blockedBy(post, ['reddit.com'], passes, 0)).toBe('reddit.com')
    passes.grant(post, 1000)
    expect(passKey(post)).toBe('https://www.reddit.com/r/programming/comments/1/x')
    expect(blockedBy('https://www.reddit.com/r/programming/comments/1/x', ['reddit.com'], passes, 2000)).toBeUndefined()
    expect(blockedBy('https://www.reddit.com/r/programming/comments/2/y', ['reddit.com'], passes, 2000)).toBe('reddit.com')
    expect(blockedBy('https://www.reddit.com/', ['reddit.com'], passes, 2000)).toBe('reddit.com')
    expect(blockedBy(post, ['reddit.com'], passes, 1000 + PASS_MS + 1)).toBe('reddit.com')
  })
})

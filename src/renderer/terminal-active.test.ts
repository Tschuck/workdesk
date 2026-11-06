import { describe, expect, it } from 'vitest'
import { HiddenOutput } from './terminal-active'

describe('output of a hidden terminal', () => {
  it('is kept in order and handed over once', () => {
    const h = new HiddenOutput()
    expect(h.take()).toBeUndefined()
    h.push('ab')
    h.push('cd')
    expect(h.take()).toEqual({ write: 'abcd' })
    expect(h.take()).toBeUndefined()
  })
  it('is given up past the limit: the screen is repainted instead, and the next output is kept again', () => {
    const h = new HiddenOutput(5)
    h.push('abc')
    h.push('def')
    h.push('g')
    expect(h.take()).toEqual({ repaint: true })
    h.push('xy')
    expect(h.take()).toEqual({ write: 'xy' })
  })
})

import { describe, expect, it } from 'vitest'
import { byteSize, imageMime, isSvg } from './image-types'

describe('image files', () => {
  it('are told by their extension, in any case', () => {
    expect(imageMime('/a/logo.png')).toBe('image/png')
    expect(imageMime('/a/Photo.JPG')).toBe('image/jpeg')
    expect(imageMime('/a/icon.ico')).toBe('image/x-icon')
    expect(imageMime('/a/b.svg')).toBe('image/svg+xml')
  })

  it('are not files with another extension, or none', () => {
    expect(imageMime('/a/readme.md')).toBeUndefined()
    expect(imageMime('/a/png')).toBeUndefined()
    expect(imageMime('/a.png/file')).toBeUndefined()
  })

  it('know SVG as the one that is text', () => {
    expect(isSvg('/a/b.svg')).toBe(true)
    expect(isSvg('/a/b.png')).toBe(false)
  })

  it('give their size in B, KB or MB', () => {
    expect(byteSize(512)).toBe('512 B')
    expect(byteSize(12 * 1024 + 100)).toBe('12 KB')
    expect(byteSize(3.44 * 1024 * 1024)).toBe('3.4 MB')
  })
})

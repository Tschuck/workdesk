import { describe, expect, it } from 'vitest'
import { APP_NAME } from './app-info'

describe('app info', () => {
  it('names the app WorkDesk', () => {
    expect(APP_NAME).toBe('WorkDesk')
  })
})

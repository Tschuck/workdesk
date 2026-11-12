import { describe, expect, it } from 'vitest'
import { compactPageCss } from './page-css'

describe('CSS for a page beside its item', () => {
  it('is there for Notion pages, and only for them', () => {
    expect(compactPageCss('https://app.notion.com/p/spherity/Correct-workspace-isolation-1')).toContain('.notion-sidebar-container')
    expect(compactPageCss('https://www.notion.so/x')).toBeDefined()
    expect(compactPageCss('https://team.notion.site/x')).toBeDefined()
    expect(compactPageCss('https://notnotion.so/x')).toBeUndefined()
    expect(compactPageCss('https://github.com/a/b/pull/1')).toBeUndefined()
    expect(compactPageCss('not a url')).toBeUndefined()
  })
})

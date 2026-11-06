import { describe, expect, it } from 'vitest'
import { pageMenu } from './page-menu'

const ids = (c: Parameters<typeof pageMenu>[0]) => pageMenu(c).map((e) => ('separator' in e ? '-' : e.id))

describe('the right-click menu of a web page', () => {
  it('has navigation, the Markdown link and Inspect on a plain page', () => {
    expect(ids({ pageUrl: 'https://a.dev' })).toEqual(['back', 'forward', 'reload', '-', 'copy-markdown', '-', 'inspect'])
  })

  it('offers attaching only inside a WorkDesk, and names it', () => {
    const m = pageMenu({ pageUrl: 'https://a.dev', deskName: 'Review 12' })
    expect(m).toContainEqual({ id: 'attach-desk', label: 'Attach to Review 12' })
    expect(m).toContainEqual({ id: 'attach-todo', label: 'Attach to a Todo…' })
  })

  it('has link entries on a link; opening in a tab only where there is somewhere to open it', () => {
    expect(ids({ pageUrl: 'https://a.dev', linkUrl: 'https://b.dev', canOpenTab: true })).toContain('open-link')
    expect(ids({ pageUrl: 'https://a.dev', linkUrl: 'https://b.dev' })).not.toContain('open-link')
    expect(ids({ pageUrl: 'https://a.dev', linkUrl: 'javascript:void(0)', canOpenTab: true })).not.toContain('copy-link')
  })

  it('has Copy for a selection and Cut and Paste in a field; Back and Forward follow the history', () => {
    expect(ids({ pageUrl: 'https://a.dev', selectionText: 'x' })).toContain('copy-selection')
    expect(ids({ pageUrl: 'https://a.dev', isEditable: true })).toEqual(expect.arrayContaining(['cut', 'paste']))
    const nav = pageMenu({ pageUrl: 'https://a.dev', canGoBack: true })
    expect(nav[0]).toMatchObject({ id: 'back', enabled: true })
    expect(nav[1]).toMatchObject({ id: 'forward', enabled: false })
  })

  it('has no Markdown or attach entries for a page that is not on the web', () => {
    expect(ids({ pageUrl: 'about:blank', deskName: 'D' })).toEqual(['back', 'forward', 'reload', '-', 'inspect'])
  })
})

/**
 * A little CSS for pages shown in a narrow pane next to their item (a ticket's Notion page): what a full browser window has room for,
 * like Notion's sidebar and the wide margins around its text, goes. Only for the item tabs, never for pages you browse.
 */
const NOTION = `
.notion-sidebar-container { display: none !important; }
.notion-page-content { padding-left: 16px !important; padding-right: 16px !important; max-width: none !important; }
.notion-frame .notion-scroller > div[style*="padding-left"] { padding-left: 16px !important; padding-right: 16px !important; }
.layout { --margin-width: 16px !important; grid-template-columns: [full-start] 16px [content-start] minmax(0, 1fr) [content-end] 16px [full-end] !important; }
.layout-content, .layout-full { max-width: none !important; }
.notion-page-block .notranslate, .notion-page-block h1 { font-size: 26px !important; line-height: 1.25 !important; }
/* the page's own header (breadcrumb, Share, …): the frame below it takes its height */
[data-performance-region="route"] > header { display: none !important; }
.notion-frame { height: 100vh !important; }
/* the cover above the title */
.layout > .layout-full { display: none !important; }
/* the icon and its controls (add cover, add comment): the block that holds the page controls, in the same block as the title */
.layout-content .content-editable-void-no-select:has(.notion-page-controls) { display: none !important; }
`

const isNotion = (host: string): boolean => /(^|\.)notion\.(so|site|com)$/.test(host)

/** The CSS to put into a page at this address when it is shown beside its item, if any. */
export function compactPageCss(url: string): string | undefined {
  try {
    return isNotion(new URL(url).hostname) ? NOTION : undefined
  } catch {
    return undefined
  }
}

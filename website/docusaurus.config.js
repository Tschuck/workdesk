// @ts-check
const { themes } = require('prism-react-renderer')

/** @type {import('@docusaurus/types').Config} */
module.exports = {
  title: 'WorkDesk',
  tagline: 'A desk for every piece of work, for you and your AI agents',
  favicon: 'img/logo.svg',
  // the docs are published at https://<user>.github.io/<repo>/ : set these two (or the env vars) for your copy
  url: process.env.DOCS_URL || 'https://example.github.io',
  baseUrl: process.env.DOCS_BASE_URL || '/',
  onBrokenLinks: 'throw',
  markdown: { format: 'detect', hooks: { onBrokenMarkdownLinks: 'throw' } },
  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: { path: '../docs', routeBasePath: '/', sidebarPath: require.resolve('./sidebars.js') },
        blog: false,
        theme: { customCss: require.resolve('./src/css/custom.css') }
      })
    ]
  ],
  themes: [
    [require.resolve('@easyops-cn/docusaurus-search-local'), { hashed: true, docsRouteBasePath: '/', docsDir: '../docs', indexBlog: false }]
  ],
  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: 'WorkDesk',
      logo: { alt: 'WorkDesk', src: 'img/logo.svg' },
      items: [
        { to: '/getting-started', label: 'Getting started', position: 'left' },
        { to: '/use-cases', label: 'Use cases', position: 'left' },
        { to: '/features', label: 'Features', position: 'left' },
        { to: '/developer-guide', label: 'Developer guide', position: 'left' },
        { href: 'https://github.com/tschuck/workdesk', label: 'GitHub', position: 'right' }
      ]
    },
    footer: {
      style: 'dark',
      links: [{ title: 'Project', items: [{ label: 'WorkDesk on GitHub', href: 'https://github.com/tschuck/workdesk' }] }],
      copyright: 'WorkDesk is source-available under the PolyForm Shield License 1.0.0.'
    },
    prism: { theme: themes.github, darkTheme: themes.dracula, additionalLanguages: ['bash', 'json', 'yaml'] }
  }
}

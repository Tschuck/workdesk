import type { ReactNode } from 'react'

const box = (children: ReactNode) => (
  <svg className="file-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    {children}
  </svg>
)
const label = (text: string, color: string, size = 8) => (
  <text x="8" y="12" textAnchor="middle" fontSize={size} fontWeight="700" fontFamily="ui-sans-serif, system-ui, sans-serif" fill={color}>
    {text}
  </text>
)
const BLUE = '#519aba'
const YELLOW = '#cbcb41'
const PURPLE = '#a074c4'
const GREY = '#8a9099'

const ICON_BY_EXT: Record<string, ReactNode> = {
  ts: box(<><rect x="1" y="2" width="14" height="12" rx="2" fill="#3178c6" />{label('TS', '#fff', 7.5)}</>),
  tsx: box(<><rect x="1" y="2" width="14" height="12" rx="2" fill="#3178c6" />{label('TS', '#fff', 7.5)}</>),
  js: box(<><rect x="1" y="2" width="14" height="12" rx="2" fill={YELLOW} />{label('JS', '#2b2b2b', 7.5)}</>),
  mjs: box(<><rect x="1" y="2" width="14" height="12" rx="2" fill={YELLOW} />{label('JS', '#2b2b2b', 7.5)}</>),
  json: box(<text x="8" y="12.5" textAnchor="middle" fontSize="12" fontWeight="700" fontFamily="ui-monospace, Menlo, monospace" fill={YELLOW}>{'{}'}</text>),
  yaml: box(label('!', PURPLE, 14)),
  yml: box(label('!', PURPLE, 14)),
  md: box(<path d="M8 2v8M4.5 7 8 10.5 11.5 7M3.5 13.5h9" fill="none" stroke={BLUE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />),
  css: box(<><rect x="1" y="2" width="14" height="12" rx="2" fill="#42a5f5" />{label('#', '#fff', 10)}</>),
  html: box(<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" fill="none" stroke="#e44d26" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />),
  sh: box(<path d="M3 4.5 7 8l-4 3.5M8.5 12h4.5" fill="none" stroke="#8ec07c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />)
}

const GEAR = box(
  <>
    <circle cx="8" cy="8" r="2.2" fill="none" stroke={GREY} strokeWidth="2" />
    <path d="M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2M3.4 3.4l1.5 1.5M11.1 11.1l1.5 1.5M12.6 3.4l-1.5 1.5M4.9 11.1l-1.5 1.5" stroke={GREY} strokeWidth="2" strokeLinecap="round" />
  </>
)
const LINES = box(<path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h6" fill="none" stroke={GREY} strokeWidth="1.5" strokeLinecap="round" />)

/** The small icon in front of a file in the tree, by its extension (a few kinds, the rest is plain lines). */
export function FileIcon({ name }: { name: string }) {
  const lower = name.toLowerCase()
  if (lower === '.editorconfig' || lower === '.env' || lower.startsWith('.env.') || lower.endsWith('.config') || lower.endsWith('.toml') || lower.endsWith('.ini')) return GEAR
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  return ICON_BY_EXT[ext] ?? LINES
}

/** The chevron in front of a folder: right when closed, down when open. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={'file-chevron' + (open ? ' open' : '')} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

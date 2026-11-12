import type { ReactNode } from 'react'

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const ICONS = {
  cog: svg(
    <>
      <path d="M13.23 6.66 L15.14 7.04 L15.14 8.96 L13.23 9.34 L12.65 10.75 L13.72 12.37 L12.37 13.72 L10.75 12.65 L9.34 13.23 L8.96 15.14 L7.04 15.14 L6.66 13.23 L5.25 12.65 L3.63 13.72 L2.28 12.37 L3.35 10.75 L2.77 9.34 L0.86 8.96 L0.86 7.04 L2.77 6.66 L3.35 5.25 L2.28 3.63 L3.63 2.28 L5.25 3.35 L6.66 2.77 L7.04 0.86 L8.96 0.86 L9.34 2.77 L10.75 3.35 L12.37 2.28 L13.72 3.63 L12.65 5.25Z" />
      <circle cx="8" cy="8" r="2.1" />
    </>
  ),
  play: svg(<path d="M4.5 2.5 L13 8 L4.5 13.5Z" />),
  pause: svg(
    <>
      <path d="M5 3 V13" />
      <path d="M11 3 V13" />
    </>
  ),
  trash: svg(<path d="M2.5 4.5h11M6 4.5V2.8h4v1.7M4 4.5l.6 9h6.8l.6-9M6.5 7v4M9.5 7v4" />),
  terminal: svg(
    <>
      <rect x="1.8" y="2.5" width="12.4" height="11" rx="1.8" />
      <path d="M4.5 6.2l2 1.8-2 1.8M8 10h3.2" />
    </>
  ),
  globe: svg(
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2 1.8 3 3.8 3 6s-1 4.2-3 6c-2-1.8-3-3.8-3-6s1-4.2 3-6z" />
    </>
  ),
  code: svg(<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3L7 13" />),
  orchestrator: svg(<path d="M8 2.2v3M8 10.8v3M2.2 8h3M10.8 8h3M8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zM3.8 3.8l1.6 1.6M10.6 10.6l1.6 1.6M12.2 3.8l-1.6 1.6M5.4 10.6l-1.6 1.6" />),
  clock: svg(<path d="M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2zM8 4.8V8l2.2 1.4" />),
  combine: svg(<path d="M4.5 2.8a1.3 1.3 0 1 0 0 .01M4.5 13.2a1.3 1.3 0 1 0 0 .01M11.5 8a1.3 1.3 0 1 0 0 .01M4.5 4.1v7.8M4.5 6.5c0 2.4 5.2 1.4 5.7 1.5" />),
  sliders: svg(
    <>
      <path d="M2 5h4M9.5 5H14M2 11h6M11.5 11H14" />
      <circle cx="7.8" cy="5" r="1.6" />
      <circle cx="9.8" cy="11" r="1.6" />
    </>
  ),
  panes: svg(<path d="M2.5 3h11v4h-11zM4.5 9.5h9M4.5 12.5h9" />),
  branches: svg(<path d="M4.5 2.5v11M4.5 9.5c0-2 7-1 7-4.5M4.5 2.5a1.2 1.2 0 1 0 0 .01M11.5 4.5a1.2 1.2 0 1 0 0 .01M4.5 13.5a1.2 1.2 0 1 0 0 .01" />),
  plus: svg(<path d="M8 3v10M3 8h10" />),
  reload: svg(<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />),
  sync: svg(<path d="M3 6.5h8.5M9.5 4l2.5 2.5L9.5 9M13 9.5H4.5M6.5 7L4 9.5 6.5 12" />),
  fetch: svg(<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />),
  link: svg(<path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" />),
  file: svg(<path d="M4 1.8h5.2L12.2 4.8v9.4H4zM9 1.8v3.2h3.2M6 8h4M6 10.5h4" />),
  wrap: svg(<path d="M2.5 4h11M2.5 8h8.5a2 2 0 0 1 0 4H8.5M10 10.5L8.2 12 10 13.5M2.5 12h3" />),
  upload: svg(<path d="M8 10V2.5M5 5.2l3-3 3 3M3 12.5h10" />),
  sidebar: svg(<path d="M2.5 3h11v10h-11zM6.5 3v10" />),
  review: svg(<path d="M2.5 4h6M2.5 8h4M2.5 12h6M9.5 10.5l2 2 3.5-4.5" />),
  store: svg(<path d="M8 2.5v7M5 6.8l3 3 3-3M3 12.5h10" />),
  reveal: svg(<path d="M8 4.2a3.8 3.8 0 1 0 0 7.6A3.8 3.8 0 0 0 8 4.2zM8 1.5v2.7M8 11.8v2.7M1.5 8h2.7M11.8 8h2.7" />)
} as const

export type IconName = keyof typeof ICONS

interface Props {
  icon: IconName
  /** shown as the tooltip, and read out as the name of the button */
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  primary?: boolean
}

/** A button that is only an icon; it always has a tooltip. */
export function IconButton({ icon, title, onClick, disabled, danger, primary }: Props) {
  return (
    <button type="button" className={'icon-action' + (danger ? ' danger' : '') + (primary ? ' primary' : '')} title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {ICONS[icon]}
    </button>
  )
}

/** "3 min ago" for the tooltip of a reload button. */
export function ago(at: number, now: number = Date.now()): string {
  const min = Math.floor((now - at) / 60_000)
  return min < 1 ? 'just now' : min === 1 ? '1 min ago' : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`
}

interface ReloadProps {
  onClick: () => void
  /** a reload is running: the icon turns */
  busy?: boolean
  /** what is reloaded, e.g. "Reload the pull requests" */
  title?: string
  /** when the data was last read from the network */
  updatedAt?: number
  disabled?: boolean
}

/** The small reload icon next to a page's title: asks the network again, skipping what was kept. */
export function ReloadButton({ onClick, busy, title = 'Reload', updatedAt, disabled }: ReloadProps) {
  const label = updatedAt ? `${title} (updated ${ago(updatedAt)})` : title
  return (
    <button type="button" className={'icon-action reload' + (busy ? ' spinning' : '')} title={label} aria-label={label} disabled={disabled || busy} onClick={onClick}>
      {ICONS.reload}
    </button>
  )
}
